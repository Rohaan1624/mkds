//
// lakitu.ts
//--------------------
// Lakitu (jugem) fishing a kart back onto the course after it falls off. The kart drives the
// timing (see Kart rescue); this entity only follows it and flies away once the kart is dropped.
//

import type { courseScene } from "../engine/scenes/courseScene";
import { nsbca } from "../formats/nsbca";
import { nsbmd } from "../formats/nsbmd";
import { nsbtp } from "../formats/nsbtp";
import { nitroAnimator, nitroAnimator_matStack } from "../render/nitroAnimator";
import { nitroModel } from "../render/nitroModel";
import { nitroRender } from "../render/nitroRender";
import type { Kart } from "./kart";

/** Lakitu's fishing hook sits this far to his left and below him; offset him so the hook is over the kart. */
const HOOK_SIDE = 10;
const HOOK_BACK = 13;
const CARRY_HEIGHT = 27;
const FLY_AWAY_FRAMES = 50;

type LakituRes = { model: nitroModel; anim: nitroAnimator | null };
const resCache = new WeakMap<object, LakituRes>();

function loadRes(scene: courseScene): LakituRes {
	const key = scene.gameRes;
	let res = resCache.get(key);
	if (!res) {
		const race = scene.gameRes.Race;
		const bmd = new nsbmd(race.getFile("jg_mdl.nsbmd")!);
		const model = new nitroModel(bmd, null);
		const btp = race.getFile("jg_mdl.nsbtp");
		if (btp) model.loadTexPAnim(new nsbtp(btp));
		const bca = race.getFile("jg_mdl.nsbca");
		res = { model, anim: bca ? new nitroAnimator(bmd, new nsbca(bca)) : null };
		resCache.set(key, res);
	}
	return res;
}

export class Lakitu implements SceneEntity {
	transparent = false;
	private _scene: courseScene;
	private _kart: Kart;
	private _res: LakituRes;
	private _mat = mat4.create();
	private _pos: vec3;
	private _frame = 0;
	private _flyAway = -1;
	private _animMat: nitroAnimator_matStack | undefined;
	/** Set by the kart while it is being carried. */
	carrying = true;

	constructor(scene: courseScene, kart: Kart) {
		this._scene = scene;
		this._kart = kart;
		this._res = loadRes(scene);
		this._pos = vec3.create();
		this._follow();
	}

	private _follow() {
		const a = this._kart.angle;
		// Kart's right vector is (cos a, 0, sin a) and forward is (sin a, 0, -cos a).
		const x = Math.cos(a) * HOOK_SIDE - Math.sin(a) * HOOK_BACK;
		const z = Math.sin(a) * HOOK_SIDE + Math.cos(a) * HOOK_BACK;
		vec3.add(this._pos, this._kart.pos, [x, CARRY_HEIGHT, z]);
	}

	release() {
		this.carrying = false;
		this._flyAway = 0;
	}

	update() {
		this._frame++;
		if (this.carrying) {
			this._follow();
		} else if (this._flyAway >= 0) {
			this._flyAway++;
			// Up and back, accelerating.
			this._pos[1] += 0.5 + this._flyAway * 0.12;
			if (this._flyAway > FLY_AWAY_FRAMES) this._scene.removeEntity(this);
		}
		if (this._res.anim) this._animMat = this._res.anim.setFrame(0, 0, this._frame);
	}

	draw(view: mat4, pMatrix: mat4) {
		if (nitroRender.flagShadow) return;
		mat4.translate(this._mat, view, this._pos);
		mat4.rotateY(this._mat, this._mat, -this._kart.angle);
		mat4.scale(this._mat, this._mat, [16, 16, 16]);
		this._res.model.setFrame(this._frame);
		this._res.model.draw(this._mat, pMatrix, this._animMat);
	}
}
