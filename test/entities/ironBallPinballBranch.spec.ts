import { describe, it, expect } from "vitest";
import { Bound } from "../../src/entities/objDecor/Bound";
import { IRON_BALL_BOUNCE_DURATION, IronBallMobile } from "../../src/entities/objDecor/IronBallMobile";
import { MKDSCONST } from "../../src/engine/mkdsConst";
import { nkm } from "../../src/formats/nkm";
import { loadCourseCarc, romExists } from "../helpers/rom";

function compilePaths(nkmData: nkm) {
	const path = nkmData.sections.PATH.entries;
	const pts = nkmData.sections.POIT.entries;
	const paths: (typeof pts)[] = [];
	let ind = 0;
	for (let i = 0; i < path.length; i++) {
		const p = [];
		for (let j = 0; j < path[i].numPts; j++) p.push(pts[ind++]);
		paths.push(p);
	}
	return paths;
}

function makeScene(nkmData: nkm, paths: ReturnType<typeof compilePaths>) {
	const scene = {
		paths,
		nkm: nkmData,
		colEnt: [] as lsc_taget[],
		getRoute: (id: number) => paths[id],
	} as unknown as Scene;
	const bounds = nkmData.sections.OBJI.entries
		.filter((o) => o.ID === 0x01a8)
		.map((o) => new Bound(o, scene));
	scene.colEnt = bounds;
	return { scene, bounds };
}

describe.skipIf(!romExists)("IronBallMobile pinball end branch (retail)", () => {
	it("pointInd matches array index on route 4", () => {
		const nkmData = new nkm(loadCourseCarc("pinball_course").getFile("/course_map.nkm")!);
		const route = compilePaths(nkmData)[4];
		for (let i = 0; i < route.length; i++) {
			expect(route[i].pointInd).toBe(i);
		}
	});

	it("full sim route 4 from POIT 78 triggers station bound at 80", () => {
		const nkmData = new nkm(loadCourseCarc("pinball_course").getFile("/course_map.nkm")!);
		const paths = compilePaths(nkmData);
		const { scene, bounds } = makeScene(nkmData, paths);
		const stationBound = bounds.find((b) => Math.hypot(b.pos[0] + 260, b.pos[1] - 1270) < 5)!;

		const ball = new IronBallMobile(
			nkmData.sections.OBJI.entries.find((o) => o.ID === 0x01b0 && o.routeID === 4)!,
			scene
		);
		const internal = ball as unknown as {
			_yOffset: number;
			_delayLeft: number;
			_segFrom: number;
			_segTo: number;
			_segDist: number;
			_bounceCooldown: number;
			_bounceBoostLeft: number;
			_shouldTakeUnknown1Branch(a: number, l: number): boolean;
			_stepRoute(): void;
		};
		internal._yOffset = 52;
		internal._delayLeft = 0;
		internal._shouldTakeUnknown1Branch = () => true;
		internal._segFrom = 78;
		internal._segTo = 79;
		internal._segDist = 0;

		let stationWobbleAt80 = false;
		for (let f = 0; f < 6000; f++) {
			const wobbleBefore = (stationBound as unknown as { _wobbleLeft: number })._wobbleLeft;
			internal._stepRoute();
			if (internal._bounceCooldown > 0) internal._bounceCooldown--;
			if (
				internal._segFrom === 80 &&
				internal._segTo === 72 &&
				(stationBound as unknown as { _wobbleLeft: number })._wobbleLeft > wobbleBefore
			) {
				stationWobbleAt80 = true;
				break;
			}
			if (internal._segFrom === 80 && internal._segTo === 72) {
				// Deferred boost applies on the zero-length branch snap (next step).
				const w2 = (stationBound as unknown as { _wobbleLeft: number })._wobbleLeft;
				internal._stepRoute();
				if (internal._bounceCooldown > 0) internal._bounceCooldown--;
				if ((stationBound as unknown as { _wobbleLeft: number })._wobbleLeft > w2) {
					stationWobbleAt80 = true;
				}
				break;
			}
		}
		expect(stationWobbleAt80).toBe(true);
	});

	it("triggers station bound at 75 when branch is skipped", () => {
		const nkmData = new nkm(loadCourseCarc("pinball_course").getFile("/course_map.nkm")!);
		const paths = compilePaths(nkmData);
		const { scene, bounds } = makeScene(nkmData, paths);
		const stationBound = bounds.find((b) => Math.hypot(b.pos[0] + 260, b.pos[1] - 1270) < 5)!;
		const ball = new IronBallMobile(
			nkmData.sections.OBJI.entries.find((o) => o.ID === 0x01b0 && o.routeID === 4)!,
			scene
		);
		const internal = ball as unknown as {
			_delayLeft: number;
			_segFrom: number;
			_segTo: number;
			_segDist: number;
			_bounceCooldown: number;
			_shouldTakeUnknown1Branch(atIdx: number): boolean;
			_stepRoute(): void;
		};
		internal._delayLeft = 0;
		internal._shouldTakeUnknown1Branch = (atIdx) => atIdx !== 75;
		internal._segFrom = 74;
		internal._segTo = 75;
		internal._segDist = 0;
		for (let f = 0; f < 500; f++) {
			internal._stepRoute();
			if (internal._bounceCooldown > 0) internal._bounceCooldown--;
			if (internal._segFrom === 76) break;
		}
		expect((ball as unknown as { _bounceBoostLeft: number })._bounceBoostLeft).toBe(IRON_BALL_BOUNCE_DURATION);
		expect((stationBound as unknown as { _wobbleLeft: number })._wobbleLeft).toBeGreaterThan(0);
	});

	it("triggers station bound at 75 when zero-length branch is taken", () => {
		const nkmData = new nkm(loadCourseCarc("pinball_course").getFile("/course_map.nkm")!);
		const paths = compilePaths(nkmData);
		const { scene, bounds } = makeScene(nkmData, paths);
		const stationBound = bounds.find((b) => Math.hypot(b.pos[0] + 260, b.pos[1] - 1270) < 5)!;
		const ball = new IronBallMobile(
			nkmData.sections.OBJI.entries.find((o) => o.ID === 0x01b0 && o.routeID === 4)!,
			scene
		);
		const internal = ball as unknown as {
			_delayLeft: number;
			_segFrom: number;
			_segTo: number;
			_segDist: number;
			_bounceCooldown: number;
			_shouldTakeUnknown1Branch(): boolean;
			_stepRoute(): void;
		};
		internal._delayLeft = 0;
		internal._shouldTakeUnknown1Branch = () => true;
		internal._segFrom = 74;
		internal._segTo = 75;
		internal._segDist = 0;
		for (let f = 0; f < 500; f++) {
			internal._stepRoute();
			if (internal._bounceCooldown > 0) internal._bounceCooldown--;
			if (internal._segFrom === 72 && internal._segTo === 73) break;
		}
		expect((ball as unknown as { _bounceBoostLeft: number })._bounceBoostLeft).toBeGreaterThan(0);
		expect((stationBound as unknown as { _wobbleLeft: number })._wobbleLeft).toBeGreaterThan(0);
	});
});
