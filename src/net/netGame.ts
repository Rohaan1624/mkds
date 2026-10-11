//
// netGame.ts
//--------------------
// Multiplayer session: lobby, synced race start, kart snapshots, item events and results.
//
// Authority: every client simulates its own kart; the host also simulates the CPUs. Everything else is a
// puppet driven by interpolated snapshots. Item hits are decided by the client whose kart got hit.
//

import { ItemController } from "../engine/itemController";
import type { NetRacer, singleScene } from "../engine/scenes/singleScene";
import type { Item } from "../entities/item";
import { ItemEffectEvent, ItemEffects } from "../entities/itemEffects";
import { Kart, KartNetState } from "../entities/kart";
import { NetMsg, NetTransport } from "./transport";

export type LobbyPlayer = { id: string; name: string; charN: number; kartN: number; host: boolean };
export type LobbySettings = { courseId: number; laps: 3 | 5; cpus: boolean };
export type StartRacer = { id: string | null; name: string; charN: number; kartN: number };
export type StartInfo = { racers: StartRacer[]; courseId: number; laps: number; race: number };
export type NetResult = { slot: number; time: number | null };
export type Me = { name: string; charN: number; kartN: number };

export const MAX_RACERS = 8;
/** Snapshots are sent every N simulation frames (60 fps -> 20 Hz). */
const SNAPSHOT_EVERY = 3;
/** Remote karts are shown this far in the past so there are always two snapshots to blend between. */
const INTERP_DELAY_MS = 110;
const MAX_EXTRAPOLATE_MS = 150;
const LOAD_TIMEOUT_MS = 20000;
/** The host schedules the start this far ahead so every client's countdown begins at the same instant. */
const START_LEAD_MS = 1200;
const CLOCK_PINGS = 6;
/** After the first human finishes, everyone else gets this long before results are forced. */
const FINISH_GRACE_FRAMES = 30 * 60;

type Snap = { at: number; s: KartNetState };

function lerp(a: number, b: number, t: number) {
	return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number) {
	let d = (b - a) % (Math.PI * 2);
	if (d > Math.PI) d -= Math.PI * 2;
	if (d < -Math.PI) d += Math.PI * 2;
	return a + d * t;
}

function lerpV(a: vec3, b: vec3, t: number): vec3 {
	return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export class NetGame {
	readonly transport: NetTransport;
	players: LobbyPlayer[] = [];
	settings: LobbySettings = { courseId: 0, laps: 3, cpus: true };
	me: Me;
	phase: "lobby" | "loading" | "racing" | "results" = "lobby";
	start: StartInfo | null = null;
	localSlot = -1;

	onLobby: () => void = () => {};
	onStart: (info: StartInfo, racers: NetRacer[], localSlot: number) => void = () => {};
	onGo: () => void = () => {};
	/** Loading screen: names of racers still loading. */
	onWaiting: (names: string[]) => void = () => {};
	onResults: (order: NetResult[]) => void = () => {};
	onBackToLobby: () => void = () => {};
	onClosed: (reason: string) => void = () => {};

	private _scene: singleScene | null = null;
	private _buffers = new Map<number, Snap[]>();
	private _frame = 0;
	private _finishes = new Map<number, number>();
	private _firstFinishFrame = -1;
	private _loaded = new Set<string>();
	private _loadTimer: ReturnType<typeof setTimeout> | null = null;
	private _sentFinish = false;
	private _gone = new Set<string>();
	private _raceCounter = 0;
	/** Guest: host clock minus our clock (performance.now), from the lowest-latency ping. */
	private _clockOffset = 0;
	private _bestRtt = Infinity;

	private constructor(transport: NetTransport, me: Me) {
		this.transport = transport;
		this.me = me;
		transport.onMessage = (m, from) => this._onMessage(m, from);
		transport.onPeerLeave = (id) => this._onPeerLeave(id);
		transport.onClose = (reason) => {
			this._detachRace();
			this.onClosed(reason);
		};
	}

	get isHost() {
		return this.transport.isHost;
	}

	get code() {
		return this.transport.code;
	}

	static async host(me: Me) {
		const g = new NetGame(await NetTransport.host(), me);
		g.players = [{ id: g.transport.myId, ...me, host: true }];
		return g;
	}

	static async join(code: string, me: Me) {
		const g = new NetGame(await NetTransport.join(code), me);
		g.transport.send({ t: "hello", ...me });
		g._syncClock();
		return g;
	}

	leave() {
		this._detachRace();
		this.transport.close();
	}

	// ------------------------------------------------------------ lobby

	setPick(charN: number, kartN: number) {
		this.me = { ...this.me, charN, kartN };
		if (this.isHost) {
			const p = this.players.find((p) => p.host)!;
			Object.assign(p, { charN, kartN });
			this._pushLobby();
		} else {
			this.transport.send({ t: "pick", charN, kartN });
		}
	}

	setSettings(s: Partial<LobbySettings>) {
		if (!this.isHost) return;
		Object.assign(this.settings, s);
		this._pushLobby();
	}

	private _pushLobby() {
		this.transport.broadcast({ t: "lobby", players: this.players, settings: this.settings });
		this.onLobby();
	}

	/** Host: build the grid and tell everyone to load. */
	hostStart(randomCpus: (exclude: number[], count: number) => { charN: number; kartN: number }[]) {
		if (!this.isHost || this.phase !== "lobby") return;
		const racers: StartRacer[] = this.players.map((p) => ({ id: p.id, name: p.name, charN: p.charN, kartN: p.kartN }));
		if (this.settings.cpus) {
			const cpus = randomCpus(
				racers.map((r) => r.charN),
				MAX_RACERS - racers.length
			);
			for (const c of cpus) racers.push({ id: null, name: "", ...c });
		}
		const info: StartInfo = { racers, courseId: this.settings.courseId, laps: this.settings.laps, race: ++this._raceCounter };
		this.transport.broadcast({ t: "start", info });
		this._beginLoading(info);
		this._loadTimer = setTimeout(() => this._hostGo(), LOAD_TIMEOUT_MS);
	}

	hostBackToLobby() {
		if (!this.isHost) return;
		this._detachRace();
		this.phase = "lobby";
		this.transport.broadcast({ t: "tolobby" });
		this._pushLobby();
		this.onBackToLobby();
	}

	private _beginLoading(info: StartInfo) {
		this.phase = "loading";
		this.start = info;
		this.localSlot = info.racers.findIndex((r) => r.id === this.transport.myId);
		const racers: NetRacer[] = info.racers.map((r, i) => ({
			charN: r.charN,
			kartN: r.kartN,
			kind: i === this.localSlot ? "local" : r.id == null && this.isHost ? "cpu" : "remote",
		}));
		this.onStart(info, racers, this.localSlot);
	}

	/** Called by the UI once the race scene for `start` exists. */
	attachRace(scene: singleScene) {
		this._scene = scene;
		this._buffers.clear();
		this._finishes.clear();
		this._firstFinishFrame = -1;
		this._frame = 0;
		this._sentFinish = false;
		scene.onBeforeUpdate = () => this._beforeUpdate();
		scene.onAfterUpdate = () => this._afterUpdate();
		Kart.onPuppetDamaged = (kart, type) => this._send({ t: "hurt", k: this._slotOf(kart), d: type });
		ItemEffects.net = (ev) => this._send(ev);
		ItemController.net = {
			onSpawn: (item) => this._send({ t: "isp", id: item.netId, ty: item.type, k: this._slotOf(item.owner) }),
			onRelease: (item, f) => this._sendRelease(item, f),
			onDie: (item) => this._send({ t: "idie", id: item.netId }),
		};
		// Racers who left before the race started never get a kart.
		this.start!.racers.forEach((r, i) => {
			if (r.id && this._gone.has(r.id)) scene.activeScene.karts[i].active = false;
		});
		if (this.isHost) this._markLoaded(this.transport.myId);
		else this.transport.send({ t: "loaded" });
	}

	private _markLoaded(id: string) {
		this._loaded.add(id);
		const humans = this.start!.racers.filter((r) => r.id && !this._gone.has(r.id));
		const waiting = humans.filter((r) => !this._loaded.has(r.id!)).map((r) => r.name);
		this.transport.broadcast({ t: "wait", names: waiting });
		this.onWaiting(waiting);
		if (waiting.length === 0) this._hostGo();
	}

	private _hostGo() {
		if (!this.isHost || this.phase !== "loading") return;
		if (this._loadTimer) clearTimeout(this._loadTimer);
		this._loadTimer = null;
		this._loaded.clear();
		// Start at a shared moment (host clock) so all race times count from the same instant.
		const at = performance.now() + START_LEAD_MS;
		this.transport.broadcast({ t: "go", at });
		this._goAt(at);
	}

	/** `at` is in host clock time. */
	private _goAt(at: number) {
		const local = at - this._clockOffset;
		setTimeout(() => this.phase === "loading" && this._go(), Math.max(0, local - performance.now()));
	}

	/** Guest: estimate the host clock offset (NTP-style, keeping the lowest-latency sample). */
	private _syncClock() {
		if (this.isHost) return;
		for (let i = 0; i < CLOCK_PINGS; i++) {
			setTimeout(() => this.transport.send({ t: "ping", c: performance.now() }), i * 150);
		}
	}

	private _onPong(c: number, h: number) {
		const now = performance.now();
		const rtt = now - c;
		if (rtt < this._bestRtt) {
			this._bestRtt = rtt;
			this._clockOffset = h - (c + rtt / 2);
		}
	}

	private _go() {
		this.phase = "racing";
		this.onGo();
	}

	private _detachRace() {
		if (this._scene) {
			this._scene.onBeforeUpdate = null;
			this._scene.onAfterUpdate = null;
		}
		this._scene = null;
		ItemController.net = null;
		Kart.onPuppetDamaged = null;
		ItemEffects.net = null;
	}

	// ------------------------------------------------------------ race sync

	/** In-race messages carry the race number so stragglers from a previous race are ignored. */
	private _send(msg: NetMsg) {
		this.transport.broadcast({ ...msg, r: this.start?.race });
	}

	private _slotOf(kart: Kart) {
		return this._scene!.activeScene.karts.indexOf(kart);
	}

	/** Slots simulated on this client. */
	private _ownedSlots(): number[] {
		const out = [this.localSlot];
		if (this.isHost) this.start!.racers.forEach((r, i) => r.id == null && out.push(i));
		return out;
	}

	private _beforeUpdate() {
		const scene = this._scene!;
		const now = performance.now();
		for (const [slot, buf] of this._buffers) {
			const kart = scene.activeScene.karts[slot];
			if (kart?.netPuppet && buf.length) kart.netState = this._sample(buf, now - INTERP_DELAY_MS);
		}
	}

	private _sample(buf: Snap[], at: number): KartNetState {
		while (buf.length > 2 && buf[1].at <= at) buf.shift();
		const a = buf[0];
		const b = buf[1];
		if (!b || at <= a.at) {
			if (!b && at > a.at) {
				// Ran out of snapshots: coast along the last velocity for a little while.
				const frames = Math.min(at - a.at, MAX_EXTRAPOLATE_MS) / (1000 / 60);
				return { ...a.s, p: [a.s.p[0] + a.s.v[0] * frames, a.s.p[1] + a.s.v[1] * frames, a.s.p[2] + a.s.v[2] * frames] };
			}
			return a.s;
		}
		const t = Math.min(1, (at - a.at) / (b.at - a.at || 1));
		return {
			...b.s,
			p: lerpV(a.s.p, b.s.p, t),
			v: lerpV(a.s.v, b.s.v, t),
			n: lerpV(a.s.n, b.s.n, t),
			d: lerpAngle(a.s.d, b.s.d, t),
			o: lerp(a.s.o, b.s.o, t),
			s: lerp(a.s.s, b.s.s, t),
			a: lerp(a.s.a, b.s.a, t),
			g: lerp(a.s.g, b.s.g, t),
		};
	}

	private _afterUpdate() {
		const scene = this._scene!;
		this._frame++;
		if (this._frame % SNAPSHOT_EVERY === 0) {
			const karts = scene.activeScene.karts;
			const s: Record<number, KartNetState> = {};
			for (const slot of this._ownedSlots()) if (karts[slot]?.active) s[slot] = karts[slot].captureNetState();
			this._send({ t: "snap", s });
		}

		if (!this._sentFinish && scene.playerFinished) {
			this._sentFinish = true;
			this._send({ t: "fin", slot: this.localSlot, time: scene.raceTime });
			this._recordFinish(this.localSlot, scene.raceTime);
		}

		if (this.isHost && this.phase === "racing") this._hostCheckRaceOver();
	}

	private _sendRelease(item: Item, forward: number) {
		const ctl = item.controller as unknown as { angle?: number; speed?: number };
		this._send({
			t: "irel",
			id: item.netId,
			f: forward,
			p: Array.from(item.pos),
			v: Array.from(item.vel),
			a: ctl.angle,
			sp: ctl.speed,
		});
	}

	private _onSnap(s: Record<string, KartNetState>) {
		const now = performance.now();
		for (const key of Object.keys(s)) {
			const slot = Number(key);
			if (slot === this.localSlot) continue;
			let buf = this._buffers.get(slot);
			if (!buf) this._buffers.set(slot, (buf = []));
			buf.push({ at: now, s: s[key] });
			if (buf.length > 30) buf.shift();
		}
	}

	private _onItemSpawn(m: { id: string; ty: string; k: number }) {
		const scene = this._scene!.activeScene;
		const kart = scene.karts[m.k];
		if (!kart?.netPuppet || scene.items.findByNetId(m.id)) return;
		// Match the sender's item counter so grouped children get the same ids.
		kart.itemSeq = Number(m.id.split(":")[1]);
		const item = scene.items.createItem(m.ty as Parameters<typeof scene.items.createItem>[0], kart);
		kart.items.heldItem = item;
	}

	private _onItemRelease(m: { id: string; f: number; p: number[]; v: number[]; a?: number; sp?: number }) {
		const scene = this._scene!.activeScene;
		const item = scene.items.findByNetId(m.id);
		if (!item) return;
		// Pull a released shell out of its orbiting group.
		for (const other of scene.items.items) {
			const children = (other.controller as unknown as { children?: (Item | null)[] }).children;
			const i = children?.indexOf(item) ?? -1;
			if (i >= 0) children!.splice(i, 1);
		}
		if (item.held) item.release(m.f);
		if (item.owner.items.heldItem === item) item.owner.items.heldItem = null;
		item.pos = [m.p[0], m.p[1], m.p[2]];
		item.vel = [m.v[0], m.v[1], m.v[2]];
		const ctl = item.controller as unknown as { angle?: number; speed?: number };
		if (m.a != null) ctl.angle = m.a;
		if (m.sp != null) ctl.speed = m.sp;
	}

	private _onItemDie(id: string) {
		const item = this._scene!.activeScene.items.findByNetId(id);
		if (item && !item.dead && item.deadTimer === 0) {
			item.netQuiet = true;
			item.deadTimer = 1;
		}
	}

	// ------------------------------------------------------------ finish / results (host decides)

	private _recordFinish(slot: number, time: number) {
		if (!this._finishes.has(slot)) this._finishes.set(slot, time);
		if (this._firstFinishFrame < 0) this._firstFinishFrame = this._frame;
	}

	private _hostCheckRaceOver() {
		const scene = this._scene!;
		const racers = this.start!.racers;
		// CPUs finish on the host's simulation.
		racers.forEach((r, i) => {
			if (r.id != null) return;
			const t = scene.finishTimes.get(scene.activeScene.karts[i]);
			if (t != null && !this._finishes.has(i)) this._finishes.set(i, t);
		});
		const humans = racers.map((r, i) => ({ r, i })).filter(({ r }) => r.id && !this._gone.has(r.id));
		const allDone = humans.every(({ i }) => this._finishes.has(i));
		const timedOut = this._firstFinishFrame >= 0 && this._frame - this._firstFinishFrame > FINISH_GRACE_FRAMES;
		if (!allDone && !timedOut) return;

		const karts = scene.activeScene.karts;
		const finished = [...this._finishes.entries()].sort((a, b) => a[1] - b[1]).map(([slot, time]) => ({ slot, time }));
		const rest = racers
			.map((_, i) => i)
			.filter((i) => !this._finishes.has(i))
			.sort((a, b) => karts[b].getPosition() - karts[a].getPosition())
			.map((slot) => ({ slot, time: null }));
		const order: NetResult[] = [...finished, ...rest];
		this._send({ t: "res", order });
		this._showResults(order);
	}

	private _showResults(order: NetResult[]) {
		this.phase = "results";
		this.onResults(order);
	}

	// ------------------------------------------------------------ messages

	private _onMessage(m: NetMsg, from: string) {
		if (m.r != null && m.r !== this.start?.race) return; // from an earlier race
		switch (m.t) {
			// lobby (host side)
			case "hello": {
				if (!this.isHost) return;
				if (this.phase !== "lobby" || this.players.length >= MAX_RACERS) {
					this.transport.send({ t: "busy", reason: this.phase !== "lobby" ? "A race is in progress." : "The room is full." }, from);
					return;
				}
				const p = m as unknown as Me;
				this.players.push({ id: from, name: String(p.name).slice(0, 16), charN: p.charN, kartN: p.kartN, host: false });
				this._pushLobby();
				return;
			}
			case "pick": {
				if (!this.isHost) return;
				const p = this.players.find((p) => p.id === from);
				if (p) Object.assign(p, { charN: m.charN, kartN: m.kartN });
				this._pushLobby();
				return;
			}
			case "loaded":
				if (this.isHost && this.phase === "loading") this._markLoaded(from);
				return;
			case "fin":
				this._recordFinish(m.slot as number, m.time as number);
				return;

			// lobby (guest side)
			case "lobby":
				this.players = m.players as LobbyPlayer[];
				this.settings = m.settings as LobbySettings;
				this.onLobby();
				return;
			case "busy":
				this.transport.close();
				this.onClosed(String(m.reason));
				return;
			case "start":
				this._syncClock();
				this._beginLoading(m.info as StartInfo);
				return;
			case "go":
				if (this.phase === "loading") this._goAt(m.at as number);
				return;
			case "wait":
				if (this.phase === "loading") this.onWaiting(m.names as string[]);
				return;
			case "ping":
				if (this.isHost) this.transport.send({ t: "pong", c: m.c, h: performance.now() }, from);
				return;
			case "pong":
				this._onPong(m.c as number, m.h as number);
				return;
			case "res":
				this._showResults(m.order as NetResult[]);
				return;
			case "tolobby":
				this._detachRace();
				this.phase = "lobby";
				this.onBackToLobby();
				return;
			case "left": {
				this._markGone(String(m.id));
				return;
			}

			// race
			case "snap":
				if (this._scene) this._onSnap(m.s as Record<string, KartNetState>);
				return;
			case "isp":
				if (this._scene) this._onItemSpawn(m as unknown as { id: string; ty: string; k: number });
				return;
			case "irel":
				if (this._scene) this._onItemRelease(m as unknown as { id: string; f: number; p: number[]; v: number[] });
				return;
			case "thunder":
			case "ink":
			case "boo":
			case "booitem":
				if (this._scene) ItemEffects.receive(m as unknown as ItemEffectEvent, this._scene.activeScene, (ev) => this._send(ev));
				return;
			case "hurt": {
				const slot = m.k as number;
				if (this._scene && this._ownedSlots().includes(slot)) this._scene.activeScene.karts[slot].damage(m.d as number);
				return;
			}
			case "idie":
				if (this._scene) this._onItemDie(String(m.id));
				return;
		}
	}

	private _onPeerLeave(id: string) {
		this.players = this.players.filter((p) => p.id !== id);
		this.transport.broadcast({ t: "left", id });
		this._markGone(id);
		if (this.phase === "lobby") this._pushLobby();
		if (this.phase === "loading") this._markLoaded(this.transport.myId);
	}

	private _markGone(id: string) {
		this._gone.add(id);
		if (!this._scene || !this.start) return;
		const slot = this.start.racers.findIndex((r) => r.id === id);
		if (slot >= 0) this._scene.activeScene.karts[slot].active = false;
	}
}
