import { nkm_section_OBJI, nkm_section_POIT } from "../../formats/nkm";
import { ItemBox } from "../itembox";

/** Match {@link WanwanReleased} route speed (world units / frame @ 60 fps). */
const MOVING_ITEMBOX_ROUTE_SPEED = 0.9;

export class ObjMovingItemBox extends ItemBox {
	private _route: nkm_section_POIT[];
	private _loopPath: boolean;
	private _speed = MOVING_ITEMBOX_ROUTE_SPEED;
	private _segFrom = 0;
	private _segTo = 1;
	private _segT = 0;
	private _dir = 1;

	constructor(obji: nkm_section_OBJI, scene: Scene) {
		super(obji, scene);
		this._route = scene.getRoute(obji.routeID);
		const pathMeta = scene.nkm.sections.PATH.entries[obji.routeID];
		this._loopPath = pathMeta != null && pathMeta.loop !== 0;

		if (this._route.length >= 2) {
			const startPoit = obji.setting3 & 0xffff;
			if (startPoit > 0) {
				this._initAtRouteIndex(startPoit);
			} else {
				const lagUnits = (obji.setting4 & 0xffff) || 120;
				this._initAtDistanceAlongRoute(lagUnits);
			}
		}
	}

	update(scene: Scene) {
		if (this._route.length >= 2) {
			this._stepRoute();
		}
		super.update(scene);
	}

	private _initAtRouteIndex(poitIndex: number) {
		const n = this._route.length;
		const idx = ((poitIndex % n) + n) % n;
		this._segFrom = idx;
		if (this._loopPath) {
			this._segTo = (idx + 1) % n;
		} else {
			this._segTo = Math.min(idx + 1, n - 1);
			if (this._segTo === this._segFrom && idx > 0) {
				this._segTo = idx;
				this._segFrom = idx - 1;
			}
		}
		this._segT = 0;
		vec3.copy(this.pos, this._route[this._segFrom].pos);
	}

	private _initAtDistanceAlongRoute(forwardDistance: number) {
		let remaining = forwardDistance;
		let from = 0;

		for (let guard = 0; guard < this._route.length + 1; guard++) {
			const to = this._nextRouteIndex(from);
			if (to === from) break;

			const a = this._route[from].pos;
			const b = this._route[to].pos;
			const segLen = vec3.distance(a, b);
			if (segLen <= 0.001) {
				from = to;
				continue;
			}

			if (remaining <= segLen) {
				this._segFrom = from;
				this._segTo = to;
				this._segT = remaining / segLen;
				this._setPosAlongSeg(a, b);
				return;
			}

			remaining -= segLen;
			from = to;
			if (!this._loopPath && to === this._route.length - 1) break;
		}

		this._initAtRouteIndex(0);
	}

	private _stepRoute() {
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
			this._setPosAlongSeg(from, to);
		}
	}

	private _setPosAlongSeg(from: vec3, to: vec3) {
		this.pos[0] = from[0] + (to[0] - from[0]) * this._segT;
		this.pos[1] = from[1] + (to[1] - from[1]) * this._segT;
		this.pos[2] = from[2] + (to[2] - from[2]) * this._segT;
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

	private _nextRouteIndex(from: number): number {
		if (this._loopPath) {
			return (from + 1) % this._route.length;
		}
		return Math.min(from + 1, this._route.length - 1);
	}
}
