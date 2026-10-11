//
// input.ts
//--------------------
// Unified keyboard + gamepad input for racing and menu navigation.
//

export type Action = "accel" | "brake" | "drift" | "item" | "left" | "right" | "up" | "down" | "pause" | "confirm" | "back";

const KEY_BINDINGS: Record<Action, string[]> = {
	accel: ["ArrowUp", "KeyW", "KeyX"],
	brake: ["ArrowDown", "KeyS", "KeyZ"],
	drift: ["Space", "ShiftLeft", "ShiftRight", "KeyC"],
	item: ["KeyE", "KeyQ", "KeyV"],
	left: ["ArrowLeft", "KeyA"],
	right: ["ArrowRight", "KeyD"],
	up: ["ArrowUp", "KeyW"],
	down: ["ArrowDown", "KeyS"],
	pause: ["Escape", "KeyP"],
	confirm: ["Enter", "Space"],
	back: ["Escape", "Backspace"],
};

// Standard gamepad mapping: 0=A 1=B 2=X 3=Y 4=LB 5=RB 6=LT 7=RT 8=Back 9=Start 12-15=D-pad
const PAD_BINDINGS: Record<Action, number[]> = {
	accel: [0],
	brake: [1],
	drift: [5, 7],
	item: [4, 6, 2],
	left: [14],
	right: [15],
	up: [12],
	down: [13],
	pause: [9],
	confirm: [0],
	back: [1],
};

const STICK_DEADZONE = 0.2;
const MENU_STICK_THRESHOLD = 0.6;

const keysDown = new Set<string>();
// Keys that went down since the last poll, so taps shorter than a frame still register as presses.
const keysTapped = new Set<string>();
let padButtons: boolean[] = [];
let padAxes: number[] = [];
const prevHeld = new Map<Action, boolean>();
const pressedThisPoll = new Set<Action>();

function onKeyDown(e: KeyboardEvent) {
	if (isTextField(e.target)) return;
	if (!e.repeat) keysTapped.add(e.code);
	keysDown.add(e.code);
	// Stop the page scrolling or buttons re-firing while driving with arrows/space.
	// Space must still reach a focused menu button so it can activate it.
	const onButton = document.activeElement instanceof HTMLButtonElement;
	if (e.code.startsWith("Arrow") || (e.code === "Space" && !onButton)) e.preventDefault();
}

function onKeyUp(e: KeyboardEvent) {
	keysDown.delete(e.code);
}

function isTextField(target: EventTarget | null) {
	return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function readGamepad() {
	const pads = navigator.getGamepads ? navigator.getGamepads() : [];
	padButtons = [];
	padAxes = [];
	for (const pad of pads) {
		if (!pad) continue;
		pad.buttons.forEach((b, i) => (padButtons[i] = padButtons[i] || b.pressed || b.value > 0.5));
		pad.axes.forEach((a, i) => {
			if (Math.abs(a) > Math.abs(padAxes[i] ?? 0)) padAxes[i] = a;
		});
	}
}

function stickX() {
	const x = padAxes[0] ?? 0;
	return Math.abs(x) < STICK_DEADZONE ? 0 : x;
}

function stickY() {
	const y = padAxes[1] ?? 0;
	return Math.abs(y) < STICK_DEADZONE ? 0 : y;
}

function stickHeld(action: Action) {
	switch (action) {
		case "left":
			return stickX() < -MENU_STICK_THRESHOLD;
		case "right":
			return stickX() > MENU_STICK_THRESHOLD;
		case "up":
			return stickY() < -MENU_STICK_THRESHOLD;
		case "down":
			return stickY() > MENU_STICK_THRESHOLD;
		default:
			return false;
	}
}

export const Input = {
	init() {
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);
		window.addEventListener("blur", () => keysDown.clear());
	},

	/** Call once per frame before reading `pressed`. */
	poll() {
		readGamepad();
		pressedThisPoll.clear();
		for (const action of Object.keys(KEY_BINDINGS) as Action[]) {
			const now = Input.held(action);
			const tapped = KEY_BINDINGS[action].some((k) => keysTapped.has(k));
			if ((now && !prevHeld.get(action)) || tapped) pressedThisPoll.add(action);
			prevHeld.set(action, now);
		}
		keysTapped.clear();
	},

	held(action: Action) {
		if (KEY_BINDINGS[action].some((k) => keysDown.has(k))) return true;
		if (PAD_BINDINGS[action].some((b) => padButtons[b])) return true;
		return stickHeld(action);
	},

	/** True only on the poll where the action went from released to held. */
	pressed(action: Action) {
		return pressedThisPoll.has(action);
	},

	/** Analog steering, -1 (left) to 1 (right). */
	steer() {
		const digital = (Input.held("right") ? 1 : 0) - (Input.held("left") ? 1 : 0);
		return digital !== 0 ? digital : stickX();
	},

	/** Item aim / air tilt, -1 (back) to 1 (forward). */
	aim() {
		const digital = (Input.held("up") ? 1 : 0) - (Input.held("down") ? 1 : 0);
		return digital !== 0 ? digital : -stickY();
	},
};
