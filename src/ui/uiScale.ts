/** DS bottom-screen reference resolution (race HUD). */
export const UI_REF_WIDTH = 256;
export const UI_REF_HEIGHT = 192;
export const GAME_ASPECT_RATIO = UI_REF_WIDTH / UI_REF_HEIGHT;

export function getUiScale(width: number, height: number): number {
	return Math.max(1, Math.floor(Math.min(width / UI_REF_WIDTH, height / UI_REF_HEIGHT)));
}

export function uiPx(value: number, scale: number): number {
	return Math.round(value * scale);
}

/** The 3D view fills the whole window (widescreen); only the DS-style HUD keeps its reference scale. */
export function fitCanvasToWindow(windowWidth: number, windowHeight: number) {
	return {
		width: Math.floor(windowWidth),
		height: Math.floor(windowHeight),
		offsetX: 0,
		offsetY: 0,
	};
}
