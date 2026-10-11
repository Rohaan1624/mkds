//item state for a kart. not an entity, just supplemental to one.

import { nitroAudio, nitroAudioSound } from "../audio/nitroAudio";
import { SoundBox } from "../audio/soundBox";
import { ItemController } from "../engine/itemController";
import { ItemEffects } from "./itemEffects";
import { rollItem } from "./itemOdds";
import { Item } from "./item";
import { Kart } from "./kart";

/** Items used straight from the slot instead of becoming an object on the track. */
const INSTANT_ITEMS = new Set<string | null>(["kinoko", "kinoko_group", "kinoko_p", "star", "thunder", "gesso", "teresa", "killer"]);
const GOLDEN_FRAMES = 450;

export class KartItems {
	static items = [
		"koura_g",
		"koura_r",
		"banana",
		"f_box",
		"bomb",
		"koura_group_g",
		"koura_group_r",
		"banana_group",
		"koura_w",
		"kinoko",
		"kinoko_group",
		"kinoko_p",
		"star",
		"thunder",
		"gesso",
		"teresa",
		"killer",
	];
	kart: Kart;
	scene: Scene;
	heldItem: Item | null;
	currentItem: string | null;
	empty: boolean;
	cycleTime: number;
	totalTime: number;
	private _maxItemTime: number;
	private _minItemTime: number;
	private _carouselSfx: nitroAudioSound | null;
	private _lastItemState: boolean;
	private _specialItems: string[];
	private _itemJustEquipped: boolean;
	private _itemReleaseDebounce: number;
	private static readonly ITEM_RELEASE_DEBOUNCE = 12;

	constructor(kart: Kart, scene: Scene) {
		this.kart = kart;
		this.scene = scene;

		this.heldItem = null; //held item, or item that is bound to us. (bound items have hold type 'func', eg. triple shell)
		this.currentItem = null; //string name for item
		this.empty = true;
		this.cycleTime = 0;
		this.totalTime = 230;

		this._maxItemTime = 230;
		this._minItemTime = 80;
		this._carouselSfx = null;
		this._lastItemState = false;
		this._specialItems = ["star"];
		this._itemJustEquipped = false;
		this._itemReleaseDebounce = 0;

		// var holdAppearDelay = 15;
		// var hurtExplodeDelay = 105; //turn right slightly, huge double backflip, small bounces.
		// var hurtFlipDelay = 80; //turn right slightly, bounce twice, forward flip
		// var hurtSpinDelay = 40; //counter clockwise spin
	}

	static randomItem(): string {
		const i = Math.floor(Math.random() * KartItems.items.length);
		return KartItems.items[i];
	}

	update(input: InputData) {
		this.tick();
		const pressed = input.item && !this._lastItemState;
		const released = this._lastItemState && !input.item;
		if (this._itemReleaseDebounce > 0) this._itemReleaseDebounce--;
		if (!this.empty) {
			if (this.currentItem == null) {
				//carousel
				this.cycleTime++;
				if (this.cycleTime >= this.totalTime) {
					if (this._carouselSfx != null) {
						nitroAudio.kill(this._carouselSfx);
					}
					//decide on an item, with the game's own odds for our position
					const racers = this.scene.karts.filter((k) => k.active).length;
					const item = rollItem(this.scene.gameRes, this.kart.placement || racers, racers);
					this._sfx(() => SoundBox.itemCarouselPick(this._specialItems.indexOf(item) != -1));
					this._setItem(item);
				} else {
					//if item button is pressed, we speed up the carousel
					if (pressed && this.heldItem == null) {
						this.totalTime = Math.max(this._minItemTime, this.totalTime - 20);
					}
				}
			} else if (this.heldItem == null) {
				if (pressed && INSTANT_ITEMS.has(this.currentItem)) {
					this._useInstant(this.currentItem);
				} else if (pressed) {
					//fire?
					this.heldItem = this._createItem();
					console.log(`${this.currentItem} drop`);
					this.currentItem = null;
					this.empty = true;

					if (this.heldItem.canBeHeld()) {
						this._itemJustEquipped = true;
					} else {
						this._release(input);
					}
				}
			}
		}

		//todo: if held item has been destroyed, stop holding it.

		if (this.heldItem != null) {
			if (this.heldItem.dead) {
				this.heldItem = null;
				this._itemJustEquipped = false;
			} else if (released && this.heldItem.canBeHeld()) {
				// Like MKDS: hold the button to drag an item behind you, let go to throw it.
				// Orbiting groups (triple shells) are deployed by the first press and fired by later ones.
				const deployPress = this._itemJustEquipped && this.heldItem.onlyHeld();
				if (!deployPress && this._itemReleaseDebounce <= 0) {
					this._release(input);
					this._itemReleaseDebounce = KartItems.ITEM_RELEASE_DEBOUNCE;
				}
				this._itemJustEquipped = false;
			}
		}
		this._lastItemState = input.item;
	}

	/** Lose whatever is being dragged/orbiting (when hit or falling off the course). */
	dropHeld() {
		const held = this.heldItem;
		if (held == null) return;
		this.heldItem = null;
		this._itemJustEquipped = false;
		const group = held.controller as unknown as { children?: (Item | null)[] };
		if (group.children) {
			for (const child of group.children) if (child && child.deadTimer === 0) child.deadTimer = 1;
			if (!held.dead) held.finalize();
		} else if (held.isDestructive()) {
			if (held.deadTimer === 0) held.deadTimer = 1;
		} else {
			held.release(-1); // bananas, fake boxes etc. fall where you were
		}
	}

	/** Uses left for multi-use items (triple mushroom). */
	uses = 0;
	/** Golden mushroom: frames left of unlimited boosts once first used. */
	goldenTime = 0;

	private _setItem(item: string) {
		this.currentItem = item;
		this.empty = false;
		this.uses = item === "kinoko_group" ? 3 : 1;
		this.goldenTime = 0;
	}

	private _clearItem() {
		this.currentItem = null;
		this.empty = true;
		this.uses = 0;
		this.goldenTime = 0;
	}

	private _useInstant(item: string) {
		switch (item) {
			case "kinoko":
			case "kinoko_group":
				this.kart.mushroomBoost();
				if (--this.uses <= 0) this._clearItem();
				break;
			case "kinoko_p":
				if (this.goldenTime <= 0) this.goldenTime = GOLDEN_FRAMES;
				this.kart.mushroomBoost();
				break;
			default:
				this._clearItem();
				ItemEffects.use(item, this.kart, this.scene);
		}
		this.kart.playCharacterSound(7);
	}

	/** Called every frame by the kart (golden mushroom timer). */
	tick() {
		if (this.goldenTime > 0 && --this.goldenTime === 0 && this.currentItem === "kinoko_p") this._clearItem();
	}

	/** Boo: hand over whatever is in the item slot (not rolling, not mid golden-mushroom). */
	takeItem(): string | null {
		if (this.empty || this.currentItem == null || this.goldenTime > 0) return null;
		const item = this.currentItem;
		this._clearItem();
		return item;
	}

	/** Boo: receive a stolen item if the slot is free. */
	giveItem(item: string) {
		if (!this.empty || this.heldItem != null) return;
		if (this._carouselSfx != null) nitroAudio.kill(this._carouselSfx);
		this._setItem(item);
	}

	getItem(_specific: string | null): boolean {
		if (!this.empty) {
			return false;
		} else {
			//begin carousel
			this.cycleTime = 0;
			this.totalTime = this._maxItemTime;
			// if (specific) {
			// 	this.specificItem = specific;
			// }
			this.empty = false;
			this._carouselSfx = this._sfx(() => SoundBox.itemCarousel());
			return true;
		}
	}

	private _sfx(play: () => nitroAudioSound | null): nitroAudioSound | null {
		if (this.kart.local) {
			return play();
		}
		return null;
	}

	private _createItem(): Item {
		const item = this.scene.items.createItem(this.currentItem!, this.kart);
		if (!this.kart.netPuppet) ItemController.net?.onSpawn(item);
		return item;
	}

	private _release(input: InputData): void {
		if (this.heldItem != null) {
			const hasMore = this.heldItem.release(input.airTurn);
			if (!hasMore || this.heldItem.dead) {
				this.heldItem = null;
			}
		}
		this.kart.playCharacterSound(7);
	}
}
