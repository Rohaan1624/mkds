//
// shell.js
//--------------------
// Entity type for any item. Specific item types in `/item` folder
// Has a default collision handler, but can pass control to the specific item code.
// by RHY3756547
//
// includes: gl-matrix.js (glMatrix 2.0)
// /formats/kcl.js

import { SoundBox } from "../audio/soundBox";
import { MKDS_COLTYPE } from "../engine/collisionTypes";
import { items_IngameRes } from "../engine/ingameRes";
import { lsc } from "../engine/largeSphereCollider";
import { courseScene } from "../engine/scenes/courseScene";
import { nitroRender } from "../render/nitroRender";
import { BananaC } from "./items/droppable/bananaC";
import { BombC } from "./items/droppable/bombC";
import { FakeBoxC } from "./items/droppable/fakeBoxC";
import { GreenShellC, RedShellC } from "./items/shells/shellC";
import { GreenShellGroup, RedShellGroup } from "./items/shells/shellGroup";
import { ItemController } from "../engine/itemController";
import { Kart } from "./kart";

//
const itemTypes: { [x: string]: typeof KartItemEntity } = {
	//physics, holdable
	$koura_g: GreenShellC,
	$koura_r: RedShellC,
	$banana: BananaC,
	$bomb: BombC,
	$f_box: FakeBoxC,

	//groups
	$koura_group_g: GreenShellGroup,
	$koura_group_r: RedShellGroup,
	//'$banana_group': BananaGroupC,

	//one use items
	//'$kinoko': MushroomC,
	//'$kinoko_group': MushroomGroupC,
	//'$kinoko_p': QueenMushroomC,
	//'$star': StarC,
	//'$thunder': ThunderC,
	//'$gesso': BlooperC,
	//'$teresa': BooC,
	//'$killer': KillerC,
	//'$koura_w': BlueShellC
};

export class Item {
	private _minimumMove: number;
	private _scene: courseScene;
	private _owner: Kart;
	private _type: keyof items_IngameRes;
	private _id: number;
	id: number;
	pos: vec3;
	vel: vec3;
	gravity: vec3;
	minBounceVel: number;
	airResist: number;
	enablePhysics: boolean;
	floorBounce: number;
	held: boolean;
	type: keyof items_IngameRes;
	owner: Kart;
	holdTime: number;
	dead: boolean;
	angle: number;
	speed: number;
	yvel: number;
	xyScale: number[];
	colRadius: number;
	holdDist: number;
	safeKart: Kart | null;
	private _safeTimeMax: number;
	safeTime: number;
	stuckTo: lsc_taget | null;
	groundTime: number;
	private _deadTimerLength: number;
	private _throwVelocity: number;
	private _throwAngle: number;
	private _working: vec3;
	/** Position at the start of the last physics step, for swept kart hit tests. */
	private _prevPos: vec3;
	deadTimer: number;
	private _subtypeInd: number;
	controller: KartItemEntity;
	holdPos!: vec3;
	sprMat: mat4 | null;
	groupItem: Item | null;
	/** Network id (see ItemController.createItem). */
	netId = "";
	/** Set when this item's death came from the network, so it isn't reported back. */
	netQuiet = false;
	/** Set when this item hit a kart simulated on this client (that client reports the hit). */
	private _hitLocalKart = false;
	constructor(scene: courseScene, owner: Kart, type: keyof items_IngameRes, id: number) {
		this._minimumMove = 0.01;
		this._scene = scene;
		this._owner = owner;
		this._type = type;
		this._id = id;

		this.id = this._id;

		this.pos = vec3.transformMat4([0, 0, 0], [0, -this._owner.params.colRadius + 1, 16], this._owner.mat);
		this.vel = vec3.create();
		this.gravity = [0, -0.17, 0]; //100% confirmed by me messing around with the gravity value in mkds
		this.minBounceVel = 0.5;
		this.airResist = 0.99;
		this.enablePhysics = true;
		this.floorBounce = 0.5;
		this.held = true;
		this.type = this._type;
		this.owner = this._owner;
		this.holdTime = 20;
		this.dead = false;

		this.angle = this._owner.angle;
		this.speed = 10;
		this.yvel = 0;
		this.xyScale = [1, 1];

		this.colRadius = 4;
		this.holdDist = 2;
		this.safeKart = this._owner;
		this._safeTimeMax = 4;
		this.safeTime = this._safeTimeMax; //time the object needs to not be colliding with the source to start considering collisions with it
		this.stuckTo = null;

		this.groundTime = 0;

		this._deadTimerLength = 16;
		this._throwVelocity = 7; //xz velocity for throw. angle adds a y component
		this._throwAngle = (Math.PI / 10) * 2;
		this._working = vec3.create();
		this._prevPos = vec3.clone(this.pos);
		this.deadTimer = 0; //animates death. goes to 20, then deletes for real. dead objects can't run update or otherwise
		this.sprMat = null;
		this.groupItem = null;

		//a controller makes this item what it is...
		// canBeHeld: boolean
		// canBeDropped: boolean | 'func'
		// isDestructive: boolean
		// update?: (scene: CourseScene) => void
		// draw?: (mvMatrix, pMatrix) => void     // OVERRIDES NORMAL DRAW FUNCTION!
		// release?: (direction: number) => boolean   //direction is 1 for forward, -1 for back. returns if the item has more uses
		// onRest?: (normal: vec3) => void   //when the object comes to a rest (first time, or after leaving the ground for a while)
		// onDie?: (final: boolean) => void   //when the object dies
		// collide?: (item: Item | Kart)
		// collideKart?: (item: Kart)
		this._subtypeInd = this._type.indexOf("-");
		if (this._subtypeInd == -1) {
			this._subtypeInd = this._type.length;
		}

		this.controller = new itemTypes[`$${this._type.substr(0, this._subtypeInd)}`](
			this,
			this._scene,
			this._type.substr(this._subtypeInd + 1)
		);
	}

	private updateHold(kart: Kart) {
		//move the object behind the kart (physical direction without drift off)
		//assuming this will only be called for something that can be held
		const dir = kart.driftOff / 4;

		//offset the kart's drift offset (on direction)
		let pos;
		if (this.holdPos != null) {
			pos = vec3.clone(this.holdPos);
		} else {
			const dist = this.colRadius + kart.params.colRadius + this.holdDist;
			pos = vec3.clone([Math.sin(dir) * dist, -kart.params.colRadius, -Math.cos(dir) * dist]);
		}

		//make relative to the kart's position
		vec3.transformMat4(pos, pos, kart.mat);

		vec3.sub(this.vel, pos, this.pos); //set the object's velocity to try move it to the hold location. (gravity is disabled)
		this.enablePhysics = true;
	}

	release(forward: number): boolean {
		//release the item, either forward or back
		this.holdTime = 0;
		if (this.canBeHeld()) {
			this.updateHold(this._owner);
			this._updateCollision(this._scene);
		}
		this.enablePhysics = true;
		let hasMore = false;
		if (this.controller.release) hasMore = this.controller.release(forward) ?? false;
		else {
			//default drop and throw. just here for template purposes
			if (forward > 0) {
				SoundBox.itemThrow(this._owner);
				const dir = this._owner.driftOff / 4;

				//offset the kart's drift offset (on direction). add y component
				const vel = vec3.clone([
					-Math.sin(dir) * this._throwVelocity,
					Math.tan(this._throwAngle) * this._throwVelocity,
					Math.cos(dir) * this._throwVelocity,
				]);
				const z = vec3.clone([0, 0, 0]);

				//make relative to the kart's orientation
				vec3.transformMat4(vel, vel, this._owner.mat);
				vec3.transformMat4(z, z, this._owner.mat);
				vec3.sub(vel, vel, z);
				const v2 = vec3.scale([0, 0, 0], this._owner.vel, 2);
				vec3.add(vel, vel, v2);

				this.vel = vel;
			} else {
				this.vel = vec3.create();
				this.safeKart = null;
			}
		}
		this.held = false;
		const isGroup = (this.controller as unknown as { children?: unknown }).children != null;
		if (!isGroup && !this._owner.netPuppet) ItemController.net?.onRelease(this, forward);
		return hasMore;
	}

	canBeHeld() {
		return this.controller.canBeHeld || false;
	}

	onlyHeld() {
		return this.controller.onlyHeld();
	}

	private canBeDropped() {
		if (this.controller.canBeDropped == null) return true;
		return this.controller.canBeDropped;
	}

	isDestructive() {
		return this.controller.isDestructive || false;
	}

	private isSolid() {
		if (this.controller.isSolid == null) return true;
		return this.controller.isSolid;
	}

	finalize() {
		//kill instantly
		if (this.controller.onDie) this.controller.onDie(true);
		this.deadTimer = this._deadTimerLength;
		this._scene.items.removeItem(this);
		this.dead = true;
	}

	private _intensityMax(targ: vec3, vec: vec3) {
		if (Math.abs(vec[0]) > Math.abs(targ[0]) * 0.5) targ[0] = vec[0];
		if (Math.abs(vec[1]) > Math.abs(targ[1]) * 0.5) targ[1] = vec[1];
		if (Math.abs(vec[2]) > Math.abs(targ[2]) * 0.5) targ[2] = vec[2];
	}

	private collide(obj: Item | Kart) {
		if (this.controller.collide) {
			this.controller.collide(obj);
			return;
		}

		if (Object.hasOwn(obj, "type")) {
			const item = <Item>obj;
			//has a type, definitely an item
			if (item.isDestructive() || this.isDestructive()) {
				//mutual destruction. other side will deal with how they handle the collision
				this.deadTimer++;
				item.deadTimer++;
			} else if (item.isSolid() && this.isSolid()) {
				//bounce off other items that are not destructive
				//set our velocity to move away (not too intensely)
				//(only apply if our id is before, to avoid double adding the velocity)
				if (this.id < item.id) {
					const diff = vec3.sub(this._working, this.pos, item.pos);
					vec3.scale(diff, diff, 0.33);
					this._intensityMax(this.vel, diff);
					vec3.scale(diff, diff, -1);
					this._intensityMax(item.vel, diff);
					//vec3.add(this.vel, this.vel, diff);
					//vec3.sub(item.vel, item.vel, diff);
					this.enablePhysics = true;
					item.enablePhysics = true;
				}
			}
		} else {
			const kart = <Kart>obj;
			//is a kart. usually this is where objects differ
			if (this.controller.collideKart) {
				this.controller.collideKart(kart);
			}
		}
	}

	update(scene: courseScene) {
		if (this.controller.update) this.controller.update(scene);
		if (this.holdTime > 0 && this.holdTime-- > 7) {
			if (this.holdTime == 7) {
				SoundBox.itemEquip(this._owner);
			}
			return;
		}
		if (this.pos[2] < -10000) this.finalize(); //out of bounds failsafe

		if (this.deadTimer > 0) {
			if (this.deadTimer == 1) {
				if (!this.netQuiet && (!this._owner.netPuppet || this._hitLocalKart)) ItemController.net?.onDie(this);
				if (this.controller.onDie) this.controller.onDie(false);
				if (this.held) {
					// A held item that breaks flies off with the kart's momentum rather than hanging in the air.
					this.held = false;
					this.vel = vec3.clone(this._owner.vel);
					this.vel[1] += 1.5;
				} else {
					// Thrown items break roughly where they hit something.
					vec3.scale(this.vel, this.vel, 0.15);
				}
			}
			vec3.add(this.pos, this.pos, this.vel);
			vec3.scale(this.vel, this.vel, 0.85);
			this.deadTimer++;
			this.sprMat = mat4.create();
			mat4.translate(this.sprMat, this.sprMat, [this.deadTimer / 50, Math.sin((this.deadTimer / 30) * Math.PI) * 0.5, 0]);
			mat4.rotateZ(this.sprMat, this.sprMat, (this.deadTimer / -15) * Math.PI);
			if (this.deadTimer >= this._deadTimerLength) this.finalize();
			return;
		}

		if (this.held) {
			this.updateHold(this._owner);
		}

		let hitSafe = false;
		//search for player collisions, collisions with other items
		for (let i = 0; i < scene.karts.length; i++) {
			const ok = scene.karts[i];

			if (this.held && ok === this._owner) continue;
			// Hits are decided by whichever side sees them: the client simulating the item's owner (shooter)
			// or the one simulating the kart (victim). Two remote objects meeting is for their clients to decide.
			if (ok.netPuppet && this._owner.netPuppet) continue;
			if (this._hitsKart(ok)) {
				//colliding with a kart.
				//do we need to do something?
				if (ok === this.safeKart) {
					hitSafe = true;
					continue;
				}
				this._hitLocalKart = true;
				this.collide(ok);
				if (this.deadTimer === 0) this._hitLocalKart = false;
			}
		}

		if (this.safeKart && !hitSafe && !this.held) {
			this.safeTime--;
			if (this.safeTime <= 0) {
				this.safeKart = null;
			}
		}

		if (this.holdTime == 0) {
			//avoid mutual item destruction on the first frame
			for (let i = 0; i < scene.items.items.length; i++) {
				const ot = scene.items.items[i];
				if (ot == this || (this.held && ot.held)) continue;
				if (this.groupItem != null && this.groupItem === ot.groupItem) continue;
				const dist = vec3.dist(this.pos, ot.pos);
				if (dist < this.colRadius + ot.colRadius && ot.holdTime <= 7 && ot.deadTimer == 0) {
					//two items are colliding.
					this.collide(ot);
				}
			}
		}

		if (this.groundTime > 0) this.groundTime++;

		if (this.stuckTo && this.stuckTo !== null) {
			if (this.stuckTo.moveWith != null) {
				this.stuckTo.moveWith(this);
			}
			this.enablePhysics = true;
			this.stuckTo = null;
		}

		if (this.enablePhysics) {
			this._updateCollision(scene);
		}
	}

	/**
	 * Held items use a simple sphere test. Thrown items test the segment they travelled last frame
	 * against the kart's full height, so fast shells don't skip through karts or miss on slopes.
	 */
	private _hitsKart(kart: Kart) {
		const r = this.colRadius;
		const R = kart.params.colRadius;
		const center = vec3.add(this._working, this.pos, [0, r / 2, 0]);
		if (this.held) return vec3.dist(center, kart.pos) < r + R;

		const sx = this._prevPos[0],
			sz = this._prevPos[2];
		const dx = this.pos[0] - sx,
			dz = this.pos[2] - sz;
		const len2 = dx * dx + dz * dz;
		let t = len2 > 0 ? ((kart.pos[0] - sx) * dx + (kart.pos[2] - sz) * dz) / len2 : 1;
		t = Math.max(0, Math.min(1, t));
		const hx = sx + dx * t - kart.pos[0];
		const hz = sz + dz * t - kart.pos[2];
		if (hx * hx + hz * hz >= (r + R) * (r + R)) return false;

		const cy = this._prevPos[1] + (this.pos[1] - this._prevPos[1]) * t + r / 2;
		return Math.abs(cy - kart.pos[1]) < R + r;
	}

	private _updateCollision(scene: courseScene) {
		vec3.copy(this._prevPos, this.pos);
		if (!this.held) {
			vec3.add(this.vel, this.vel, this.gravity);
			vec3.scale(this.vel, this.vel, this.airResist);
		}

		//by default, items use raycast collision against the world (rather than ellipse)
		//this speeds things up considerably

		let steps = 0;
		let remainingT = 1;
		let velSeg = vec3.clone(this.vel);
		const posSeg = vec3.clone(this.pos);
		const ignoreList: lsc_collision_triangle[] = [];
		while (steps++ < 10 && remainingT > 0.01) {
			const result = lsc.raycast(posSeg, velSeg, scene, 0.05, ignoreList);
			if (result != null) {
				if (this.controller.colResponse && !this.held) this.controller.colResponse(posSeg, velSeg, result, ignoreList);
				else this._colResponse(posSeg, velSeg, result, ignoreList);
				remainingT -= result.t;
				if (remainingT > 0.01) {
					velSeg = vec3.scale(velSeg, this.vel, remainingT);
				}
			} else {
				vec3.add(posSeg, posSeg, velSeg);
				remainingT = 0;
			}
		}
		this.pos = posSeg;
	}

	draw(mvMatrix: mat4, pMatrix: mat4) {
		if (this.holdTime > 7) return;
		if (this.deadTimer > 0) nitroRender.setColMult([1, 1, 1, 1 - this.deadTimer / this._deadTimerLength]); //fade out
		if (this.controller.draw) {
			this.controller.draw(mvMatrix, pMatrix);
		} else {
			const mat = mat4.translate(
				mat4.create(),
				mvMatrix,
				vec3.add(vec3.create(), this.pos, [0, this.colRadius * this.xyScale[1], 0])
			);

			this._spritify(mat);
			const scale = 6 * this.colRadius * (1 - this.holdTime / 7);
			mat4.scale(mat, mat, [scale, scale, scale]);

			const mdl = this._scene.gameRes.items[this._type]; // mdl == nitromodel
			//apply our custom mat (in sprite space), if it exists
			//used for destruction animation, scaling
			if (this.sprMat) {
				// sometime baseMat is undefined
				const oldMat = mdl.baseMat;
				mdl.setBaseMat(this.sprMat);
				mdl.draw(mat, pMatrix);
				mdl.setBaseMat(oldMat);
			} else {
				mdl.draw(mat, pMatrix);
			}
		}
		if (this.deadTimer > 0) nitroRender.setColMult([1, 1, 1, 1]);
	}

	private _spritify(mat: mat4) {
		const scale = Math.sqrt(mat[0] * mat[0] + mat[1] * mat[1] + mat[2] * mat[2]);

		mat[0] = scale;
		mat[1] = 0;
		mat[2] = 0;
		mat[4] = 0;
		mat[5] = scale;
		mat[6] = 0;
		mat[8] = 0;
		mat[9] = 0;
		mat[10] = scale;
	}

	private _colResponse(pos: vec3, pvel: vec3, dat: lscraycast, ignoreList: lsc_collision_triangle[]) {
		const plane = dat.plane;
		const collisionType = plane.CollisionType ?? 0;
		const colType = (collisionType >> 8) & 31;
		vec3.add(pos, pos, vec3.scale(vec3.create(), pvel, dat.t));

		const n = dat.normal;
		vec3.normalize(n, n);
		let adjustPos = true;

		if (MKDS_COLTYPE.GROUP_WALL.indexOf(colType) != -1) {
			//wall
			//normally, item collision with a wall cause a perfect reflection of the velocity.
			const proj = vec3.dot(this.vel, n) * 2;
			vec3.sub(this.vel, this.vel, vec3.scale(vec3.create(), n, proj));
			if (!this.held) this.safeKart = null;
		} else if (colType == MKDS_COLTYPE.OOB || colType == MKDS_COLTYPE.FALL) {
			if (this.deadTimer == 0) this.deadTimer++;
		} else if (MKDS_COLTYPE.GROUP_ROAD.indexOf(colType) != -1) {
			//sliding plane
			const bounce = this.held ? 0 : this.floorBounce;
			const proj = vec3.dot(this.vel, n) * (1 + bounce);
			vec3.sub(this.vel, this.vel, vec3.scale(vec3.create(), n, proj));

			if (!this.held && (this.floorBounce == 0 || Math.abs(proj) < this.minBounceVel)) {
				this.vel[0] = 0;
				this.vel[1] = 0;
				this.vel[2] = 0;
				this.enablePhysics = false;
				if (this.groundTime == 0) {
					this.groundTime = 1;
					if (this.controller.onRest) {
						this.controller.onRest(n);
					}
				}
			}
			this.stuckTo = dat.object;
		} else {
			adjustPos = false;
			ignoreList.push(plane);
		}

		if (adjustPos) {
			//move back from plane slightly
			vec3.add(pos, pos, vec3.scale(vec3.create(), n, this._minimumMove));
		}
	}
}
