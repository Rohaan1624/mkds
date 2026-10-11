//
// roster.ts
//--------------------
// Display data for characters, karts, cups and courses. Indices match MKDSCONST.COURSES
// and IngameRes.charNames.
//

import type { IngameRes } from "../engine/ingameRes";

export type CharacterInfo = { id: number; name: string; weight: "Light" | "Medium" | "Heavy"; color: string };

// Order matches IngameRes.charNames. Shy Guy (12) is left out: it only has partial race data.
export const CHARACTERS: CharacterInfo[] = [
	{ id: 0, name: "Mario", weight: "Medium", color: "#e52521" },
	{ id: 7, name: "Luigi", weight: "Medium", color: "#3aa13a" },
	{ id: 4, name: "Peach", weight: "Light", color: "#f59bc4" },
	{ id: 6, name: "Yoshi", weight: "Light", color: "#5cc04c" },
	{ id: 2, name: "Toad", weight: "Light", color: "#3c7ee8" },
	{ id: 1, name: "Donkey Kong", weight: "Heavy", color: "#8a5a2b" },
	{ id: 5, name: "Wario", weight: "Heavy", color: "#e8c51c" },
	{ id: 3, name: "Bowser", weight: "Heavy", color: "#d9862a" },
	{ id: 9, name: "Daisy", weight: "Medium", color: "#f39a1e" },
	{ id: 8, name: "Dry Bones", weight: "Light", color: "#c9c3b0" },
	{ id: 10, name: "Waluigi", weight: "Medium", color: "#7b3fb5" },
	{ id: 11, name: "R.O.B.", weight: "Heavy", color: "#9aa3ad" },
];

export function characterName(id: number) {
	return CHARACTERS.find((c) => c.id === id)?.name ?? "???";
}

export const KART_SLOT_NAMES = ["Standard", "Custom A", "Custom B"];

/** IngameRes.getKart index for a character's kart slot (0 = standard). */
export function kartIndex(charId: number, slot: number) {
	return charId * 3 + slot;
}

export type KartStats = { speed: number; accel: number; weight: number; handling: number; drift: number; turbo: number };

/** Raw physics values for a kart, in "higher is better" form. Normalise with normaliseStats. */
export function rawKartStats(res: IngameRes, kartN: number): KartStats {
	const p = res.kartPhys.karts[kartN];
	return {
		speed: p.topSpeed,
		accel: p.accel1,
		weight: p.weight,
		handling: p.turnRate,
		drift: p.driftTurnRate,
		// Lower frame count = faster mini-turbo.
		turbo: -p.miniTurbo,
	};
}

/** Maps every stat to 1..10 across all selectable karts. */
export function normalisedKartStats(res: IngameRes) {
	const all = CHARACTERS.flatMap((c) => [0, 1, 2].map((s) => kartIndex(c.id, s)));
	const raw = new Map(all.map((k) => [k, rawKartStats(res, k)]));
	const keys = ["speed", "accel", "weight", "handling", "drift", "turbo"] as (keyof KartStats)[];
	const range = Object.fromEntries(
		keys.map((key) => {
			const vals = [...raw.values()].map((s) => s[key]);
			return [key, [Math.min(...vals), Math.max(...vals)]];
		})
	) as Record<keyof KartStats, [number, number]>;

	return (kartN: number): KartStats => {
		const s = raw.get(kartN) ?? rawKartStats(res, kartN);
		const out = {} as KartStats;
		for (const key of keys) {
			const [lo, hi] = range[key];
			out[key] = hi === lo ? 5 : 1 + Math.round(((s[key] - lo) / (hi - lo)) * 9);
		}
		return out;
	};
}

export type CourseInfo = { id: number; name: string };
export type CupInfo = { name: string; icon: string; color: string; retro: boolean; courses: CourseInfo[] };

export const CUPS: CupInfo[] = [
	{
		name: "Mushroom Cup",
		icon: "🍄",
		color: "#e5413a",
		retro: false,
		courses: [
			{ id: 0, name: "Figure-8 Circuit" },
			{ id: 1, name: "Yoshi Falls" },
			{ id: 2, name: "Cheep Cheep Beach" },
			{ id: 3, name: "Luigi's Mansion" },
		],
	},
	{
		name: "Flower Cup",
		icon: "🌼",
		color: "#f2a31b",
		retro: false,
		courses: [
			{ id: 4, name: "Desert Hills" },
			{ id: 5, name: "Delfino Square" },
			{ id: 6, name: "Waluigi Pinball" },
			{ id: 7, name: "Shroom Ridge" },
		],
	},
	{
		name: "Star Cup",
		icon: "⭐",
		color: "#f4d02b",
		retro: false,
		courses: [
			{ id: 8, name: "DK Pass" },
			{ id: 9, name: "Tick-Tock Clock" },
			{ id: 10, name: "Mario Circuit" },
			{ id: 11, name: "Airship Fortress" },
		],
	},
	{
		name: "Special Cup",
		icon: "👑",
		color: "#7d5cf0",
		retro: false,
		courses: [
			{ id: 12, name: "Wario Stadium" },
			{ id: 13, name: "Peach Gardens" },
			{ id: 14, name: "Bowser Castle" },
			{ id: 15, name: "Rainbow Road" },
		],
	},
	{
		name: "Shell Cup",
		icon: "🐚",
		color: "#38b56a",
		retro: true,
		courses: [
			{ id: 16, name: "SNES Mario Circuit 1" },
			{ id: 17, name: "N64 Moo Moo Farm" },
			{ id: 18, name: "GBA Peach Circuit" },
			{ id: 19, name: "GCN Luigi Circuit" },
		],
	},
	{
		name: "Banana Cup",
		icon: "🍌",
		color: "#e8cf2e",
		retro: true,
		courses: [
			{ id: 20, name: "SNES Donut Plains 1" },
			{ id: 21, name: "N64 Frappe Snowland" },
			{ id: 22, name: "GBA Bowser Castle 2" },
			{ id: 23, name: "GCN Baby Park" },
		],
	},
	{
		name: "Leaf Cup",
		icon: "🍃",
		color: "#5fae3c",
		retro: true,
		courses: [
			{ id: 24, name: "SNES Koopa Beach 2" },
			{ id: 25, name: "N64 Choco Mountain" },
			{ id: 26, name: "GBA Luigi Circuit" },
			{ id: 27, name: "GCN Mushroom Bridge" },
		],
	},
	{
		name: "Lightning Cup",
		icon: "⚡",
		color: "#3d8ff0",
		retro: true,
		courses: [
			{ id: 28, name: "SNES Choco Island 2" },
			{ id: 29, name: "N64 Banshee Boardwalk" },
			{ id: 30, name: "GBA Sky Garden" },
			{ id: 31, name: "GCN Yoshi Circuit" },
		],
	},
];

export function courseName(id: number) {
	for (const cup of CUPS) {
		const c = cup.courses.find((c) => c.id === id);
		if (c) return c.name;
	}
	return "Course " + id;
}

/** Grand Prix points for 1st..8th. */
export const GP_POINTS = [10, 8, 6, 4, 3, 2, 1, 0];
