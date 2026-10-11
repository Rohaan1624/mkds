//
// itemOdds.ts
//--------------------
// Item box odds from the ROM's /Item/ItemSlotList.dat (MainRace.carc).
//
// Layout: 3-byte header [tables, positions (8), items (18)], then tables of 18 items x 8 positions, each
// position's weights summing to 200. Table 0 is the 8-racer race table. Item order is the game's internal one.
//

import type { IngameRes } from "../engine/ingameRes";

/** Internal MKDS item order -> our item type names. */
const ITEM_ORDER = [
	"koura_g",
	"koura_r",
	"banana",
	"f_box",
	"kinoko",
	"kinoko_group",
	"bomb",
	"koura_w",
	"thunder",
	"koura_group_g",
	"banana_group",
	"koura_group_r",
	"star",
	"kinoko_p",
	"killer",
	"gesso",
	"teresa",
	null, // unused slot
] as const;

const POSITIONS = 8;

let table: number[][] | null = null; // [position][item] weights

function load(res: IngameRes) {
	const file = res.MainRace.getFile("/Item/ItemSlotList.dat");
	if (!file) return null;
	const d = new Uint8Array(file);
	const items = d[2];
	const t: number[][] = [];
	for (let p = 0; p < POSITIONS; p++) {
		t.push([]);
		for (let i = 0; i < items; i++) t[p].push(d[3 + i * POSITIONS + p]);
	}
	return t;
}

/**
 * Picks an item for a kart in `place` (1-based) out of `racers`. Smaller races are mapped onto the
 * 8-position scale so last place always gets last-place odds.
 */
export function rollItem(res: IngameRes, place: number, racers: number): string {
	if (!table) table = load(res);
	if (!table) return "koura_g";
	const pos = racers <= 1 ? 0 : Math.round(((Math.max(1, Math.min(place, racers)) - 1) / (racers - 1)) * (POSITIONS - 1));
	const weights = table[pos];
	const total = weights.reduce((a, b, i) => a + (ITEM_ORDER[i] ? b : 0), 0);
	let r = Math.random() * total;
	for (let i = 0; i < weights.length; i++) {
		if (!ITEM_ORDER[i]) continue;
		r -= weights[i];
		if (r < 0) return ITEM_ORDER[i]!;
	}
	return "koura_g";
}
