import { MKDS_COLTYPE } from "../../engine/collisionTypes";
import { MKDSCONST } from "../../engine/mkdsConst";
import { courseScene } from "../../engine/scenes/courseScene";
import { nkm_section_OBJI, nkm_section_POIT } from "../../formats/nkm";
import { nitromodel_BoundingCollisionModel } from "../../render/nitroModel";
import { modelPolyLocalBounds, modelWorldYExtent } from "../../utils/modelLocalBounds";
import { Item } from "../item";
import { Kart } from "../kart";
import { ObjDecor } from "../objDecor";
import { Bound } from "./Bound";
import { Flipper } from "./Flipper";

/** Constant world speed (units/frame @ 60 fps) for the entire route. */
export const IRON_BALL_SPEED = 5;
/** Extra route speed at the start of a Bound bounce (@ 60 fps). */
export const IRON_BALL_BOUNCE_BOOST = 9;
/** Frames the bounce boost lasts (@ 60 fps). */
export const IRON_BALL_BOUNCE_DURATION = 18;
/** Cooldown before the same ball can bounce off a Bound again (@ 60 fps). */
export const IRON_BALL_BOUNCE_COOLDOWN = 30;
/** Per-frame lerp toward cruise speed while a boost decays (@ 60 fps). */
export const IRON_BALL_DECEL_RATE = 0.12;
/** Approximate reach of a Bound jelly block from its anchor (world units). */
export const BOUND_HIT_RADIUS = 100;
/** Fallback ball diameter when setting1 omits it (world units). */
export const IRON_BALL_DEFAULT_DIAMETER = 105;
/** setting2 low word values ≥ this encode a start delay (pinball_course route 5). */
const IRON_BALL_START_DELAY_LOW_THRESHOLD = 1000;

/**
 * Mobile iron ball hazard (0x01b0) on pinball_course.
 *
 * --- POIT layout (nkm.ts) ---
 *   pointInd  (u8)  — stable id within the route; matched by unknown1 branches
 *   unknown2  (u8)  — segment sub-type on the *target* point (see below)
 *   duration  (u16) — present in NKM; not used for speed (constant IRON_BALL_SPEED).
 *   unknown1  (u32) — when ≠ OBJI_ROUTE_NONE (0xffff), names a pointInd to branch to
 *
 * --- OBJI (pinball_course) ---
 *   setting1 & 0xffff → ball diameter in world units (105 or 110 on route balls)
 *   Start delay (frames @ 60 fps), three encodings on retail:
 *     1. setting1 >> 16           (ball 20, route 6: 3300 ≈ 55 s)
 *     2. setting2 & 0xffff ≥ 1000 (ball 15, route 5: 3300 ≈ 55 s)
 *     3. setting2 >> 16           (ball 12, route 4: 657 ≈ 11 s)
 *
 * --- Movement ---
 *   Cruise speed is `IRON_BALL_SPEED`. After a Bound / Flipper boost the target speed
 *   rises immediately, then decays linearly over `IRON_BALL_BOUNCE_DURATION` frames via
 *   `_bounceSpeedBonus()`. Actual travel speed (`_routeSpeed`) snaps up to the target
 *   on acceleration but eases back down with a simple per-frame lerp (`IRON_BALL_DECEL_RATE`)
 *   so the ball does not drop to cruise speed in a single frame when the boost ends.
 *
 *   Each update advances the ball by at most one step on the current segment:
 *     step = min(move, distance left on leg)
 *   where `move = _routeSpeed`. At most one POIT is crossed per
 *   frame (`_crossSegmentBoundary`). If `move` exceeds the remaining leg length (e.g.
 *   during a Bound boost on a short segment), the surplus is discarded for that frame
 *   rather than carried into the next segment in the same update. Retail route legs are
 *   long enough that this is never noticeable in practice, and it keeps `_stepRoute`
 *   free of per-frame loops.
 *
 * --- unknown1 (branch) ---
 *   Checked on the POIT just arrived at. When unknown1 names a pointInd (e.g. 72 on
 *   pts 75 and 80), the ball may divert to that index instead of walking to index + 1.
 *   On routes with branches: take the redirect every other visit; on the *last* POIT of
 *   the PATH, always take it. At end of PATH (no pending branch), restart from index 0.
 *
 * --- unknown2 ---
 *   u8 on the *target* POIT, value 0 or 1 on retail; set only on pts 35–36 / 68–69
 *   (the downhill roll pairs before each swing). Not used for movement here.
 *
 * --- Segment-end boost (Bound / Flipper) ---
 *   Each leg has a departure POIT (`_segFrom`) and an arrival POIT (`_segTo`). Before
 *   `provideRes`, `_entityByPoitPos` maps each route position `[x,y,z]` to a nearby Bound
 *   or Flipper. The map is built lazily on first use once every Bound/Flipper is in `colEnt`
 *   (IronBall OBJI can appear before Bound OBJI during course load).
 *
 *   Whenever a new leg opens after a POIT crossing:
 *     1. Departure has an entity → boost (Bound wobble / Flipper swing + speed boost).
 *     2. Departure is a Flipper → release its auto-swing hold.
 *     3. Arrival is a Flipper → hold auto-swing until the ball gets there.
 *
 *   Departure rules run as soon as the ball reaches a POIT; arrival rules run after the
 *   next `_segTo` is chosen. Zero-length branch snaps skip departure rules (same position).
 *
 * --- Rendering ---
 *   IronBall.nsbmd is a flat disc; _yOffset lifts the mesh so the path anchor is the
 *   bottom of the ball. _drawScale fits the disc to setting1 diameter.
 */
export class IronBallMobile extends ObjDecor {
	colRad: number;
	vel: vec3;
	knockbackDamage = MKDSCONST.DAMAGE_FLIP;
	private _route: nkm_section_POIT[];
	private _targetDiameter = 0;
	private _segFrom = 0;
	private _segTo = 1;
	/** Distance travelled along the current segment (world units). */
	private _segDist = 0;
	private _delayLeft = 0;
	/** Frames elapsed since movement started (excludes OBJI start delay). */
	private _routeFrame = 0;
	private _colRes!: nitromodel_BoundingCollisionModel;
	private _colMat: mat4;
	private _colFrame = 0;
	private _prevPos: vec3;
	private _scene: Scene;
	/** Frames left of temporary route acceleration after a Bound / Flipper boost (@ 60 fps). */
	private _bounceBoostLeft = 0;
	/** Current travel speed along the route (world units/frame @ 60 fps). */
	private _routeSpeed = IRON_BALL_SPEED;
	/** Cooldown before the same ball can receive another segment-end boost (@ 60 fps). */
	private _bounceCooldown = 0;
	/** Cached Bound + Flipper list from the course scene (built once, reused each segment). */
	private _collideBoostEntities: (Bound | Flipper)[] | null = null;
	/** POIT position `[x,y,z]` → nearby Bound or Flipper; built lazily once colEnt is complete. */
	private _entityByPoitPos: Map<string, Bound | Flipper> | null = null;
	/** `colEnt` Bound/Flipper count when `_entityByPoitPos` was built (OBJI load order). */
	private _boostCacheEntityCount = -1;
	/** Flipper whose automatic swing is held until the ball reaches the segment end POIT. */
	private _heldFlipper: Flipper | null = null;

	constructor(obji: nkm_section_OBJI, scene: Scene) {
		super(obji, scene);
		this.colRad = 512;
		this.vel = vec3.create();
		this._colMat = mat4.create();
		this._prevPos = vec3.clone(this.pos);
		this._scene = scene;

		this._targetDiameter = obji.setting1 & 0xffff;

		this._route = scene.getRoute(obji.routeID);
		vec3.copy(this.pos, this._route[0].pos);
		this._prevPos = vec3.clone(this.pos);
		this._delayLeft = this._decodeStartDelay(obji);
		this.collidable = true;
		this._applyArrivalRules(this._route[this._segTo].pos);
	}

	provideRes(r: ProvidedRes) {
		const poly = r.mdl[0].bmd.modelData.objectData[0].polys.objectData[0];
		const bounds = modelPolyLocalBounds(poly.disp);
		const modelDiameter = Math.max(bounds.width, bounds.height) * 16 * this.scale[0];
		if (modelDiameter > 0) {
			const fit = this._targetDiameter / modelDiameter;
			this._drawScale = [fit, fit, fit];
		}

		const scaleY = this.scale[1] * this._drawScale[1];
		const world = modelWorldYExtent(bounds.min[1], bounds.max[1], scaleY);
		this._yOffset = world.height / 2;

		super.provideRes(r);
		this._invalidateBoostCaches();
		this._applyArrivalRules(this._route[this._segTo].pos);
		if (!this.collidable) return;

		this._colRes = r.mdl[0].getBoundingCollisionModel(0, 0);
		for (let i = 0; i < this._colRes.dat.length; i++) {
			this._colRes.dat[i].CollisionType = MKDS_COLTYPE.KNOCKBACK_DAMAGE << 8;
		}
		this._setColMat();
	}

	getCollision() {
		return { tris: this._colRes.dat, mat: this._colMat, frame: this._colFrame };
	}

	moveWith(obj: Kart | Item) {
		vec3.add(obj.pos, obj.pos, this.vel);
	}

	update(scn?: Scene) {
		this._stepRoute();
		this._setColMat();
		if (this._bounceCooldown > 0) this._bounceCooldown--;
		super.update(scn);
	}

	requireRes() {
		return { mdl: [{ nsbmd: "IronBall.nsbmd" }] };
	}

	private _stepRoute() {
		// Hold at spawn until OBJI start delay elapses (see ironBallMobileStartDelay).
		if (this._delayLeft > 0) {
			this._delayLeft--;
			this.vel = [0, 0, 0];
			return;
		}

		this._routeFrame++;

		const move = this._stepRouteSpeed();

		// Single step per frame: cap travel to the current leg, cross at most one POIT.
		const segLen = this._segmentLength(this._segFrom, this._segTo);
		if (segLen <= 0) {
			if (this._segFrom !== this._segTo) {
				this._snapZeroLengthLeg();
			}
		} else {
			const remain = segLen - this._segDist;
			this._segDist += Math.min(move, remain);
			if (this._segDist >= segLen) {
				this._crossSegmentBoundary();
			}
		}

		const from = this._route[this._segFrom].pos;
		const to = this._route[this._segTo].pos;
		const len = vec3.distance(from, to);
		const t = len > 0 ? this._segDist / len : 1;
		this.pos[0] = from[0] + (to[0] - from[0]) * t;
		this.pos[1] = from[1] + (to[1] - from[1]) * t;
		this.pos[2] = from[2] + (to[2] - from[2]) * t;

		vec3.sub(this.vel, this.pos, this._prevPos);
		this._prevPos = vec3.clone(this.pos);
	}

	/** Arrive at the current segment end POIT and open the next leg. */
	private _crossSegmentBoundary(): void {
		this._segDist = 0;
		this._segFrom = this._segTo;

		this._applyDepartureRules(this._route[this._segFrom].pos);

		const branchIdx = this._resolveBranchIdx(this._segFrom);
		const takeBranch = branchIdx >= 0 && this._shouldTakeUnknown1Branch(this._segFrom, this._route.length - 1);

		this._advanceSegment(takeBranch, branchIdx);
		this._applyArrivalRules(this._route[this._segTo].pos);
	}

	/** Co-located branch target (e.g. pinball 75/80 → 72): snap without re-firing departure boost. */
	private _snapZeroLengthLeg(): void {
		this._segDist = 0;
		this._segFrom = this._segTo;
		this._advanceSegment();
		this._applyArrivalRules(this._route[this._segTo].pos);
	}

	/** POIT index named by unknown1 on the POIT at `atIdx`, or -1. */
	private _resolveBranchIdx(atIdx: number): number {
		const at = this._route[atIdx];
		if (at.unknown1 === MKDSCONST.OBJI_ROUTE_NONE) return -1;
		return this._route.findIndex((p) => p.pointInd === at.unknown1);
	}

	private _advanceSegment(takeBranch?: boolean, branchIdx?: number) {
		const at = this._route[this._segFrom];
		const lastIdx = this._route.length - 1;

		if (takeBranch == null) {
			branchIdx = this._resolveBranchIdx(this._segFrom);
			takeBranch = branchIdx >= 0 && this._shouldTakeUnknown1Branch(this._segFrom, lastIdx);
		}

		if (takeBranch && branchIdx! >= 0) {
			this._segTo = branchIdx!;
			return;
		}

		if (this._segFrom >= lastIdx) {
			this._restartRoute();
			return;
		}

		this._segTo = this._segFrom + 1;
	}

	/**
	 * Last POIT of the route: always follow unknown1.
	 * Earlier branch POITs: follow every other time (alternating take / skip).
	 */
	private _shouldTakeUnknown1Branch(atIdx: number, lastIdx: number): boolean {
		if (atIdx >= lastIdx) return true;

		return Math.random() > 1 / 2;
	}

	/** Reset segment state to route index 0 (start delay is not replayed). */
	private _restartRoute() {
		this._segFrom = 0;
		this._segTo = 1;
		this._segDist = 0;
		this._routeSpeed = IRON_BALL_SPEED;
		vec3.copy(this.pos, this._route[0].pos);
		this._prevPos = vec3.clone(this.pos);
		this._releaseHeldFlipper();
		this._applyDepartureRules(this._route[0].pos);
		this._applyArrivalRules(this._route[1].pos);
	}

	private _bounceSpeedBonus(): number {
		if (this._bounceBoostLeft <= 0) return 0;
		return IRON_BALL_BOUNCE_BOOST * (this._bounceBoostLeft / IRON_BALL_BOUNCE_DURATION);
	}

	/**
	 * Advance boost timer, derive target cruise + bonus speed, and update `_routeSpeed`.
	 * Target may rise instantly on a boost; when it falls, `_routeSpeed` lerps down.
	 */
	private _stepRouteSpeed(): number {
		const target = IRON_BALL_SPEED + this._bounceSpeedBonus();
		if (this._bounceBoostLeft > 0) this._bounceBoostLeft--;

		if (target >= this._routeSpeed) {
			this._routeSpeed = target;
		} else {
			this._routeSpeed += (target - this._routeSpeed) * IRON_BALL_DECEL_RATE;
		}
		return this._routeSpeed;
	}

	private _collisionRadius(): number {
		const d = this._targetDiameter > 0 ? this._targetDiameter : IRON_BALL_DEFAULT_DIAMETER;
		return d * 0.5;
	}

	private _getCollidableObjs(): (Bound | Flipper)[] {
		const bounds = <(Bound | Flipper)[]>((this._scene as courseScene).colEnt.filter(
			(e) => e instanceof Bound || e instanceof Flipper
		));
		if (bounds.length > 0) this._collideBoostEntities = bounds;
		return this._collideBoostEntities ?? bounds;
	}

	private _invalidateBoostCaches(): void {
		this._collideBoostEntities = null;
		this._entityByPoitPos = null;
		this._boostCacheEntityCount = -1;
	}

	private _poitPosKey(pos: vec3): string {
		return `${pos[0]},${pos[1]},${pos[2]}`;
	}

	/**
	 * Build `_entityByPoitPos` once `colEnt` holds every Bound/Flipper. Rebuilt if the
	 * entity count grows (OBJI processed after this ball's `provideRes`).
	 */
	private _ensureBoostCaches(): void {
		const entities = this._getCollidableObjs();
		if (entities.length === 0) return;
		if (this._entityByPoitPos != null && this._boostCacheEntityCount === entities.length) return;

		this._boostCacheEntityCount = entities.length;
		this._collideBoostEntities = entities;
		const map = new Map<string, Bound | Flipper>();
		for (let i = 0; i < this._route.length; i++) {
			const key = this._poitPosKey(this._route[i].pos);
			if (map.has(key)) continue;
			const entity = this._matchBoostEntityAtPOIT(this._route[i].pos, entities);
			if (entity != null) map.set(key, entity);
		}
		this._entityByPoitPos = map;
	}

	private _entityAtPoit(pos: vec3): Bound | Flipper | null {
		this._ensureBoostCaches();
		if (this._entityByPoitPos != null) {
			return this._entityByPoitPos.get(this._poitPosKey(pos)) ?? null;
		}
		return this._matchBoostEntityAtPOIT(pos, this._getCollidableObjs());
	}

	/**
	 * New leg departure: boost if a Bound / Flipper sits at `fromPos`, release Flipper hold.
	 */
	private _applyDepartureRules(fromPos: vec3): void {
		const fromEntity = this._entityAtPoit(fromPos);
		if (fromEntity instanceof Flipper) {
			this._releaseHeldFlipper();
		}
		if (fromEntity != null) {
			this._consumeBoostEntity(fromEntity);
		}
	}

	/** Upcoming arrival: hold Flipper auto-swing until the ball reaches `toPos`. */
	private _applyArrivalRules(toPos: vec3): void {
		const toEntity = this._entityAtPoit(toPos);
		if (this._heldFlipper != null && this._heldFlipper !== toEntity) {
			this._releaseHeldFlipper();
		}
		if (toEntity instanceof Flipper) {
			toEntity.holdAutoSwing();
			this._heldFlipper = toEntity;
		}
	}

	private _consumeBoostEntity(entity: Bound | Flipper): void {
		if (entity instanceof Flipper) {
			entity.triggerSwing();
			if (this._heldFlipper === entity) this._heldFlipper = null;
		}

		if (this._bounceCooldown > 0) return;
		this._onBoostEntityHit(entity);
	}

	private _segmentLength(fromIdx: number, toIdx: number): number {
		return vec3.distance(this._route[fromIdx].pos, this._route[toIdx].pos);
	}

	/** Release flipper auto-swing hold when the arrival target changes or the route restarts. */
	private _releaseHeldFlipper() {
		if (this._heldFlipper == null) return;
		this._heldFlipper.releaseAutoSwingHold();
		this._heldFlipper = null;
	}

	/**
	 * Test whether a route POIT bottom anchor is within reach of a Bound or Flipper.
	 *
	 * Uses ball radius + `BOUND_HIT_RADIUS` against both the POIT bottom and the lifted ball
	 * center (`_yOffset`). Used when building `_entityByPoitPos` and as a fallback before
	 * `provideRes`.
	 */
	private _matchBoostEntityAtPOIT(
		poitBottom: vec3,
		entities: (Bound | Flipper)[]
	): Bound | Flipper | null {
		if (entities.length === 0) return null;

		const ballR = this._collisionRadius();
		const threshold = ballR + BOUND_HIT_RADIUS;
		const poitCenter: vec3 = [poitBottom[0], poitBottom[1] + this._yOffset, poitBottom[2]];

		for (let i = 0; i < entities.length; i++) {
			const bp = entities[i].pos;
			if (vec3.distance(poitBottom, bp) < threshold || vec3.distance(poitCenter, bp) < threshold) {
				return entities[i];
			}
		}
		return null;
	}

	/** Apply temporary route acceleration after a segment-end Bound or Flipper hit. */
	private _onBoostEntityHit(bound: Bound | Flipper) {
		this._bounceBoostLeft = IRON_BALL_BOUNCE_DURATION;
		this._bounceCooldown = IRON_BALL_BOUNCE_COOLDOWN;
		if (bound instanceof Bound) {
			bound.onKartHit();
		}

	}

	private _setColMat() {
		if (!this._colRes) return;
		const p = this._placementPos();
		const mat = mat4.create();
		mat4.translate(mat, mat, p);
		if (this.angle[2] != 0) mat4.rotateZ(mat, mat, this.angle[2] * (Math.PI / 180));
		if (this.angle[1] != 0) mat4.rotateY(mat, mat, this.angle[1] * (Math.PI / 180));
		if (this.angle[0] != 0) mat4.rotateX(mat, mat, this.angle[0] * (Math.PI / 180));
		mat4.scale(mat, mat, vec3.scale(vec3.create(), vec3.mul(vec3.create(), this.scale, this._drawScale), 16));
		mat4.scale(this._colMat, mat, [this._colRes.scale, this._colRes.scale, this._colRes.scale]);
		this._colFrame++;
	}

	/** Decode OBJI start delay from pinball_course mobile iron-ball instances. */
	private _decodeStartDelay(obji: nkm_section_OBJI): number {
		const setting1High = obji.setting1 >> 16;
		if (setting1High > 0) return setting1High;

		const setting2Low = obji.setting2 & 0xffff;
		if (setting2Low >= IRON_BALL_START_DELAY_LOW_THRESHOLD) return setting2Low;

		return obji.setting2 >> 16;
	}
}



