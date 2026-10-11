//
// itemEffects.ts
//--------------------
// Items used straight from the item slot: Star, Bullet Bill, Boo, Lightning and Blooper.
// Effects on other karts are applied to the karts this client simulates; in multiplayer the same event is
// sent to the other clients (see src/net/netGame.ts), who apply it to theirs.
//

import { controlRaceCPU } from "../engine/controls/controlRaceCPU";
import { FX_FRAMES, Kart } from "./kart";

export type ItemEffectEvent =
	| { t: "thunder"; k: number }
	| { t: "ink"; k: number }
	| { t: "boo"; k: number; to: number }
	| { t: "booitem"; to: number; item: string };

type Ui = {
	/** Lightning: brief white flash. */
	flash(): void;
	/** Blooper: ink over the screen for this many frames. */
	ink(frames: number): void;
};

export const ItemEffects = {
	/** Multiplayer: send an event to the other clients. */
	net: null as ((ev: ItemEffectEvent) => void) | null,
	ui: null as Ui | null,

	use(item: string, kart: Kart, scene: Scene) {
		const slot = scene.karts.indexOf(kart);
		switch (item) {
			case "star":
				kart.startFx("star");
				break;
			case "teresa":
				kart.startFx("boo");
				ItemEffects._boo(kart, scene);
				break;
			case "killer": {
				const ai = new controlRaceCPU(scene.nkm);
				ai.setKart(kart);
				ai.snapToNearest();
				kart.startBill(ai);
				break;
			}
			case "thunder":
				ItemEffects.applyThunder(scene, kart);
				ItemEffects.net?.({ t: "thunder", k: slot });
				break;
			case "gesso":
				ItemEffects.applyInk(scene, kart);
				ItemEffects.net?.({ t: "ink", k: slot });
				break;
		}
	},

	/** Everyone but the user (on this client) spins out and shrinks. */
	applyThunder(scene: Scene, user: Kart) {
		for (const k of scene.karts) {
			if (k === user || k.netPuppet || !k.active) continue;
			k.items.dropHeld();
			k.thunderHit();
		}
		ItemEffects.ui?.flash();
	},

	/** Karts ahead of the user get inked. */
	applyInk(scene: Scene, user: Kart) {
		for (const k of scene.karts) {
			if (k === user || k.netPuppet || !k.active || k.placement >= user.placement) continue;
			if (k.fx.star > 0 || k.fx.bill > 0) continue;
			k.fx.ink = FX_FRAMES.ink;
			if (k.local) ItemEffects.ui?.ink(FX_FRAMES.ink);
		}
	},

	/** Boo steals the item of a random opponent (if they have one). */
	_boo(user: Kart, scene: Scene) {
		const others = scene.karts.filter((k) => k !== user && k.active);
		if (others.length === 0) return;
		// Prefer someone we can see holding an item; remote karts' slots are unknown here, so they're fair game too.
		const known = others.filter((k) => !k.netPuppet && k.items.currentItem != null);
		const target = known.length ? known[Math.floor(Math.random() * known.length)] : others[Math.floor(Math.random() * others.length)];
		if (target.netPuppet) {
			ItemEffects.net?.({ t: "boo", k: scene.karts.indexOf(user), to: scene.karts.indexOf(target) });
			return;
		}
		const item = target.items.takeItem();
		if (item) user.items.giveItem(item);
	},

	/** Network: apply an event from another client to the karts we simulate. */
	receive(ev: ItemEffectEvent, scene: Scene, reply: (ev: ItemEffectEvent) => void) {
		switch (ev.t) {
			case "thunder":
				ItemEffects.applyThunder(scene, scene.karts[ev.k]);
				break;
			case "ink":
				ItemEffects.applyInk(scene, scene.karts[ev.k]);
				break;
			case "boo": {
				const target = scene.karts[ev.to];
				if (!target || target.netPuppet) return;
				const item = target.items.takeItem();
				if (item) reply({ t: "booitem", to: ev.k, item });
				break;
			}
			case "booitem": {
				const k = scene.karts[ev.to];
				if (k && !k.netPuppet) k.items.giveItem(ev.item);
				break;
			}
		}
	},
};
