//
// frontend.ts
//--------------------
// Menus and game flow: title -> mode -> character -> kart -> cup/course -> race -> results.
// The 3D engine itself is booted by index.html (window.initNitro); this module drives everything around it.
//

import { AudioVolume, nitroAudio } from "../audio/nitroAudio";
import type { IngameRes } from "../engine/ingameRes";
import { MKDSCONST, refreshSettings } from "../engine/mkdsConst";
import { RaceResult, RaceSetup, RacerSetup, singleScene } from "../engine/scenes/singleScene";
import { fileStore } from "../engine/storage/fileStore";
import { getUiScale, uiPx } from "../ui/uiScale";
import { Input } from "./input";
import { Minimap } from "./minimap";
import { SoundBox } from "../audio/soundBox";
import type { nitroAudioSound } from "../audio/nitroAudio";
import { ItemEffects } from "../entities/itemEffects";
import { Kart } from "../entities/kart";
import { NetGame, NetResult, StartInfo } from "../net/netGame";
import {
	CHARACTERS,
	CUPS,
	CupInfo,
	GP_POINTS,
	KART_SLOT_NAMES,
	KartStats,
	characterName,
	courseName,
	kartIndex,
	normalisedKartStats,
} from "./roster";

type Mode = "gp" | "vs" | "tt" | "online";

type GrandPrix = {
	cup: CupInfo;
	raceIndex: number;
	racers: RacerSetup[]; // index 0 is the player
	points: number[];
	lastPoints: number[];
};

type AppWindow = Window & {
	initNitro: (rom: ArrayBuffer) => IngameRes;
	mainScene: singleScene | null;
	gamePaused: boolean;
};
const win = window as unknown as AppWindow;

const LOCAL_ROM_URL = "rom.nds";

const state = {
	res: null as IngameRes | null,
	statsFor: null as ((kartN: number) => KartStats) | null,
	mode: "vs" as Mode,
	charN: CHARACTERS[0].id,
	kartSlot: 0,
	cupIndex: 0,
	courseId: 0,
	gp: null as GrandPrix | null,
	racing: false,
	resultsShown: false,
	inPauseMenu: false,
	lastSetup: null as RaceSetup | null,
	net: null as NetGame | null,
	/** Which screen is showing, so network events know whether to refresh it. */
	screen: "",
	leaving: false,
};

let root: HTMLElement;
let hud: HTMLElement;
let onBack: (() => void) | null = null;
const portraitCache = new Map<number, string>();

// ---------------------------------------------------------------- helpers

function h(strings: TemplateStringsArray, ...vals: unknown[]) {
	return strings.reduce((out, s, i) => out + s + (i < vals.length ? String(vals[i]) : ""), "");
}

function escapeHtml(s: string) {
	return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function formatTime(t: number | null) {
	if (t == null) return "--:--.---";
	const m = Math.floor(t / 60);
	const s = Math.floor(t % 60);
	const ms = Math.floor((t * 1000) % 1000);
	return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function portrait(charN: number) {
	if (!state.res) return "";
	let url = portraitCache.get(charN);
	if (!url) {
		url = state.res.playerThumb.toCanvas(true, charN).toDataURL();
		portraitCache.set(charN, url);
	}
	return url;
}

function shuffle<T>(arr: T[]) {
	const a = arr.slice();
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function randomOpponents(excludeChar: number | null, count: number): RacerSetup[] {
	return shuffle(CHARACTERS.filter((c) => c.id !== excludeChar))
		.slice(0, count)
		.map((c) => ({ charN: c.id, kartN: kartIndex(c.id, Math.floor(Math.random() * 3)) }));
}

function setScreen(html: string, back: (() => void) | null, className = "", name = "") {
	state.screen = name;
	root.className = "ui-root " + className;
	root.innerHTML = html;
	root.hidden = false;
	onBack = back;
	const first = root.querySelector<HTMLElement>("[data-autofocus]") ?? root.querySelector<HTMLElement>("[data-nav]");
	first?.focus({ preventScroll: true });
}

function hideScreen() {
	state.screen = "";
	root.hidden = true;
	root.innerHTML = "";
	onBack = null;
}

function bind(selector: string, handler: (el: HTMLElement) => void) {
	root.querySelectorAll<HTMLElement>(selector).forEach((el) => el.addEventListener("click", () => handler(el)));
}

// Spatial keyboard/gamepad navigation between [data-nav] elements.
function moveFocus(dx: number, dy: number) {
	const active = document.activeElement;
	if (dx !== 0 && active instanceof HTMLInputElement && active.type === "range") {
		active.value = String(Number(active.value) + dx * Number(active.step || 1));
		active.dispatchEvent(new Event("input"));
		return;
	}
	const items = [...root.querySelectorAll<HTMLElement>("[data-nav]")].filter((el) => !el.hasAttribute("disabled"));
	if (items.length === 0) return;
	const current = document.activeElement as HTMLElement;
	if (!items.includes(current)) {
		items[0].focus();
		return;
	}
	const a = current.getBoundingClientRect();
	const ax = a.left + a.width / 2;
	const ay = a.top + a.height / 2;
	let best: HTMLElement | null = null;
	let bestScore = Infinity;
	for (const el of items) {
		if (el === current) continue;
		const b = el.getBoundingClientRect();
		const ddx = b.left + b.width / 2 - ax;
		const ddy = b.top + b.height / 2 - ay;
		const along = ddx * dx + ddy * dy;
		if (along <= 1) continue;
		const across = Math.abs(ddx * dy) + Math.abs(ddy * dx);
		const score = along + across * 2.5;
		if (score < bestScore) {
			bestScore = score;
			best = el;
		}
	}
	best?.focus();
}

// ---------------------------------------------------------------- boot / title

async function fetchLocalRom(): Promise<ArrayBuffer | null> {
	try {
		const resp = await fetch(LOCAL_ROM_URL, { cache: "no-store" });
		const type = resp.headers.get("content-type") ?? "";
		if (!resp.ok || type.includes("text/html")) return null;
		return await resp.arrayBuffer();
	} catch {
		return null;
	}
}

function storedRom(): Promise<ArrayBuffer | null> {
	return new Promise((resolve) => {
		fileStore.getInstance().checkRom((has) => {
			if (!has) return resolve(null);
			fileStore.getInstance().loadRom((rom) => resolve((rom as ArrayBuffer) ?? null));
		});
	});
}

function pickRom(): Promise<ArrayBuffer | null> {
	return new Promise((resolve) => fileStore.getInstance().promptForRom((rom) => resolve((rom as ArrayBuffer) ?? null)));
}

async function showTitle() {
	setScreen(
		h`<div class="title-screen">
			<div class="logo"><span class="logo-top">MARIO KART</span><span class="logo-ds">DS</span><span class="logo-web">WEB EDITION</span></div>
			<p class="title-status" id="title-status">Looking for ROM…</p>
			<button class="btn btn-primary btn-big" id="btn-init" data-nav disabled>Initialize</button>
			<p class="fineprint">Uses your own Mario Kart DS ROM. Put your <code>.nds</code> in the project folder (or <code>rom/</code>) to skip picking it.</p>
		</div>`,
		null,
		"screen-boot"
	);
	const status = root.querySelector("#title-status")!;
	const btn = root.querySelector<HTMLButtonElement>("#btn-init")!;

	let rom = await fetchLocalRom();
	let source = "Found ROM in rom/ folder";
	if (!rom) {
		rom = await storedRom();
		source = "Using ROM saved in this browser";
	}
	if (rom) {
		status.textContent = source;
	} else {
		status.textContent = "No ROM found. Choose your Mario Kart DS .nds file.";
		btn.textContent = "Choose ROM & Initialize";
	}
	btn.disabled = false;
	btn.focus();
	btn.addEventListener("click", async () => {
		if (!rom) rom = await pickRom();
		if (!rom) return;
		boot(rom);
	});
}

function boot(rom: ArrayBuffer) {
	setScreen(h`<div class="title-screen"><div class="spinner"></div><p class="title-status">Loading game data…</p></div>`, null, "screen-boot");
	// Let the spinner paint before the heavy synchronous init.
	setTimeout(() => {
		state.res = win.initNitro(rom);
		state.statsFor = normalisedKartStats(state.res);
		showMainMenu();
	}, 50);
}

// ---------------------------------------------------------------- attract mode

function startAttract() {
	if (!state.res) return;
	const course = CUPS[Math.floor(Math.random() * CUPS.length)].courses[Math.floor(Math.random() * 4)];
	loadScene(course.id, { player: null, opponents: randomOpponents(null, 7) });
	hud.hidden = true;
	state.racing = false;
}

function loadScene(courseId: number, setup: RaceSetup) {
	nitroAudio.killAll();
	nitroAudio.setPaused(false);
	win.gamePaused = false;
	refreshSettings();
	win.mainScene = new singleScene("mkds/" + courseId, 0 as unknown as WebSocket, state.res!, true, setup);
}

// ---------------------------------------------------------------- menus

function showMainMenu() {
	state.gp = null;
	if (state.racing || !win.mainScene) startAttract();
	setScreen(
		h`<div class="panel main-menu">
			<div class="logo small"><span class="logo-top">MARIO KART</span><span class="logo-ds">DS</span></div>
			<button class="menu-tile tile-gp" data-nav data-autofocus data-mode="gp"><span class="tile-icon">🏆</span><span class="tile-name">Grand Prix</span><span class="tile-desc">4 races · points · trophy</span></button>
			<button class="menu-tile tile-vs" data-nav data-mode="vs"><span class="tile-icon">🏁</span><span class="tile-name">VS Race</span><span class="tile-desc">Any course vs 7 CPUs</span></button>
			<button class="menu-tile tile-tt" data-nav data-mode="tt"><span class="tile-icon">⏱️</span><span class="tile-name">Time Trial</span><span class="tile-desc">Solo · beat your best time</span></button>
			<button class="menu-tile tile-mp" data-nav data-mode="online"><span class="tile-icon">🌐</span><span class="tile-name">Online</span><span class="tile-desc">Race your friends · room codes</span></button>
			<div class="menu-row">
				<button class="btn" data-nav id="btn-options">Options</button>
				<button class="btn" data-nav id="btn-controls">Controls</button>
			</div>
		</div>`,
		null,
		"screen-menu"
	);
	bind("[data-mode]", (el) => {
		state.mode = el.dataset.mode as Mode;
		if (state.mode === "online") showOnline();
		else showCharacterSelect();
	});
	bind("#btn-options", () => showOptions());
	bind("#btn-controls", () => showControls(showMainMenu));
}

function showCharacterSelect() {
	const cards = CHARACTERS.map(
		(c) => h`<button class="char-card${c.id === state.charN ? " selected" : ""}" data-nav data-char="${c.id}" style="--accent:${c.color}"
			${c.id === state.charN ? "data-autofocus" : ""}>
			<img src="${portrait(c.id)}" alt="" />
			<span class="char-name">${c.name}</span>
			<span class="char-weight">${c.weight}</span>
		</button>`
	).join("");
	setScreen(
		h`<div class="panel wide">
			<h2 class="screen-title"><span class="step">${modeLabel()}</span>Choose your driver</h2>
			<div class="char-grid">${cards}</div>
			<div class="menu-row"><button class="btn" data-nav id="btn-back">← Back</button></div>
		</div>`,
		charBack,
		"screen-menu"
	);
	bind("[data-char]", (el) => {
		const id = Number(el.dataset.char);
		if (id !== state.charN) state.kartSlot = 0;
		state.charN = id;
		showKartSelect();
	});
	bind("#btn-back", () => charBack());
}

function charBack() {
	if (state.mode === "online") showLobby();
	else showMainMenu();
}

function statBars(stats: KartStats) {
	const rows: [keyof KartStats, string][] = [
		["speed", "Speed"],
		["accel", "Acceleration"],
		["weight", "Weight"],
		["handling", "Handling"],
		["drift", "Drift"],
		["turbo", "Mini-Turbo"],
	];
	return rows
		.map(([k, label]) => h`<div class="stat"><span>${label}</span><div class="bar"><div style="width:${stats[k] * 10}%"></div></div></div>`)
		.join("");
}

function showKartSelect() {
	const char = CHARACTERS.find((c) => c.id === state.charN)!;
	const cards = [0, 1, 2]
		.map((slot) => {
			const stats = state.statsFor!(kartIndex(char.id, slot));
			return h`<button class="kart-card${slot === state.kartSlot ? " selected" : ""}" data-nav data-slot="${slot}" ${slot === state.kartSlot ? "data-autofocus" : ""}>
				<span class="kart-name">${KART_SLOT_NAMES[slot]}</span>
				${statBars(stats)}
			</button>`;
		})
		.join("");
	setScreen(
		h`<div class="panel wide" style="--accent:${char.color}">
			<h2 class="screen-title"><span class="step">${modeLabel()}</span>
				<img class="title-portrait" src="${portrait(char.id)}" alt="" />${escapeHtml(char.name)} — choose your kart</h2>
			<div class="kart-grid">${cards}</div>
			<div class="menu-row"><button class="btn" data-nav id="btn-back">← Back</button></div>
		</div>`,
		showCharacterSelect,
		"screen-menu"
	);
	bind("[data-slot]", (el) => {
		state.kartSlot = Number(el.dataset.slot);
		if (state.mode === "online") {
			state.net?.setPick(state.charN, kartIndex(state.charN, state.kartSlot));
			showLobby();
		} else showCupSelect();
	});
	bind("#btn-back", () => showCharacterSelect());
}

function showCupSelect() {
	const cupCard = (cup: CupInfo, i: number) => h`<button class="cup-card${cup.retro ? " retro" : ""}" data-nav data-cup="${i}" style="--accent:${cup.color}" ${i === state.cupIndex ? "data-autofocus" : ""}>
			<span class="cup-icon">${cup.icon}</span>
			<span class="cup-name">${cup.name}</span>
			<span class="cup-courses">${cup.courses.map((c) => escapeHtml(c.name)).join("<br>")}</span>
		</button>`;
	const cupRow = (retro: boolean) =>
		CUPS.map((cup, i) => (cup.retro === retro ? cupCard(cup, i) : "")).join("");
	setScreen(
		h`<div class="panel wide">
			<h2 class="screen-title"><span class="step">${modeLabel()}</span>${state.mode === "gp" ? "Choose a cup" : "Choose a cup, then a course"}</h2>
			<div class="cup-section-label">Nitro Grand Prix</div>
			<div class="cup-grid">${cupRow(false)}</div>
			<div class="cup-section-label">Retro Grand Prix</div>
			<div class="cup-grid">${cupRow(true)}</div>
			<div class="menu-row"><button class="btn" data-nav id="btn-back">← Back</button></div>
		</div>`,
		state.mode === "online" ? showLobby : showKartSelect,
		"screen-menu"
	);
	bind("[data-cup]", (el) => {
		state.cupIndex = Number(el.dataset.cup);
		if (state.mode === "gp") startGrandPrix(CUPS[state.cupIndex]);
		else showCourseSelect();
	});
	bind("#btn-back", () => (state.mode === "online" ? showLobby() : showKartSelect()));
}

function showCourseSelect() {
	const cup = CUPS[state.cupIndex];
	const courses = cup.courses
		.map(
			(c, i) => h`<button class="course-card" data-nav data-course="${c.id}" ${i === 0 ? "data-autofocus" : ""}>
			<span class="course-num">${i + 1}</span><span class="course-name">${escapeHtml(c.name)}</span>
		</button>`
		)
		.join("");
	setScreen(
		h`<div class="panel" style="--accent:${cup.color}">
			<h2 class="screen-title"><span class="step">${modeLabel()}</span>${cup.icon} ${cup.name}</h2>
			<div class="course-list">${courses}</div>
			<div class="menu-row"><button class="btn" data-nav id="btn-back">← Back</button></div>
		</div>`,
		showCupSelect,
		"screen-menu"
	);
	bind("[data-course]", (el) => {
		state.courseId = Number(el.dataset.course);
		if (state.mode === "online") {
			state.net?.setSettings({ courseId: state.courseId });
			showLobby();
		} else startRace(state.courseId, buildSetup());
	});
	bind("#btn-back", () => showCupSelect());
}

function showOptions() {
	const laps = MKDSCONST.MAX_LAP;
	setScreen(
		h`<div class="panel">
			<h2 class="screen-title">Options</h2>
			<div class="option-row"><span>Laps</span>
				<button class="btn toggle${laps === 3 ? " on" : ""}" data-nav data-autofocus data-laps="3">3</button>
				<button class="btn toggle${laps === 5 ? " on" : ""}" data-nav data-laps="5">5</button></div>
			${volumeSliders()}
			<div class="menu-row"><button class="btn" data-nav id="btn-back">← Back</button></div>
		</div>`,
		showMainMenu,
		"screen-menu"
	);
	bind("[data-laps]", (el) => {
		localStorage.setItem("CURRENTLAPTYPE", el.dataset.laps!);
		refreshSettings();
		showOptions();
	});
	bindVolumeSliders();
	bind("#btn-back", () => showMainMenu());
}

const VOLUME_LABELS: [keyof AudioVolume, string][] = [
	["master", "Master volume"],
	["music", "Music"],
	["sfx", "Sound effects"],
];

function volumeSliders() {
	return VOLUME_LABELS.map(([key, label]) => {
		const v = Math.round(nitroAudio.volume[key] * 100);
		return h`<label class="vol-row"><span>${label}</span>
			<input type="range" min="0" max="100" step="5" value="${v}" data-nav data-vol="${key}" aria-label="${label}" />
			<output>${v}%</output></label>`;
	}).join("");
}

function bindVolumeSliders() {
	root.querySelectorAll<HTMLInputElement>("[data-vol]").forEach((el) => {
		el.addEventListener("input", () => {
			nitroAudio.setVolume({ [el.dataset.vol!]: Number(el.value) / 100 });
			el.nextElementSibling!.textContent = el.value + "%";
		});
	});
}

/** Volume screen for the in-race menus. */
function showVolume(back: () => void) {
	setScreen(
		h`<div class="panel">
			<h2 class="screen-title">Volume</h2>
			${volumeSliders()}
			<div class="menu-row"><button class="btn" data-nav id="btn-back">← Back</button></div>
		</div>`,
		back,
		"screen-pause",
		"volume"
	);
	root.querySelector<HTMLElement>("[data-vol]")?.focus();
	bindVolumeSliders();
	bind("#btn-back", () => back());
}

function controlsTable() {
	return h`<table class="controls">
		<tr><th></th><th>Keyboard</th><th>Gamepad</th></tr>
		<tr><td>Accelerate</td><td><kbd>↑</kbd> <kbd>W</kbd> <kbd>X</kbd></td><td>A</td></tr>
		<tr><td>Brake / Reverse</td><td><kbd>↓</kbd> <kbd>S</kbd> <kbd>Z</kbd></td><td>B</td></tr>
		<tr><td>Steer</td><td><kbd>←</kbd><kbd>→</kbd> <kbd>A</kbd><kbd>D</kbd></td><td>Left stick / D-pad</td></tr>
		<tr><td>Hop / Drift</td><td><kbd>Space</kbd> <kbd>Shift</kbd> <kbd>C</kbd></td><td>RB / RT</td></tr>
		<tr><td>Use item</td><td><kbd>E</kbd> <kbd>Q</kbd> <kbd>V</kbd></td><td>LB / LT / X</td></tr>
		<tr><td>Throw backward</td><td>hold <kbd>↓</kbd> while using</td><td>stick down</td></tr>
		<tr><td>Pause</td><td><kbd>Esc</kbd> <kbd>P</kbd></td><td>Start</td></tr>
	</table>
	<p class="fineprint">Mini-turbo: hold drift and wiggle left-right until the sparks turn blue, then release.</p>`;
}

function showControls(back: () => void) {
	setScreen(
		h`<div class="panel">
			<h2 class="screen-title">Controls</h2>
			${controlsTable()}
			<div class="menu-row"><button class="btn" data-nav data-autofocus id="btn-back">← Back</button></div>
		</div>`,
		back,
		"screen-menu"
	);
	bind("#btn-back", () => back());
}

function modeLabel() {
	return { gp: "Grand Prix", vs: "VS Race", tt: "Time Trial", online: "Online" }[state.mode];
}

// ---------------------------------------------------------------- races

function playerSetup(): RacerSetup {
	return { charN: state.charN, kartN: kartIndex(state.charN, state.kartSlot) };
}

function buildSetup(): RaceSetup {
	if (state.mode === "tt") return { player: playerSetup(), opponents: [] };
	return { player: playerSetup(), opponents: randomOpponents(state.charN, 7) };
}

function startGrandPrix(cup: CupInfo) {
	const racers = [playerSetup(), ...randomOpponents(state.charN, 7)];
	state.gp = { cup, raceIndex: 0, racers, points: racers.map(() => 0), lastPoints: racers.map(() => 0) };
	startGpRace();
}

function startGpRace() {
	const gp = state.gp!;
	const course = gp.cup.courses[gp.raceIndex];
	showRaceIntro(`${gp.cup.icon} ${gp.cup.name} · Race ${gp.raceIndex + 1}/4`, course.name, () =>
		startRace(course.id, { player: gp.racers[0], opponents: gp.racers.slice(1) })
	);
}

function showRaceIntro(kicker: string, title: string, go: () => void) {
	setScreen(
		h`<div class="race-intro"><div class="kicker">${escapeHtml(kicker)}</div><div class="intro-title">${escapeHtml(title)}</div></div>`,
		null,
		"screen-intro"
	);
	setTimeout(go, 1400);
}

function startRace(courseId: number, setup: RaceSetup) {
	state.courseId = courseId;
	state.lastSetup = setup;
	hideScreen();
	loadScene(courseId, setup);
	state.racing = true;
	state.resultsShown = false;
	state.inPauseMenu = false;
	hud.hidden = false;
	buildHud();
	renderHud();
}

let lastLapCount = -1;
let minimap: Minimap | null = null;

function portraitImage(charN: number) {
	const img = new Image();
	img.src = portrait(charN);
	return img;
}

/** Builds the top-right race card: minimap, timer and lap splits. */
function buildHud() {
	const scene = win.mainScene!;
	const course = scene.activeScene;
	const racers = course.karts.map((kart, i) => ({
		kart,
		color: CHARACTERS.find((c) => c.id === scene.chars[i])?.color ?? "#888",
		portrait: portraitImage(scene.chars[i]),
		isPlayer: kart === scene.myKart,
	}));
	minimap = new Minimap(course, racers);
	const best = state.mode === "tt" ? bestTime(state.courseId) : null;
	hud.innerHTML = h`<div class="hud-card">
		<div class="hud-label">${escapeHtml(courseName(state.courseId))}</div>
		<div class="hud-map"></div>
		<div class="hud-time" id="hud-time">${formatTime(0)}</div>
		<div class="hud-laps" id="hud-laps"></div>
		${best != null ? h`<div class="hud-best"><span>Best</span><span>${formatTime(best)}</span></div>` : ""}
	</div>`;
	if (minimap.available) hud.querySelector(".hud-map")!.appendChild(minimap.canvas);
	else hud.querySelector(".hud-map")!.remove();
	lastLapCount = -1;
}

function renderHud() {
	const scene = win.mainScene;
	if (!scene) return;
	// Sit just under the engine's own "LAP x/3" counter, which scales with the window.
	hud.style.top = uiPx(40, getUiScale(window.innerWidth, window.innerHeight)) + "px";
	minimap?.draw();
	const time = hud.querySelector("#hud-time");
	if (time) time.textContent = formatTime(scene.raceTime);
	const laps = scene.lapTimes;
	if (laps.length !== lastLapCount) {
		lastLapCount = laps.length;
		const el = hud.querySelector("#hud-laps");
		if (el) el.innerHTML = laps.map((t, i) => h`<div><span>Lap ${i + 1}</span><span>${formatTime(t)}</span></div>`).join("");
	}
}

function bestTime(courseId: number): number | null {
	const v = localStorage.getItem(`mkdsweb.best.${courseId}.${MKDSCONST.MAX_LAP}`);
	return v == null ? null : Number(v);
}

function setPaused(paused: boolean) {
	win.gamePaused = paused;
	nitroAudio.setPaused(paused);
}

function showPauseMenu() {
	state.inPauseMenu = true;
	setPaused(true);
	setScreen(
		h`<div class="panel pause">
			<h2 class="screen-title">Paused</h2>
			<button class="btn btn-primary" data-nav data-autofocus id="btn-resume">Resume</button>
			<button class="btn" data-nav id="btn-restart">Restart race</button>
			<button class="btn" data-nav id="btn-volume">Volume</button>
			<button class="btn" data-nav id="btn-controls">Controls</button>
			<button class="btn" data-nav id="btn-quit">Quit to menu</button>
		</div>`,
		resume,
		"screen-pause"
	);
	bind("#btn-resume", () => resume());
	bind("#btn-restart", () => {
		state.inPauseMenu = false;
		startRace(state.courseId, state.lastSetup!);
	});
	bind("#btn-volume", () => showVolume(showPauseMenu));
	bind("#btn-controls", () => showControls(showPauseMenu));
	bind("#btn-quit", () => {
		state.inPauseMenu = false;
		setPaused(false);
		showMainMenu();
	});
}

function resume() {
	state.inPauseMenu = false;
	hideScreen();
	setPaused(false);
}

function showResults() {
	state.resultsShown = true;
	const scene = win.mainScene!;
	const results = scene.getResults();
	const gp = state.gp;
	const player = results.find((r) => r.isPlayer)!;

	if (state.mode === "tt") {
		const time = player.time;
		const prev = bestTime(state.courseId);
		const isRecord = time != null && (prev == null || time < prev);
		if (isRecord) localStorage.setItem(`mkdsweb.best.${state.courseId}.${MKDSCONST.MAX_LAP}`, String(time));
		setScreen(
			h`<div class="panel results">
				<h2 class="screen-title">${isRecord ? "🎉 New record!" : "Finish!"}</h2>
				<div class="tt-time">${formatTime(time)}</div>
				<div class="hud-laps big">${scene.lapTimes.map((t, i) => h`<div><span>Lap ${i + 1}</span><span>${formatTime(t)}</span></div>`).join("")}</div>
				<div class="hud-best"><span>Best</span><span>${formatTime(isRecord ? time : prev)}</span></div>
				<div class="menu-row">
					<button class="btn btn-primary" data-nav data-autofocus id="btn-retry">Retry</button>
					<button class="btn" data-nav id="btn-course">Change course</button>
					<button class="btn" data-nav id="btn-menu">Main menu</button>
				</div>
			</div>`,
			null,
			"screen-results"
		);
	} else {
		if (gp) {
			gp.lastPoints = gp.racers.map(() => 0);
			for (const r of results) {
				const idx = scene.activeScene.karts.indexOf(r.kart);
				gp.lastPoints[idx] = GP_POINTS[r.place - 1] ?? 0;
				gp.points[idx] += gp.lastPoints[idx];
			}
		}
		setScreen(
			h`<div class="panel results wide">
				<h2 class="screen-title">${placeText(player.place)} place!</h2>
				${resultsTable(results, gp)}
				<div class="menu-row">${
					gp
						? h`<button class="btn btn-primary" data-nav data-autofocus id="btn-standings">Standings →</button>`
						: h`<button class="btn btn-primary" data-nav data-autofocus id="btn-retry">Race again</button>
						   <button class="btn" data-nav id="btn-course">Change course</button>`
				}<button class="btn" data-nav id="btn-menu">Main menu</button></div>
			</div>`,
			null,
			"screen-results"
		);
	}
	bind("#btn-retry", () => startRace(state.courseId, state.mode === "tt" ? state.lastSetup! : buildSetup()));
	bind("#btn-course", () => showCupSelect());
	bind("#btn-menu", () => showMainMenu());
	bind("#btn-standings", () => showStandings());
}

function placeText(p: number) {
	return p + (p === 1 ? "st" : p === 2 ? "nd" : p === 3 ? "rd" : "th");
}

function resultsTable(results: RaceResult[], gp: GrandPrix | null) {
	const scene = win.mainScene!;
	return h`<div class="results-table">${results
		.map((r) => {
			const idx = scene.activeScene.karts.indexOf(r.kart);
			return h`<div class="result-row${r.isPlayer ? " me" : ""}">
				<span class="place">${r.place}</span>
				<img src="${portrait(r.charN)}" alt="" />
				<span class="name">${characterName(r.charN)}${r.isPlayer ? " (You)" : ""}</span>
				<span class="time">${formatTime(r.time)}</span>
				${gp ? h`<span class="pts">+${gp.lastPoints[idx]}</span>` : ""}
			</div>`;
		})
		.join("")}</div>`;
}

function showStandings() {
	const gp = state.gp!;
	const order = gp.racers.map((r, i) => ({ r, i, pts: gp.points[i] })).sort((a, b) => b.pts - a.pts || a.i - b.i);
	const done = gp.raceIndex === 3;
	const myRank = order.findIndex((o) => o.i === 0) + 1;
	const trophy = myRank === 1 ? "🥇 Gold trophy!" : myRank === 2 ? "🥈 Silver trophy!" : myRank === 3 ? "🥉 Bronze trophy!" : "No trophy this time";
	setScreen(
		h`<div class="panel results wide">
			<h2 class="screen-title"><span class="step">${gp.cup.icon} ${gp.cup.name}</span>${done ? trophy : `Standings after race ${gp.raceIndex + 1}`}</h2>
			<div class="results-table">${order
				.map(
					(o, rank) => h`<div class="result-row${o.i === 0 ? " me" : ""}">
				<span class="place">${rank + 1}</span>
				<img src="${portrait(o.r.charN)}" alt="" />
				<span class="name">${characterName(o.r.charN)}${o.i === 0 ? " (You)" : ""}</span>
				<span class="pts total">${o.pts} pts</span>
			</div>`
				)
				.join("")}</div>
			<div class="menu-row">${
				done
					? h`<button class="btn btn-primary" data-nav data-autofocus id="btn-again">Play cup again</button>`
					: h`<button class="btn btn-primary" data-nav data-autofocus id="btn-next">Next race →</button>`
			}<button class="btn" data-nav id="btn-menu">Main menu</button></div>
		</div>`,
		null,
		"screen-results"
	);
	bind("#btn-next", () => {
		gp.raceIndex++;
		startGpRace();
	});
	bind("#btn-again", () => startGrandPrix(gp.cup));
	bind("#btn-menu", () => showMainMenu());
}


// ---------------------------------------------------------------- online

function savedName() {
	try {
		return localStorage.getItem("mkdsweb.name") || "";
	} catch {
		return "";
	}
}

function showOnline(error = "") {
	setScreen(
		h`<div class="panel">
			<h2 class="screen-title"><span class="step">Online</span>Race your friends</h2>
			<label class="field"><span>Your name</span><input id="in-name" maxlength="16" placeholder="Player" value="${escapeHtml(savedName())}" /></label>
			<button class="btn btn-primary" data-nav data-autofocus id="btn-host">Host a room</button>
			<div class="join-row">
				<input id="in-code" maxlength="5" placeholder="ROOM CODE" autocomplete="off" spellcheck="false" />
				<button class="btn" data-nav id="btn-join">Join</button>
			</div>
			<p class="fineprint" id="online-status">${error ? h`<span class="error">${escapeHtml(error)}</span>` : "Everyone needs their own copy of the game (ROM). The host shares the room code."}</p>
			<div class="menu-row"><button class="btn" data-nav id="btn-back">← Back</button></div>
		</div>`,
		showMainMenu,
		"screen-menu",
		"online"
	);
	const nameIn = root.querySelector<HTMLInputElement>("#in-name")!;
	const codeIn = root.querySelector<HTMLInputElement>("#in-code")!;
	codeIn.addEventListener("input", () => (codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, "")));
	codeIn.addEventListener("keydown", (e) => e.key === "Enter" && root.querySelector<HTMLElement>("#btn-join")!.click());
	const me = () => {
		const name = nameIn.value.trim().slice(0, 16) || "Player";
		try {
			localStorage.setItem("mkdsweb.name", name);
		} catch {
			/* private mode */
		}
		return { name, charN: state.charN, kartN: kartIndex(state.charN, state.kartSlot) };
	};
	const busy = (text: string) => {
		root.querySelector("#online-status")!.textContent = text;
		root.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.disabled = true));
	};
	bind("#btn-host", async () => {
		busy("Creating room…");
		try {
			enterRoom(await NetGame.host(me()));
		} catch (e) {
			showOnline(String((e as Error).message || e));
		}
	});
	bind("#btn-join", async () => {
		const code = codeIn.value.trim();
		if (code.length < 4) return codeIn.focus();
		busy("Joining room " + code + "…");
		try {
			enterRoom(await NetGame.join(code, me()));
		} catch (e) {
			showOnline(String((e as Error).message || e));
		}
	});
	bind("#btn-back", () => showMainMenu());
}

function enterRoom(net: NetGame) {
	state.net = net;
	state.leaving = false;
	net.onLobby = () => state.screen === "lobby" && showLobby();
	net.onStart = (info, racers, slot) => onNetStart(info, racers, slot);
	net.onGo = () => {
		hideScreen();
		win.mainScene?.startRace();
	};
	net.onResults = (order) => showNetResults(order);
	net.onWaiting = (names) => {
		const el = state.screen === "loading" ? root.querySelector(".intro-title") : null;
		if (el && names.length) el.textContent = "Waiting for " + names.join(", ") + "…";
	};
	net.onBackToLobby = () => {
		state.racing = false;
		hud.hidden = true;
		showLobby();
	};
	net.onClosed = (reason) => {
		state.net = null;
		hud.hidden = true;
		startAttract();
		if (state.leaving) showMainMenu();
		else showOnline(reason);
	};
	showLobby();
}

function leaveRoom() {
	state.leaving = true;
	state.net?.leave();
}

function showLobby() {
	const net = state.net;
	if (!net) return showOnline();
	const s = net.settings;
	const course = courseName(s.courseId);
	const rows = net.players
		.map(
			(p) => h`<div class="result-row${p.id === net.transport.myId ? " me" : ""}">
			<span class="place">${p.host ? "👑" : "🏁"}</span>
			<img src="${portrait(p.charN)}" alt="" />
			<span class="name">${escapeHtml(p.name)}${p.id === net.transport.myId ? " (You)" : ""}</span>
			<span class="time">${characterName(p.charN)} · ${KART_SLOT_NAMES[p.kartN % 3]}</span>
		</div>`
		)
		.join("");
	const hostControls = net.isHost
		? h`<div class="option-row"><span>Course</span><button class="btn" data-nav id="btn-course">${escapeHtml(course)} ✎</button></div>
			<div class="option-row"><span>Laps</span>
				<button class="btn toggle${s.laps === 3 ? " on" : ""}" data-nav data-laps="3">3</button>
				<button class="btn toggle${s.laps === 5 ? " on" : ""}" data-nav data-laps="5">5</button></div>
			<div class="option-row"><span>Fill with CPUs</span>
				<button class="btn toggle${s.cpus ? " on" : ""}" data-nav data-cpus="1">On</button>
				<button class="btn toggle${!s.cpus ? " on" : ""}" data-nav data-cpus="0">Off</button></div>`
		: h`<div class="option-row"><span>Course</span><span class="lobby-value">${escapeHtml(course)} · ${s.laps} laps${s.cpus ? " · CPUs" : ""}</span></div>`;
	setScreen(
		h`<div class="panel wide lobby">
			<h2 class="screen-title"><span class="step">Online room</span>Room code <span class="room-code" id="room-code" title="Click to copy">${net.code}</span></h2>
			<p class="fineprint">Friends join from Online → enter this code. ${net.players.length}/8 players.</p>
			<div class="results-table">${rows}</div>
			${hostControls}
			<div class="menu-row">
				${net.isHost ? h`<button class="btn btn-primary" data-nav data-autofocus id="btn-start">Start race</button>` : h`<span class="waiting">Waiting for the host to start…</span>`}
				<button class="btn" data-nav ${net.isHost ? "" : "data-autofocus"} id="btn-driver">Change driver</button>
				<button class="btn" data-nav id="btn-leave">Leave room</button>
			</div>
		</div>`,
		leaveRoom,
		"screen-menu",
		"lobby"
	);
	bind("#room-code", () => void navigator.clipboard?.writeText(net.code).catch(() => {}));
	bind("#btn-course", () => showCupSelect());
	bind("[data-laps]", (el) => net.setSettings({ laps: Number(el.dataset.laps) as 3 | 5 }));
	bind("[data-cpus]", (el) => net.setSettings({ cpus: el.dataset.cpus === "1" }));
	bind("#btn-start", () => net.hostStart((exclude, count) => randomOpponents(null, 12).filter((o) => !exclude.includes(o.charN)).slice(0, count)));
	bind("#btn-driver", () => showCharacterSelect());
	bind("#btn-leave", () => leaveRoom());
}

function onNetStart(info: StartInfo, racers: NonNullable<RaceSetup["net"]>["racers"], localSlot: number) {
	setScreen(
		h`<div class="race-intro"><div class="kicker">Online race · ${escapeHtml(courseName(info.courseId))}</div><div class="intro-title">Loading…</div></div>`,
		null,
		"screen-intro",
		"loading"
	);
	// Let the loading screen paint before the heavy synchronous course load.
	setTimeout(() => {
		localStorage.setItem("CURRENTLAPTYPE", String(info.laps));
		state.courseId = info.courseId;
		loadScene(info.courseId, { player: null, opponents: [], net: { racers, localIndex: localSlot } });
		state.racing = true;
		state.resultsShown = false;
		state.inPauseMenu = false;
		hud.hidden = false;
		buildHud();
		renderHud();
		state.net?.attachRace(win.mainScene!);
		if (state.screen === "loading") root.querySelector(".intro-title")!.textContent = "Waiting for other racers…";
	}, 60);
}

function racerName(slot: number) {
	const r = state.net?.start?.racers[slot];
	if (!r) return "???";
	return r.id ? r.name : characterName(r.charN);
}

function showOnlinePauseMenu() {
	state.inPauseMenu = true;
	setScreen(
		h`<div class="panel pause">
			<h2 class="screen-title">Online race</h2>
			<p class="fineprint">The race keeps going while this menu is open.</p>
			<button class="btn btn-primary" data-nav data-autofocus id="btn-resume">Resume</button>
			<button class="btn" data-nav id="btn-volume">Volume</button>
			<button class="btn" data-nav id="btn-controls">Controls</button>
			<button class="btn" data-nav id="btn-leave">Leave room</button>
		</div>`,
		closeOnlinePause,
		"screen-pause",
		"opause"
	);
	bind("#btn-resume", () => closeOnlinePause());
	bind("#btn-volume", () => showVolume(showOnlinePauseMenu));
	bind("#btn-controls", () => showControls(showOnlinePauseMenu));
	bind("#btn-leave", () => leaveRoom());
}

function closeOnlinePause() {
	state.inPauseMenu = false;
	hideScreen();
}

function showNetResults(order: NetResult[]) {
	const net = state.net!;
	state.resultsShown = true;
	state.inPauseMenu = false;
	hud.hidden = true;
	const racers = net.start!.racers;
	const myPlace = order.findIndex((o) => o.slot === net.localSlot) + 1;
	const rows = order
		.map((o, i) => {
			const r = racers[o.slot];
			const me = o.slot === net.localSlot;
			return h`<div class="result-row${me ? " me" : ""}">
				<span class="place">${i + 1}</span>
				<img src="${portrait(r.charN)}" alt="" />
				<span class="name">${escapeHtml(racerName(o.slot))}${me ? " (You)" : r.id ? "" : " · CPU"}</span>
				<span class="time">${formatTime(o.time)}</span>
			</div>`;
		})
		.join("");
	setScreen(
		h`<div class="panel results wide">
			<h2 class="screen-title"><span class="step">Online · ${escapeHtml(courseName(net.start!.courseId))}</span>${myPlace ? placeText(myPlace) + " place!" : "Results"}</h2>
			<div class="results-table">${rows}</div>
			<div class="menu-row">
				${net.isHost ? h`<button class="btn btn-primary" data-nav data-autofocus id="btn-lobby">Back to lobby</button>` : h`<span class="waiting">Waiting for the host…</span>`}
				<button class="btn" data-nav ${net.isHost ? "" : "data-autofocus"} id="btn-leave">Leave room</button>
			</div>
		</div>`,
		null,
		"screen-results",
		"netresults"
	);
	bind("#btn-lobby", () => net.hostBackToLobby());
	bind("#btn-leave", () => leaveRoom());
}

// ---------------------------------------------------------------- per-frame

function tick() {
	requestAnimationFrame(tick);
	Input.poll();

	if (state.racing && !state.resultsShown) {
		if (!state.inPauseMenu && Input.pressed("pause")) {
			if (state.mode === "online") showOnlinePauseMenu();
			else showPauseMenu();
			return;
		}
		// Online races keep running behind the menu.
		if (state.inPauseMenu && state.mode === "online") renderHud();
		if (!state.inPauseMenu) {
			renderHud();
			if (state.mode !== "online" && win.mainScene?.raceOver) {
				hud.hidden = true;
				showResults();
			}
			return;
		}
	}

	if (root.hidden) return;
	if (Input.pressed("up")) moveFocus(0, -1);
	if (Input.pressed("down")) moveFocus(0, 1);
	if (Input.pressed("left")) moveFocus(-1, 0);
	if (Input.pressed("right")) moveFocus(1, 0);
	if (Input.pressed("back") && onBack) {
		onBack();
		return;
	}
}

function onPadConfirm() {
	// Native keyboard activation handles Enter/Space; this covers gamepad A.
	const pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];
	return pads.some((p) => p?.buttons[0]?.pressed);
}

let padWasDown = false;
function padClickLoop() {
	requestAnimationFrame(padClickLoop);
	const down = onPadConfirm();
	if (down && !padWasDown && !root.hidden) {
		(document.activeElement as HTMLElement | null)?.click();
	}
	padWasDown = down;
}

// ---------------------------------------------------------------- item screen effects

const STAR_MUSIC = 73;
let starMusic: nitroAudioSound | null = null;

function screenFx(id: string) {
	let el = document.getElementById(id);
	if (!el) {
		el = document.createElement("div");
		el.id = id;
		document.body.appendChild(el);
	}
	return el;
}

function setupItemFx() {
	ItemEffects.ui = {
		flash() {
			const el = screenFx("fx-flash");
			el.classList.remove("on");
			void el.offsetWidth; // restart the animation
			el.classList.add("on");
		},
		ink(frames) {
			const el = screenFx("fx-ink");
			el.innerHTML = Array.from({ length: 9 }, () => {
				const size = 18 + Math.random() * 26;
				return `<span style="left:${Math.random() * 90 - 5}%;top:${Math.random() * 80 - 5}%;width:${size}vmin;height:${size * (0.8 + Math.random() * 0.4)}vmin"></span>`;
			}).join("");
			el.style.setProperty("--ink-time", frames / 60 + "s");
			el.classList.remove("on");
			void el.offsetWidth;
			el.classList.add("on");
		},
	};
	// Star music while your own kart is invincible.
	Kart.onFxChange = (kart, fx, active) => {
		const scene = win.mainScene;
		if (fx !== "star" || !scene || kart !== scene.myKart) return;
		const course = scene.activeScene;
		if (active) {
			if (course.musicPlayer) nitroAudio.kill(course.musicPlayer);
			if (starMusic) nitroAudio.kill(starMusic);
			starMusic = SoundBox.music(STAR_MUSIC);
		} else {
			if (starMusic) nitroAudio.kill(starMusic);
			starMusic = null;
			if (!scene.playerFinished) course.musicPlayer = SoundBox.music(course.music);
		}
	};
}

export const Frontend = {
	init() {
		setupItemFx();
		root = document.getElementById("ui")!;
		hud = document.getElementById("race-hud")!;
		hud.hidden = true;
		win.gamePaused = false;
		Input.init();
		// Keep keyboard focus inside the menu when the mouse hovers buttons.
		root.addEventListener("mousemove", (e) => {
			if (document.activeElement instanceof HTMLInputElement) return; // don't steal focus while typing
			const el = (e.target as HTMLElement).closest<HTMLElement>("[data-nav]");
			if (el && !el.hasAttribute("disabled")) el.focus({ preventScroll: true });
		});
		requestAnimationFrame(tick);
		requestAnimationFrame(padClickLoop);
		void showTitle();
	},
};
