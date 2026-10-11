import { SoundBox } from "../../../audio/soundBox";
import { MKDSCONST } from "../../../engine/mkdsConst";
import { NitroEmitter } from "../../../particles/nitroEmitter";
import { Item } from "../../item";
import { Kart } from "../../kart";

/** Frames after being thrown/dropped before the bomb goes off on its own. */
const FUSE_FRAMES = 3 * 60;
/** Karts (including the thrower) within this distance of the blast are blown up. */
const BLAST_RADIUS = 48;
/** RaceEffect.spa fire burst + shock ring. */
const BLAST_EMITTERS = [53, 54];

export class BombC implements KartItemEntity {
	item: Item;
	canBeHeld: boolean;
	canBeDropped: boolean;
	isDestructive: boolean;
	explodeTime: number;
	isSolid!: boolean;
	private _scene: Scene;
	private _fuse = -1;

	constructor(item: Item, scene: Scene, _type: string) {
		this.item = item;
		this._scene = scene;
		this.canBeHeld = true;
		this.canBeDropped = true;
		this.isDestructive = true;
		this.explodeTime = 0;
	}

	onlyHeld() {
		return false;
	}

	collideKart(kart: Kart) {
		this.item.deadTimer = 1;
		kart.damage(MKDSCONST.DAMAGE_EXPLODE);
	}

	onRest(_normal: vec3) {}

	update(_scene: Scene) {
		if (this.item.deadTimer > 0 && this.explodeTime == 0) {
			this._explode();
			return;
		}
		if (this.item.held) return;
		if (this._fuse < 0) this._fuse = FUSE_FRAMES;
		if (--this._fuse <= 0 && this.item.deadTimer === 0) {
			this.item.deadTimer = 1;
			this._explode();
			return;
		}
		if (this.item.colRadius < 6) {
			this.item.colRadius += 0.2;
			if (this.item.colRadius > 6) this.item.colRadius = 6;
		}
	}

	private _explode() {
		this.explodeTime = 1;
		const pos = vec3.clone(this.item.pos);
		for (const kart of this._scene.karts) {
			if (vec3.dist(kart.pos, pos) < BLAST_RADIUS) kart.damage(MKDSCONST.DAMAGE_EXPLODE);
		}
		// The blast also takes out other items caught in it.
		for (const other of this._scene.items.items) {
			if (other !== this.item && !other.held && other.deadTimer === 0 && vec3.dist(other.pos, pos) < BLAST_RADIUS) other.deadTimer = 1;
		}
		const at = { pos, vel: vec3.create(), mat: mat4.fromTranslation(mat4.create(), pos) };
		for (const id of BLAST_EMITTERS) this._scene.particles.push(new NitroEmitter(this._scene, at, id));
		SoundBox.shellDestroy(this.item);
	}
}
