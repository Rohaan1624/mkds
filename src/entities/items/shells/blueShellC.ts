//
// blueShellC.ts
//--------------------
// Spiny (blue) shell: flies high over the course to whoever is in 1st place, dives and explodes, hitting
// everyone near the leader.
//

import { nitroAudio } from "../../../audio/nitroAudio";
import { SoundBox } from "../../../audio/soundBox";
import { MKDSCONST } from "../../../engine/mkdsConst";
import { NitroEmitter } from "../../../particles/nitroEmitter";
import { Item } from "../../item";
import { Kart } from "../../kart";

const CRUISE_HEIGHT = 45;
/** Units per frame: comfortably faster than any kart. */
const SPEED = 18;
const DIVE_DIST = 30;
const BLAST_RADIUS = 40;
const BLAST_EMITTERS = [53, 54];
const MAX_FRAMES = 60 * 40;

export class BlueShellC implements KartItemEntity {
	item: Item;
	canBeHeld = false;
	canBeDropped = false;
	isDestructive = false;
	isSolid = false;
	private _scene: Scene;
	private _frames = 0;
	private _exploded = false;

	constructor(item: Item, scene: Scene, _type: string) {
		this.item = item;
		this._scene = scene;
		this.item.colRadius = 3;
	}

	onlyHeld() {
		return false;
	}

	release(_forward: number) {
		// Launch straight up from the kart.
		this.item.pos = vec3.add(vec3.create(), this.item.owner.pos, [0, 6, 0]);
		this.item.enablePhysics = false;
		this.item.safeKart = null;
		this.sound = SoundBox.redShellFly(this.item);
		return false;
	}

	sound: ReturnType<typeof SoundBox.redShellFly> = null;

	/** It flies over everything: no collisions on the way, only the blast at the end. */
	collideKart(_kart: Kart) {}
	collide(_obj: Item | Kart) {}

	private _leader(): Kart | null {
		let best: Kart | null = null;
		for (const k of this._scene.karts) {
			if (!k.active) continue;
			if (!best || k.placement < best.placement) best = k;
		}
		return best;
	}

	update(_scene: Scene) {
		if (this.item.held || this._exploded || this.item.deadTimer > 0) return;
		this.item.enablePhysics = false;
		this.item.holdTime = 0;
		const target = this._leader();
		if (!target || ++this._frames > MAX_FRAMES) {
			this.item.deadTimer = 1;
			return;
		}
		const pos = this.item.pos;
		const dx = target.pos[0] - pos[0];
		const dz = target.pos[2] - pos[2];
		const flat = Math.hypot(dx, dz);
		// Climb to cruise height above the leader's level, then dive once close.
		const wantY = flat < DIVE_DIST ? target.pos[1] : target.pos[1] + CRUISE_HEIGHT;
		const step = Math.min(SPEED, flat);
		this.item.vel = [(dx / (flat || 1)) * step, (wantY - pos[1]) * 0.15, (dz / (flat || 1)) * step];
		vec3.add(pos, pos, this.item.vel);
		// Check after moving: the leader keeps driving away, so a pre-move check would never quite land.
		const after = Math.hypot(target.pos[0] - pos[0], target.pos[2] - pos[2]);
		if (after < 10 && Math.abs(pos[1] - target.pos[1]) < 14) this._explode();
	}

	private _explode() {
		this._exploded = true;
		this.item.deadTimer = 1;
		const pos = vec3.clone(this.item.pos);
		for (const k of this._scene.karts) {
			if (k.active && vec3.dist(k.pos, pos) < BLAST_RADIUS) k.damage(MKDSCONST.DAMAGE_EXPLODE);
		}
		const at = { pos, vel: vec3.create(), mat: mat4.fromTranslation(mat4.create(), pos) };
		for (const id of BLAST_EMITTERS) this._scene.particles.push(new NitroEmitter(this._scene, at, id));
		SoundBox.shellDestroy(this.item);
	}

	onDie(_final: boolean) {
		if (this.sound) {
			nitroAudio.instaKill(this.sound);
			this.sound = null;
		}
	}

	draw(mvMatrix: mat4, pMatrix: mat4) {
		const mat = mat4.translate(mat4.create(), mvMatrix, vec3.add(vec3.create(), this.item.pos, [0, 3, 0]));
		mat4.rotateY(mat, mat, this._frames * 0.3);
		mat4.scale(mat, mat, [16, 16, 16]);
		this._scene.gameRes.items.blueShell.draw(mat, pMatrix);
	}
}
