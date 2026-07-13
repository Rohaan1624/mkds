import { MKDS_COLTYPE } from "../../engine/collisionTypes";
import { nkm_section_OBJI, nkm_section_POIT } from "../../formats/nkm";
import { nitroModel, nitromodel_BoundingCollisionModel } from "../../render/nitroModel";
import { nitroRender } from "../../render/nitroRender";
import { modelPolyLocalYBounds, modelWorldYExtent, nitroModelWorldYExtent } from "../../utils/modelLocalBounds";
import { Item } from "../item";
import { Kart } from "../kart";
import { ObjDecor } from "../objDecor";

/** Collision sphere radius. */
const WANWAN_COL_RAD = 512;
/** Base vertical hop amplitude while moving (world units). */
const WANWAN_HOP_AMP = 18;
/** Hop cycle speed (@ 60 fps); higher = more frequent hops. */
const WANWAN_HOP_SPEED = 0.14;
/** Visual blend toward hop height each frame (higher = snappier). */
const WANWAN_HOP_BLEND = 0.55;
/** Yaw catch-up per frame toward displacement axis (0–1; 1 = instant). */
const WANWAN_FACE_SMOOTH = 0.1;
/** Roll lean on sharp turns (degrees). */
const WANWAN_LEAN_AMP = 14;

/**
 * Chain Chomp base: orientation, point-to-point travel, hops, collision.
 *
 * Subclasses supply waypoints and their own chain simulation.
 */
abstract class WanwanBase extends ObjDecor {
	colRad: number;
	vel = vec3.create();

	protected readonly anchorPos: vec3;
	protected _speed = 0;
	protected _moveAxis = vec3.fromValues(0, 0, 1);
	protected _prevPos: vec3;
	protected _groundY = 0;

	protected _rngSeed = 0;
	protected _drawMat = mat4.create();
	private _prevMoveAxis = vec3.fromValues(0, 0, 1);
	private _orientMat = mat4.create();
	private _lookMat = mat4.create();
	private _axisScratch = vec3.create();
	private _facingYaw = 0;
	private _leanZ = 0;
	private _hopYOffset = 0;
	private _hopPhase = 0;
	private _hopAmp = WANWAN_HOP_AMP;
	private _colRes!: nitromodel_BoundingCollisionModel;
	private _colMat = mat4.create();
	private _colFrame = 0;

	constructor(obji: nkm_section_OBJI, scene: Scene) {
		super(obji, scene);
		this._staringAtCamera = false;
		this.collidable = true;
		this.colRad = WANWAN_COL_RAD;
		this.anchorPos = vec3.clone(obji.pos);
		this._prevPos = vec3.clone(this.pos);
		this._rngSeed = (obji.pos[0] * 17.31 + obji.pos[2] * 9.07) | 0;
	}

	protected finishMotionSetup() {
		this._initFacing();
	}

	protected abstract initMotion(obji: nkm_section_OBJI, scene: Scene): void;
	protected abstract stepMotion(): void;
	protected abstract motionIntent(): vec3 | null;

	protected initChainResources(_r: ProvidedRes, _scaleY: number) {}

	protected updateChain() {}

	abstract requireRes(): { mdl: { nsbmd: string }[]; other?: (string | null)[] };

	provideRes(r: ProvidedRes) {
		const scaleY = this.scale[1] * this._drawScale[1];
		this._groundY = this._modelGroundY(r.mdl[0], scaleY);

		this._res = r;
		for (let i = 0; i < r.mdl.length; i++) {
			this._clearBillboards(r.mdl[i]);
			this._resetDrawState(r.mdl[i]);
		}

		this._colRes = r.mdl[0].getBoundingCollisionModel(0, 0);
		for (let i = 0; i < this._colRes.dat.length; i++) {
			this._colRes.dat[i].CollisionType = MKDS_COLTYPE.KNOCKBACK_DAMAGE << 8;
		}

		this.initChainResources(r, scaleY);
		this._setColMat();
	}

	getCollision() {
		if (!this._colRes) return { tris: [], mat: this._colMat, frame: 0 };
		return { tris: this._colRes.dat, mat: this._colMat, frame: this._colFrame };
	}

	moveWith(obj: Kart | Item) {
		vec3.add(obj.pos, obj.pos, this.vel);
	}

	update(_scn?: Scene) {
		this.stepMotion();
		this._updateFacing();
		this._updateHop();
		this.updateChain();
		this._setColMat();
	}

	abstract draw(view: mat4, pMatrix: mat4): void;

	protected drawScaleVec(): vec3 {
		return vec3.scale(vec3.create(), vec3.mul(vec3.create(), this.scale, this._drawScale), 16);
	}

	protected drawChomp(view: mat4, pMatrix: mat4, scaleVec: vec3) {
		const p = this._chompDrawPos();
		mat4.translate(this._drawMat, view, p);
		mat4.mul(this._drawMat, this._drawMat, this._orientMat);
		if (this._leanZ !== 0) mat4.rotateZ(this._drawMat, this._drawMat, this._leanZ * (Math.PI / 180));
		mat4.scale(this._drawMat, this._drawMat, scaleVec);
		this._res.mdl[0].draw(this._drawMat, pMatrix);
	}

	protected pickRandomHopAmp() {
		this._rngSeed = (this._rngSeed * 1103515245 + 12345) | 0;
		const u = ((this._rngSeed >>> 16) & 0x7fff) / 0x7fff;
		const min = WANWAN_HOP_AMP * 0.55;
		const max = WANWAN_HOP_AMP * 1.35;
		this._hopAmp = min + u * (max - min);
	}

	protected _chompDrawPos(): vec3 {
		return [this.pos[0], this.pos[1] + this._groundY + this._hopYOffset, this.pos[2]];
	}

	protected _modelGroundY(mdl: nitroModel, scaleY: number): number {
		return -this._modelWorldYExtent(mdl, scaleY).bottom;
	}

	protected _modelWorldYExtent(mdl: nitroModel, scaleY: number) {
		const col = mdl.getBoundingCollisionModel(0, 0);
		if (col.dat.length > 0) {
			return nitroModelWorldYExtent(mdl, scaleY);
		}
		const poly = mdl.bmd.modelData.objectData[0].polys.objectData[0];
		const bounds = modelPolyLocalYBounds(poly.disp);
		return modelWorldYExtent(bounds.minY, bounds.maxY, scaleY);
	}

	protected _syncVelocity() {
		vec3.sub(this.vel, this.pos, this._prevPos);
		this._prevPos = vec3.clone(this.pos);
	}

	private _initFacing() {
		if (!this._facingAxisFromMotion(this._moveAxis)) {
			const yaw = (this.angle[1] * Math.PI) / 180;
			this._moveAxis[0] = Math.sin(yaw);
			this._moveAxis[1] = 0;
			this._moveAxis[2] = -Math.cos(yaw);
		}
		vec3.copy(this._prevMoveAxis, this._moveAxis);
		this._facingYaw = Math.atan2(this._moveAxis[0], -this._moveAxis[2]);
		this._buildOrientMat();
	}

	private _updateFacing() {
		if (!this._facingAxisFromMotion(this._axisScratch)) {
			this._leanZ *= 0.85;
			return;
		}

		const targetYaw = Math.atan2(this._axisScratch[0], -this._axisScratch[2]);
		let delta = targetYaw - this._facingYaw;
		while (delta > Math.PI) delta -= Math.PI * 2;
		while (delta < -Math.PI) delta += Math.PI * 2;

		if (WANWAN_FACE_SMOOTH >= 1) {
			this._facingYaw = targetYaw;
		} else {
			this._facingYaw += delta * WANWAN_FACE_SMOOTH;
		}

		this._moveAxis[0] = Math.sin(this._facingYaw);
		this._moveAxis[1] = 0;
		this._moveAxis[2] = -Math.cos(this._facingYaw);

		const cross = this._moveAxis[0] * this._prevMoveAxis[2] - this._moveAxis[2] * this._prevMoveAxis[0];
		const dot = this._moveAxis[0] * this._prevMoveAxis[0] + this._moveAxis[2] * this._prevMoveAxis[2];
		const turn = (Math.atan2(cross, dot) * 180) / Math.PI;
		this._leanZ = Math.max(-WANWAN_LEAN_AMP, Math.min(WANWAN_LEAN_AMP, turn * 0.35));
		vec3.copy(this._prevMoveAxis, this._moveAxis);
		this._buildOrientMat();
	}

	private _facingAxisFromMotion(out: vec3): boolean {
		const sp = Math.hypot(this.vel[0], this.vel[2]);
		if (sp > 0.01) {
			out[0] = -this.vel[0];
			out[1] = 0;
			out[2] = -this.vel[2];
			vec3.normalize(out, out);
			return true;
		}

		const intent = this.motionIntent();
		if (intent == null) return false;

		out[0] = -intent[0];
		out[1] = 0;
		out[2] = -intent[2];
		return true;
	}

	private _buildOrientMat() {
		mat4.lookAt(this._lookMat, [0, 0, 0], this._moveAxis, [0, 1, 0]);
		mat4.invert(this._orientMat, this._lookMat);
	}

	private _updateHop() {
		const moving = Math.hypot(this.vel[0], this.vel[2]) > 0.05;
		if (moving) {
			const prevHop = Math.floor(this._hopPhase / Math.PI);
			this._hopPhase += WANWAN_HOP_SPEED;
			if (Math.floor(this._hopPhase / Math.PI) !== prevHop) {
				this.pickRandomHopAmp();
			}

			const t = (this._hopPhase % Math.PI) / Math.PI;
			const lift = Math.sin(t * Math.PI);
			const target = lift * lift * this._hopAmp;
			this._hopYOffset += (target - this._hopYOffset) * WANWAN_HOP_BLEND;
		} else {
			this._hopPhase = 0;
			this._hopYOffset += (0 - this._hopYOffset) * WANWAN_HOP_BLEND;
		}
	}

	private _clearBillboards(mdl: nitroModel) {
		const bmd = mdl.bmd;
		bmd.hasBillboards = false;
		for (let i = 0; i < bmd.modelData.objectData.length; i++) {
			const objs = bmd.modelData.objectData[i].objects.objectData;
			for (let j = 0; j < objs.length; j++) {
				objs[j].billboardMode = 0;
			}
		}
	}

	private _resetDrawState(mdl: nitroModel) {
		const stacks = (mdl as unknown as { _matBuf: { built: boolean }[] })._matBuf;
		for (let i = 0; i < stacks.length; i++) {
			stacks[i].built = false;
		}
		mdl.billboardID = -1;
	}

	private _setColMat() {
		if (!this._colRes) return;
		const p = this._chompDrawPos();
		const mat = mat4.create();
		mat4.translate(mat, mat, p);
		mat4.mul(mat, mat, this._orientMat);
		mat4.scale(mat, mat, vec3.scale(vec3.create(), this.scale, 16));
		mat4.scale(this._colMat, mat, [this._colRes.scale, this._colRes.scale, this._colRes.scale]);
		this._colFrame++;
	}
}

/**
 * Chain Chomp chained to its stake (0x0196, old_luigi_gc).
 *
 * No PATH in the OBJI — picks random waypoints within chain reach.
 */
const CHAINED_CHAIN_LEN = 150;
const CHAINED_ROAM_SPEED = 1.5;
const CHAINED_ROAM_REST_FRAMES = 100;
const CHAINED_LINKS = 6;
const CHAINED_ROPE_RATIO = 0.88;
const CHAINED_GRAVITY = 5.2;
const CHAINED_GRAVITY_POST = 0.22;
const CHAINED_DAMPING = 0.82;
const CHAINED_CONSTRAINT_SOFT = 0.48;
const CHAINED_CONSTRAINT_ITERS = 10;
const CHAINED_HEAD_PULL = 0.28;
const CHAINED_HEAD_PIN = 0.92;
const CHAINED_NEAR_HEAD_PIN = 0.46;
const CHAINED_HEAD_VEL_BLEND = 0.55;
const CHAINED_MAX_SAG = 34;

export class WanwanChained extends WanwanBase {
	private _target = vec3.create();
	private _rest = 0;
	private _chainPos: vec3[] = [];
	private _chainPrev: vec3[] = [];
	private _chainHeadPrev = vec3.create();
	private _chainAnchorYOffset = 0;
	private _stakeGroundY = 0;
	private _chainLinkLiftY = 0;
	private _chainScratch = vec3.create();
	private _chainDrawScratch = vec3.create();

	constructor(obji: nkm_section_OBJI, scene: Scene) {
		super(obji, scene);
		this.initMotion(obji, scene);
		this.finishMotionSetup();
	}

	protected initMotion(_obji: nkm_section_OBJI, _scene: Scene) {
		this._speed = CHAINED_ROAM_SPEED;
		vec3.copy(this.pos, this.anchorPos);
		this._prevPos = vec3.clone(this.pos);
		this._pickRandomPointInChain(this._target);
	}

	protected stepMotion() {
		if (this._rest > 0) {
			this._rest--;
			this.vel = [0, 0, 0];
			return;
		}

		if (this._walkToward(this._target)) {
			this.vel = [0, 0, 0];
			this._rest = CHAINED_ROAM_REST_FRAMES;
			this._pickRandomPointInChain(this._target);
		}
	}

	protected motionIntent(): vec3 | null {
		const dx = this._target[0] - this.pos[0];
		const dz = this._target[2] - this.pos[2];
		const d = Math.hypot(dx, dz);
		if (d > 0.01) return [dx / d, 0, dz / d];
		return null;
	}

	protected initChainResources(r: ProvidedRes, scaleY: number) {
		this._chainLinkLiftY = this._modelWorldYExtent(r.mdl[1], scaleY).height * 0.5;
		if (r.mdl.length > 2) {
			this._stakeGroundY = this._modelGroundY(r.mdl[2], scaleY);
			const stakeWorld = this._modelWorldYExtent(r.mdl[2], scaleY);
			this._chainAnchorYOffset = this._stakeGroundY + stakeWorld.top;
		}
		this._ensureChainBuffers();
		this._reliftChain();
	}

	protected updateChain() {
		const head = this._chompDrawPos();
		const anchor = this._chainAnchorPos();
		const n = CHAINED_LINKS;
		const segLen = this._chainSegLen();
		const soft = CHAINED_CONSTRAINT_SOFT;
		const headVelX = head[0] - this._chainHeadPrev[0];
		const headVelZ = head[2] - this._chainHeadPrev[2];
		vec3.copy(this._chainHeadPrev, head);

		for (let i = 0; i < n; i++) {
			const p = this._chainPos[i];
			const prev = this._chainPrev[i];
			const t = (i + 1) / (n + 1);
			const velBlend = CHAINED_HEAD_VEL_BLEND * t * t;
			const vx = (p[0] - prev[0]) * CHAINED_DAMPING + headVelX * velBlend;
			const vy = (p[1] - prev[1]) * CHAINED_DAMPING;
			const vz = (p[2] - prev[2]) * CHAINED_DAMPING + headVelZ * velBlend;

			prev[0] = p[0];
			prev[1] = p[1];
			prev[2] = p[2];

			p[0] += vx;
			p[1] += vy - CHAINED_GRAVITY * (1 + t * 0.5);
			p[2] += vz;

			this._clampChainLinkY(p, head[1]);
		}

		for (let i = 0; i < n; i++) {
			const t = (i + 1) / (n + 1);
			const pull = CHAINED_HEAD_PULL * t * t * t;
			this._blendTowardXZ(this._chainPos[i], head, pull);
		}

		for (let k = 0; k < CHAINED_CONSTRAINT_ITERS; k++) {
			const headSoft = k === CHAINED_CONSTRAINT_ITERS - 1 ? 1 : soft;
			let prevPt = anchor;
			for (let i = 0; i < n; i++) {
				this._constrainMaxLen(prevPt, this._chainPos[i], segLen, soft);
				this._clampChainLinkY(this._chainPos[i], head[1]);
				prevPt = this._chainPos[i];
			}
			this._constrainMaxLen(head, this._chainPos[n - 1], segLen, headSoft);

			for (let i = n - 2; i >= 0; i--) {
				this._constrainMaxLen(this._chainPos[i + 1], this._chainPos[i], segLen, soft);
				this._clampChainLinkY(this._chainPos[i], head[1]);
			}
			this._constrainMaxLen(anchor, this._chainPos[0], segLen, soft);
			this._applyChainGravity(this._chainPos, 1, CHAINED_GRAVITY, CHAINED_GRAVITY_POST);
		}

		if (n >= 2) {
			this._blendTowardXZ(this._chainPos[n - 2], head, CHAINED_NEAR_HEAD_PIN);
			this._clampChainLinkY(this._chainPos[n - 2], head[1]);
		}
		this._blendToward(this._chainPos[n - 1], head, CHAINED_HEAD_PIN);
		this._clampChainLinkY(this._chainPos[n - 1], head[1]);
	}

	requireRes() {
		return {
			mdl: [{ nsbmd: "wanwan.nsbmd" }, { nsbmd: "wanwan_chain.nsbmd" }, { nsbmd: "wanwan_kui.nsbmd" }],
		};
	}

	draw(view: mat4, pMatrix: mat4) {
		nitroRender.setShadBias(0.001);
		const scaleVec = this.drawScaleVec();
		const cullWasEnabled = gl.isEnabled(gl.CULL_FACE);
		gl.disable(gl.CULL_FACE);

		this._drawBillboardPart(view, pMatrix, scaleVec, this._stakeDrawPos(), 2);
		this._drawChainLinks(view, pMatrix, scaleVec);
		this.drawChomp(view, pMatrix, scaleVec);

		if (cullWasEnabled) gl.enable(gl.CULL_FACE);
		nitroRender.resetShadOff();
	}

	private _drawChainLinks(view: mat4, pMatrix: mat4, scaleVec: vec3) {
		for (let i = 0; i < CHAINED_LINKS; i++) {
			const p = this._chainPos[i];
			this._chainDrawScratch[0] = p[0];
			this._chainDrawScratch[1] = p[1] + this._chainLinkLiftY;
			this._chainDrawScratch[2] = p[2];
			this._drawBillboardPart(view, pMatrix, scaleVec, this._chainDrawScratch, 1);
		}
	}

	private _chainAnchorPos(out = this._chainScratch): vec3 {
		out[0] = this.anchorPos[0];
		out[1] = this.anchorPos[1] + this._chainAnchorYOffset;
		out[2] = this.anchorPos[2];
		return out;
	}

	private _stakeDrawPos(out = this._chainScratch): vec3 {
		out[0] = this.anchorPos[0];
		out[1] = this.anchorPos[1] + this._stakeGroundY;
		out[2] = this.anchorPos[2];
		return out;
	}

	private _chainSegLen(): number {
		return (CHAINED_CHAIN_LEN * this._chainScaleXZ() * CHAINED_ROPE_RATIO) / (CHAINED_LINKS + 1);
	}

	private _clampChainLinkY(p: vec3, headY: number) {
		const anchorY = this.anchorPos[1] + this._chainAnchorYOffset;
		const floorY = Math.min(anchorY, headY) - CHAINED_MAX_SAG;
		if (p[1] < floorY) p[1] = floorY;
	}

	private _ensureChainBuffers() {
		while (this._chainPos.length < CHAINED_LINKS) {
			this._chainPos.push(vec3.create());
			this._chainPrev.push(vec3.create());
		}
		while (this._chainPos.length > CHAINED_LINKS) {
			this._chainPos.pop();
			this._chainPrev.pop();
		}
	}

	private _reliftChain() {
		const anchor = this._chainAnchorPos();
		for (let i = 0; i < CHAINED_LINKS; i++) {
			vec3.copy(this._chainPos[i], anchor);
			vec3.copy(this._chainPrev[i], anchor);
		}
		vec3.copy(this._chainHeadPrev, this._chompDrawPos());
	}

	private _walkToward(target: vec3, arriveDist = this._speed * 1.5): boolean {
		const dx = target[0] - this.pos[0];
		const dz = target[2] - this.pos[2];
		const dist = Math.hypot(dx, dz);

		if (dist < arriveDist) {
			this.pos[0] = target[0];
			this.pos[2] = target[2];
			this.pos[1] = this.anchorPos[1];
			this._clampToChain();
			this._syncVelocity();
			return true;
		}

		const step = this._speed / dist;
		this.pos[0] += dx * step;
		this.pos[2] += dz * step;
		this.pos[1] = this.anchorPos[1];
		this._clampToChain();
		this._syncVelocity();
		return false;
	}

	private _pickRandomPointInChain(out: vec3) {
		const maxR = CHAINED_CHAIN_LEN * this._chainScaleXZ();
		this._rngSeed = (this._rngSeed * 1103515245 + 12345) | 0;
		const u1 = ((this._rngSeed >>> 16) & 0x7fff) / 0x7fff;
		this._rngSeed = (this._rngSeed * 1103515245 + 12345) | 0;
		const u2 = ((this._rngSeed >>> 16) & 0x7fff) / 0x7fff;
		const angle = u1 * Math.PI * 2;
		const radius = maxR * Math.sqrt(u2);

		out[0] = this.anchorPos[0] + Math.sin(angle) * radius;
		out[1] = this.anchorPos[1];
		out[2] = this.anchorPos[2] + Math.cos(angle) * radius;
	}

	private _clampToChain() {
		const dx = this.pos[0] - this.anchorPos[0];
		const dy = this.pos[1] - this.anchorPos[1];
		const dz = this.pos[2] - this.anchorPos[2];
		const dist = Math.hypot(dx, dy, dz);
		const maxLen = CHAINED_CHAIN_LEN * this._chainScaleXZ();
		if (dist <= maxLen || dist < 0.001) return;

		const s = maxLen / dist;
		this.pos[0] = this.anchorPos[0] + dx * s;
		this.pos[1] = this.anchorPos[1] + dy * s;
		this.pos[2] = this.anchorPos[2] + dz * s;
	}

	private _chainScaleXZ(): number {
		return (this.scale[0] + this.scale[2]) / 2;
	}

	private _drawBillboardPart(view: mat4, pMatrix: mat4, scaleVec: vec3, pos: vec3, modelIndex: number) {
		mat4.translate(this._drawMat, view, pos);
		mat4.multiply(this._drawMat, this._drawMat, nitroRender.yBillboardMat);
		mat4.scale(this._drawMat, this._drawMat, scaleVec);
		this._res.mdl[modelIndex].draw(this._drawMat, pMatrix);
	}

	private _blendToward(out: vec3, target: vec3, t: number) {
		out[0] += (target[0] - out[0]) * t;
		out[1] += (target[1] - out[1]) * t;
		out[2] += (target[2] - out[2]) * t;
	}

	private _blendTowardXZ(out: vec3, target: vec3, t: number) {
		out[0] += (target[0] - out[0]) * t;
		out[2] += (target[2] - out[2]) * t;
	}

	private _constrainMaxLen(fixed: vec3, move: vec3, maxLen: number, soft: number) {
		const dx = move[0] - fixed[0];
		const dy = move[1] - fixed[1];
		const dz = move[2] - fixed[2];
		const d = Math.hypot(dx, dy, dz);
		if (d <= maxLen || d < 0.001) return;

		const s = maxLen / d;
		const tx = fixed[0] + dx * s;
		const ty = fixed[1] + dy * s;
		const tz = fixed[2] + dz * s;
		move[0] += (tx - move[0]) * soft;
		move[1] += (ty - move[1]) * soft;
		move[2] += (tz - move[2]) * soft;
	}

	private _applyChainGravity(links: vec3[], fromIndex: number, gravity: number, postScale: number) {
		const post = gravity * postScale;
		for (let i = fromIndex; i < links.length; i++) {
			links[i][1] -= post * (1 + (i - fromIndex) * 0.25);
		}
	}
}

/**
 * Released Chain Chomp without stake or chain (0x01a5, garden_course).
 *
 * Follows the PATH/POIT route linked in the OBJI.
 */
const RELEASED_ROUTE_SPEED = 0.9;

export class WanwanReleased extends WanwanBase {
	private _route: nkm_section_POIT[] = [];
	private _loopPath = false;
	private _segFrom = 0;
	private _segTo = 1;
	private _segT = 0;
	private _dir = 1;

	constructor(obji: nkm_section_OBJI, scene: Scene) {
		super(obji, scene);
		this.initMotion(obji, scene);
		this.finishMotionSetup();
	}

	protected initMotion(obji: nkm_section_OBJI, scene: Scene) {
		this._speed = RELEASED_ROUTE_SPEED;
		this._route = scene.getRoute(obji.routeID);
		const pathMeta = scene.nkm.sections.PATH.entries[obji.routeID];
		this._loopPath = pathMeta != null && pathMeta.loop !== 0;

		if (this._route.length > 0) {
			vec3.copy(this.pos, this._route[0].pos);
			this._prevPos = vec3.clone(this.pos);
		}
		if (this._route.length < 2) {
			this._segTo = 0;
		}
	}

	protected stepMotion() {
		if (this._route.length < 2) return;

		const from = this._route[this._segFrom].pos;
		const to = this._route[this._segTo].pos;
		const dist = vec3.distance(from, to);
		const step = dist > 0 ? this._speed / dist : 1;

		this._segT += step;
		if (this._segT >= 1) {
			this._segT = 0;
			vec3.copy(this.pos, to);
			this._segFrom = this._segTo;
			this._advanceSegment();
		} else {
			this.pos[0] = from[0] + (to[0] - from[0]) * this._segT;
			this.pos[1] = from[1] + (to[1] - from[1]) * this._segT;
			this.pos[2] = from[2] + (to[2] - from[2]) * this._segT;
		}

		this._syncVelocity();
	}

	protected motionIntent(): vec3 | null {
		if (this._route.length < 2) return null;

		const from = this._route[this._segFrom].pos;
		const to = this._route[this._segTo].pos;
		const dx = to[0] - from[0];
		const dz = to[2] - from[2];
		const d = Math.hypot(dx, dz);
		if (d > 0.01) return [dx / d, 0, dz / d];
		return null;
	}

	requireRes() {
		return {
			mdl: [{ nsbmd: "wanwan.nsbmd" }],
		};
	}

	draw(view: mat4, pMatrix: mat4) {
		nitroRender.setShadBias(0.001);
		const scaleVec = this.drawScaleVec();
		this.drawChomp(view, pMatrix, scaleVec);
		nitroRender.resetShadOff();
	}

	private _advanceSegment() {
		if (this._loopPath) {
			this._segTo = (this._segTo + 1) % this._route.length;
			return;
		}
		let next = this._segTo + this._dir;
		if (next >= this._route.length) {
			this._dir = -1;
			next = this._segTo - 1;
		} else if (next < 0) {
			this._dir = 1;
			next = this._segTo + 1;
		}
		this._segTo = next;
	}
}
