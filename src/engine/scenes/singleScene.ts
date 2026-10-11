//
// singleScene.js
//--------------------
// Drives the course scene when not connected to a server. Simulates responses expected from a server.
// by RHY3756547
//

import { Kart } from "../../entities/kart";
import { lz77 } from "../../formats/lz77";
import { narc } from "../../formats/narc";
import { ItemUi } from "../../ui/itemUi";
import { LapCountUI } from "../../ui/lapCountUI";
import { PlacementUI } from "../../ui/placementUI";
import { controlRaceCPU } from "../controls/controlRaceCPU";
import { IngameRes } from "../ingameRes";
import { MKCONST_course_obj, MKDSCONST } from "../mkdsConst";
import { courseScene } from "./courseScene";
import { controlPlayer } from "../../game/controlPlayer";
import { controlNetwork } from "../controls/controlNetwork";

export type RacerSetup = { charN: number; kartN: number };

export type NetRacer = RacerSetup & { kind: "local" | "cpu" | "remote" };

export type RaceSetup = {
	/** null = attract mode: every kart is CPU-driven and no HUD is shown. */
	player: RacerSetup | null;
	opponents: RacerSetup[];
	/** Multiplayer: the full kart list in grid order (same on every client), overriding player/opponents. */
	net?: { racers: NetRacer[]; localIndex: number };
};

export type RaceResult = {
	kart: Kart;
	charN: number;
	isPlayer: boolean;
	place: number;
	/** Finish time in seconds, or null if the kart hadn't finished when the race ended. */
	time: number | null;
};

/** How long to keep watching after the player crosses the line before the race counts as over. */
const POST_FINISH_FRAMES = 6 * 60;
import { sceneDrawer } from "./sceneDrawer";

export class singleScene {
	res: IngameRes;
	mode: {
		id: number;
		mode: number;
		time: number;
		frameDiv: number;
	};
	activeScene!: courseScene;
	myKart!: Kart;
	mchar: number;
	mkart: number;
	advanceTimes: number[];
	chars: number[] = [];
	raceStarted: boolean;
	setup: RaceSetup | null;
	raceFrames: number;
	lapTimes: number[];
	finishTimes: Map<Kart, number>;
	playerFinishFrame: number | null;
	private _lastLap: number;
	constructor(course: string, wsInstance: WebSocket, res: IngameRes, autostart = true, setup: RaceSetup | null = null) {
		this.res = res; //gameRes
		this.setup = setup;
		this.raceFrames = 0;
		this.lapTimes = [];
		this.finishTimes = new Map();
		this.playerFinishFrame = null;
		this._lastLap = 1;

		this.mode = undefined!;
		this.mchar = Math.floor(Math.random() * 12);
		this.mkart = Math.floor(Math.random() * 0x24);
		this.advanceTimes = [3, 4, -1, -1];
		this.raceStarted = autostart;
		this.begin(course, autostart);
	}

	startRace() {
		if (this.raceStarted) return;
		this.raceStarted = true;
		this.mode = {
			id: 0,
			time: 0,
			frameDiv: 0,
			mode: 0,
		};
		this.activeScene.updateMode({
			...this.mode,
		});
	}

	/** Multiplayer: apply received snapshots before the step, send ours after it. */
	onBeforeUpdate: (() => void) | null = null;
	onAfterUpdate: (() => void) | null = null;

	update() {
		if (this.activeScene != null) {
			this.onBeforeUpdate?.();
			this.activeScene.update();
			//simulate what a server would do
			this.updateServer();
			this.trackRace();
			this.onAfterUpdate?.();
		}
	}

	private trackRace() {
		if (this.activeScene.mode.id !== 2) return;
		this.raceFrames++;
		const time = this.raceFrames / 60;

		for (const k of this.activeScene.finishers) {
			if (!this.finishTimes.has(k)) this.finishTimes.set(k, time);
		}

		if ((this.setup?.player || this.setup?.net) && this.myKart.lapNumber !== this._lastLap) {
			if (this.myKart.lapNumber > this._lastLap && this._lastLap <= MKDSCONST.MAX_LAP) {
				const prev = this.lapTimes.reduce((a, b) => a + b, 0);
				this.lapTimes.push(time - prev);
			}
			this._lastLap = this.myKart.lapNumber;
			if (this.myKart.lapNumber > MKDSCONST.MAX_LAP && this.playerFinishFrame == null) {
				this.playerFinishFrame = this.raceFrames;
			}
		}
	}

	/** Seconds since GO (0 before the race starts). Freezes once the player finishes. */
	get raceTime() {
		const frames = this.playerFinishFrame ?? this.raceFrames;
		return frames / 60;
	}

	get playerFinished() {
		return this.playerFinishFrame != null;
	}

	/** True a few seconds after the player crosses the line, or once every kart has finished. */
	get raceOver() {
		if (this.playerFinishFrame == null) return false;
		return this.raceFrames - this.playerFinishFrame >= POST_FINISH_FRAMES || this.activeScene.finishers.length === this.activeScene.karts.length;
	}

	getResults(): RaceResult[] {
		const scene = this.activeScene;
		const finished = scene.finishers.slice();
		const rest = scene.karts.filter((k) => !finished.includes(k)).sort((a, b) => b.getPosition() - a.getPosition());
		return [...finished, ...rest].map((kart, i) => ({
			kart,
			charN: this.chars[scene.karts.indexOf(kart)],
			isPlayer: kart === this.myKart && (this.setup?.player != null || this.setup?.net != null),
			place: i + 1,
			time: this.finishTimes.get(kart) ?? null,
		}));
	}

	private updateServer() {
		if (!this.raceStarted) return;
		const m = this.mode;
		m.frameDiv++;
		if (m.frameDiv == 60) {
			m.frameDiv -= 60;
			m.time++;
			const timeAd = this.advanceTimes[m.id];
			if (timeAd != -1 && m.time >= timeAd) {
				m.id++;
				m.time = 0;
			}
		}
		this.activeScene.updateMode({
			...this.mode,
		});
	}

	render() {
		if (this.activeScene != null) {
			sceneDrawer.getInstance().drawTest(gl, this.activeScene, 0, 0, gl.viewportWidth, gl.viewportHeight);
		}
	}

	private begin(courseId: string, autostart: boolean) {
		if (courseId.substr(0, 5) == "mkds/") {
			const cnum = Number(courseId.substr(5));
			const course = MKDSCONST.COURSES[cnum];
			const cDir = MKDSCONST.COURSEDIR + course.name;
			const mainNarc = new narc(lz77.decompress(gameROM.getFile(`${cDir}.carc`)!));
			const texNarc = new narc(lz77.decompress(gameROM.getFile(`${cDir}Tex.carc`)!));
			this.setUpCourse(mainNarc, texNarc, course, autostart);
		} else throw "custom tracks are not implemented yet!";
	}

	private setUpNetCourse(mainNarc: narc, texNarc: narc, course: MKCONST_course_obj, net: NonNullable<RaceSetup["net"]>) {
		const controllers = { local: controlPlayer, cpu: controlRaceCPU, remote: controlNetwork };
		const chars = net.racers.map((r, i) => ({
			charN: r.charN,
			kartN: r.kartN,
			controller: controllers[r.kind] as typeof Controls,
			raceCam: i === net.localIndex,
			extraParams: [],
		}));
		this.chars = chars.map((c) => c.charN);
		this.activeScene = new courseScene(mainNarc, texNarc, course, chars, {}, this.res);
		net.racers.forEach((r, i) => {
			if (r.kind === "remote") this.activeScene.karts[i].netPuppet = true;
		});
		this.myKart = this.activeScene.karts[net.localIndex];
		this.myKart.local = true;
		// Wait for the host's "go" (startRace) so everyone's countdown starts together.
		this.raceStarted = false;
		this.mode = { id: -1, time: 0, frameDiv: 0, mode: -1 };
		this.activeScene.entities.push(
			new PlacementUI(this.activeScene, this.myKart),
			new LapCountUI(this.activeScene, this.myKart),
			new ItemUi(this.activeScene, this.myKart)
		);
	}

	private setUpCourse(mainNarc: narc, texNarc: narc, course: MKCONST_course_obj, autostart: boolean) {
		if (this.setup?.net) return this.setUpNetCourse(mainNarc, texNarc, course, this.setup.net);
		const chars = [];
		const setup = this.setup;
		const player: RacerSetup = setup?.player ?? { charN: this.mchar, kartN: this.mkart };
		const playerController = setup ? (setup.player ? controlPlayer : controlRaceCPU) : MKDSCONST.USER_CONTROLLER;
		chars.push({
			charN: player.charN,
			kartN: player.kartN,
			controller: playerController,
			raceCam: true,
			extraParams: [
				{ k: "name", v: "single" },
				{ k: "active", v: true },
			],
		});

		const opponents =
			setup?.opponents ??
			Array.from({ length: 7 }, () => ({ charN: Math.floor(Math.random() * 12), kartN: Math.floor(Math.random() * 0x24) }));
		for (const o of opponents) {
			chars.push({
				charN: o.charN,
				kartN: o.kartN,
				controller: controlRaceCPU,
				raceCam: false,
				extraParams: [
					{ k: "name", v: "no" },
					{ k: "active", v: true },
				],
			});
		}
		this.chars = chars.map((c) => c.charN);

		this.activeScene = new courseScene(mainNarc, texNarc, course, chars, {}, this.res);

		this.myKart = this.activeScene.karts[0];
		const attract = setup != null && setup.player == null;
		this.myKart.local = !attract;

		this.mode = {
			id: autostart ? 0 : -1,
			time: 0,
			frameDiv: 0,
			mode: autostart ? 0 : -1,
		};

		if (autostart) {
			this.activeScene.updateMode({
				...this.mode,
			});
		}
		if (attract) return;
		this.activeScene.entities.push(
			new PlacementUI(this.activeScene, this.myKart),
			new LapCountUI(this.activeScene, this.myKart),
			new ItemUi(this.activeScene, this.myKart)
		);
	}
}
