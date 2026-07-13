import { describe, expect, it } from "vitest";
import { MKDSCONST } from "../../src/engine/mkdsConst";
import { Bound } from "../../src/entities/objDecor/Bound";
import { Flipper } from "../../src/entities/objDecor/Flipper";
import {
	IRON_BALL_BOUNCE_BOOST,
	IRON_BALL_BOUNCE_DURATION,
	IRON_BALL_DECEL_RATE,
	IRON_BALL_SPEED,
	IronBallMobile,
} from "../../src/entities/objDecor/IronBallMobile";
import {
	IRON_BALL_STATIC_DEFAULT_DIAMETER,
	IronBallStatic,
	ironBallStaticTargetDiameter,
} from "../../src/entities/objDecor/IronBallStatic";
import { nkm } from "../../src/formats/nkm";
import { nsbmd } from "../../src/formats/nsbmd";
import { modelPolyLocalBounds, modelWorldYExtent } from "../../src/utils/modelLocalBounds";
import { loadCourseCarc, romExists } from "../helpers/rom";

function stubRoute(): nkm_section_POIT[] {
	return [
		{ pos: [0, 0, 0], pointInd: 0, unknown1: MKDSCONST.OBJI_ROUTE_NONE, unknown2: 0, duration: 0 },
		{ pos: [100, 0, 0], pointInd: 1, unknown1: MKDSCONST.OBJI_ROUTE_NONE, unknown2: 0, duration: 0 },
	];
}

function stubScene(colEnt: lsc_taget[] = []) {
	return {
		paths: [],
		nkm: { sections: { PATH: { entries: [] } } },
		colEnt,
		getRoute: () => stubRoute(),
	} as unknown as Scene;
}

function stubObji(overrides: Partial<nkm_section_OBJI> & Pick<nkm_section_OBJI, "ID">): nkm_section_OBJI {
	return {
		routeID: 65535,
		setting1: 0,
		setting2: 0,
		setting3: 0,
		setting4: 0,
		timeTrials: 0,
		nextOff: 0,
		scale: [1, 1, 1],
		pos: [0, 0, 0],
		angle: [0, 0, 0],
		...overrides,
	};
}

describe("ironBallStaticTargetDiameter", () => {
	it("defaults static mounts (0x01b3) when setting1 is zero", () => {
		expect(ironBallStaticTargetDiameter(stubObji({ ID: 0x01b3 }))).toBe(IRON_BALL_STATIC_DEFAULT_DIAMETER);
	});

	it("uses setting1 low word when set", () => {
		expect(ironBallStaticTargetDiameter(stubObji({ ID: 0x01b3, setting1: 110 }))).toBe(110);
	});
});

describe("IronBallMobile Bound bounce", () => {
	it("decays temporary route boost over BOUNCE_DURATION frames", () => {
		const ball = new IronBallMobile(stubObji({ ID: 0x01b0, routeID: 0 }), stubScene());
		(ball as unknown as { _bounceBoostLeft: number })._bounceBoostLeft = IRON_BALL_BOUNCE_DURATION;

		(ball as unknown as { _stepRoute(): void })._stepRoute();

		expect((ball as unknown as { _bounceBoostLeft: number })._bounceBoostLeft).toBe(IRON_BALL_BOUNCE_DURATION - 1);
		expect((ball as unknown as { _bounceSpeedBonus(): number })._bounceSpeedBonus()).toBeCloseTo(
			IRON_BALL_BOUNCE_BOOST * ((IRON_BALL_BOUNCE_DURATION - 1) / IRON_BALL_BOUNCE_DURATION)
		);
	});

	it("eases route speed down after boost target drops", () => {
		const ball = new IronBallMobile(stubObji({ ID: 0x01b0, routeID: 0 }), stubScene());
		const internal = ball as unknown as {
			_bounceBoostLeft: number;
			_routeSpeed: number;
			_stepRouteSpeed(): number;
		};
		internal._bounceBoostLeft = IRON_BALL_BOUNCE_DURATION - 1;
		internal._routeSpeed = IRON_BALL_SPEED + IRON_BALL_BOUNCE_BOOST;
		const before = internal._routeSpeed;
		const targetBeforeTick = IRON_BALL_SPEED + IRON_BALL_BOUNCE_BOOST * (internal._bounceBoostLeft / IRON_BALL_BOUNCE_DURATION);

		const speed = internal._stepRouteSpeed();

		expect(targetBeforeTick).toBeLessThan(before);
		expect(speed).toBeGreaterThan(targetBeforeTick);
		expect(speed).toBeCloseTo(before + (targetBeforeTick - before) * IRON_BALL_DECEL_RATE);
	});

	it("triggers boost and bound wobble on collision", () => {
		const boundObji = stubObji({ ID: 0x01a8, routeID: MKDSCONST.OBJI_ROUTE_NONE, pos: [50, 0, 0] });
		const bound = new Bound(boundObji, stubScene());
		bound.provideRes({
			mdl: [{ getBoundingCollisionModel: () => ({ dat: [], scale: 1 }) } as never],
			other: [null, null, null],
		});

		const ball = new IronBallMobile(stubObji({ ID: 0x01b0, routeID: 0 }), stubScene([bound]));
		(ball as unknown as { _onBoostEntityHit(b: Bound): void })._onBoostEntityHit(bound);

		expect((ball as unknown as { _bounceBoostLeft: number })._bounceBoostLeft).toBe(IRON_BALL_BOUNCE_DURATION);
		expect((bound as unknown as { _wobbleLeft: number })._wobbleLeft).toBeGreaterThan(0);
	});

	it("predicts bound at segment end and boosts on segment change", () => {
		const boundObji = stubObji({ ID: 0x01a8, routeID: MKDSCONST.OBJI_ROUTE_NONE, pos: [100, 0, 0] });
		const bound = new Bound(boundObji, stubScene());
		const ball = new IronBallMobile(stubObji({ ID: 0x01b0, routeID: 0, setting1: 105 }), stubScene([bound]));
		(ball as unknown as { _yOffset: number })._yOffset = 52;

		(ball as unknown as { _applyDepartureRules(p: vec3): void })._applyDepartureRules([100, 0, 0]);

		expect((ball as unknown as { _bounceBoostLeft: number })._bounceBoostLeft).toBe(IRON_BALL_BOUNCE_DURATION);
		expect((bound as unknown as { _wobbleLeft: number })._wobbleLeft).toBeGreaterThan(0);
	});

	it("holds flipper auto swing when next segment end is a Flipper", () => {
		const flipperObji = stubObji({ ID: 0x01a9, routeID: MKDSCONST.OBJI_ROUTE_NONE, pos: [100, 0, 0] });
		const flipper = new Flipper(flipperObji, stubScene());

		const ball = new IronBallMobile(stubObji({ ID: 0x01b0, routeID: 0, setting1: 105 }), stubScene([flipper]));
		(ball as unknown as { _yOffset: number })._yOffset = 52;

		expect((flipper as unknown as { _autoSwingHeld: boolean })._autoSwingHeld).toBe(true);
	});

	it("triggers flipper swing on segment change and boosts the ball", () => {
		const flipperObji = stubObji({ ID: 0x01a9, routeID: MKDSCONST.OBJI_ROUTE_NONE, pos: [100, 0, 0] });
		const flipper = new Flipper(flipperObji, stubScene());
		const ball = new IronBallMobile(stubObji({ ID: 0x01b0, routeID: 0, setting1: 105 }), stubScene([flipper]));
		(ball as unknown as { _yOffset: number })._yOffset = 52;

		(ball as unknown as { _applyDepartureRules(p: vec3): void })._applyDepartureRules([100, 0, 0]);

		expect((flipper as unknown as { _swingPhase: number })._swingPhase).toBe(1);
		expect((flipper as unknown as { _autoSwingHeld: boolean })._autoSwingHeld).toBe(false);
		expect((ball as unknown as { _bounceBoostLeft: number })._bounceBoostLeft).toBe(IRON_BALL_BOUNCE_DURATION);
	});

	it("predicts route start POIT after PATH loop, not the far end of leg 0→1", () => {
		const boundAtStart = stubObji({ ID: 0x01a8, routeID: MKDSCONST.OBJI_ROUTE_NONE, pos: [0, 0, 0] });
		const startBound = new Bound(boundAtStart, stubScene());

		const ball = new IronBallMobile(stubObji({ ID: 0x01b0, routeID: 0, setting1: 105 }), stubScene([startBound]));
		const internal = ball as unknown as {
			_yOffset: number;
			_bounceBoostLeft: number;
			_restartRoute(): void;
		};
		internal._yOffset = 52;

		internal._restartRoute();

		expect(internal._bounceBoostLeft).toBe(IRON_BALL_BOUNCE_DURATION);
		expect((startBound as unknown as { _wobbleLeft: number })._wobbleLeft).toBeGreaterThan(0);
	});

	it("builds boost map when Bound OBJI loads after IronBall provideRes", () => {
		const scene = stubScene([]);
		const ball = new IronBallMobile(stubObji({ ID: 0x01b0, routeID: 0, setting1: 105 }), scene);
		const internal = ball as unknown as {
			_yOffset: number;
			_entityByPoitPos: Map<string, Bound> | null;
			_invalidateBoostCaches(): void;
			_applyDepartureRules(p: vec3): void;
			_bounceBoostLeft: number;
		};
		internal._yOffset = 52;
		internal._invalidateBoostCaches();
		expect(internal._entityByPoitPos).toBeNull();

		const bound = new Bound(stubObji({ ID: 0x01a8, routeID: MKDSCONST.OBJI_ROUTE_NONE, pos: [100, 0, 0] }), scene);
		scene.colEnt.push(bound);
		internal._applyDepartureRules([100, 0, 0]);

		expect(internal._bounceBoostLeft).toBe(IRON_BALL_BOUNCE_DURATION);
	});

	it("triggers bound at last branch POIT before zero-length redirect", () => {
		const branchRoute: nkm_section_POIT[] = [
			{ pos: [200, 0, 0], pointInd: 0, unknown1: MKDSCONST.OBJI_ROUTE_NONE, unknown2: 0, duration: 0 },
			{ pos: [100, 0, 0], pointInd: 1, unknown1: MKDSCONST.OBJI_ROUTE_NONE, unknown2: 0, duration: 0 },
			{ pos: [0, 0, 0], pointInd: 2, unknown1: 3, unknown2: 0, duration: 0 },
			{ pos: [0, 0, 0], pointInd: 3, unknown1: MKDSCONST.OBJI_ROUTE_NONE, unknown2: 0, duration: 0 },
		];
		const scene = {
			paths: [],
			nkm: { sections: { PATH: { entries: [] } } },
			colEnt: [] as lsc_taget[],
			getRoute: () => branchRoute,
		} as unknown as Scene;
		const bound = new Bound(stubObji({ ID: 0x01a8, routeID: MKDSCONST.OBJI_ROUTE_NONE, pos: [0, 0, 0] }), scene);
		scene.colEnt = [bound];

		const ball = new IronBallMobile(stubObji({ ID: 0x01b0, routeID: 0, setting1: 105 }), scene);
		const internal = ball as unknown as {
			_yOffset: number;
			_delayLeft: number;
			_segFrom: number;
			_segTo: number;
			_bounceBoostLeft: number;
			_shouldTakeUnknown1Branch(a: number, l: number): boolean;
			_stepRoute(): void;
		};
		internal._yOffset = 52;
		internal._delayLeft = 0;
		internal._segFrom = 1;
		internal._segTo = 2;
		internal._segDist = 99;
		internal._shouldTakeUnknown1Branch = () => true;

		// Cross branch POIT 2; departure boost fires at arrival, then zero-length snap to 3.
		internal._stepRoute();

		expect(internal._bounceBoostLeft).toBe(IRON_BALL_BOUNCE_DURATION);
		expect((bound as unknown as { _wobbleLeft: number })._wobbleLeft).toBeGreaterThan(0);
	});
});

describe.skipIf(!romExists)("IronBallStatic pinball_course OBJI", () => {
	it("static mounts have setting1 zero in retail NKM", () => {
		const nkmData = new nkm(loadCourseCarc("pinball_course").getFile("/course_map.nkm")!);
		const staticMounts = nkmData.sections.OBJI.entries.filter((o) => o.ID === 0x01b3);
		expect(staticMounts.length).toBeGreaterThan(0);
		for (const obji of staticMounts) {
			expect(obji.setting1 & 0xffff).toBe(0);
			expect(ironBallStaticTargetDiameter(obji)).toBe(IRON_BALL_STATIC_DEFAULT_DIAMETER);
		}
	});

	it("static mounts use OBJI pos as ball center (no route bottom offset)", () => {
		const nkmData = new nkm(loadCourseCarc("pinball_course").getFile("/course_map.nkm")!);
		const obji = nkmData.sections.OBJI.entries.find((o) => o.ID === 0x01b3)!;
		const scene = { paths: [], nkm: nkmData, getRoute: () => [] } as Scene;
		const ball = new IronBallStatic(obji, scene);

		const bmd = new nsbmd(loadCourseCarc("pinball_course").getFile("/MapObj/IronBall.nsbmd")!);
		const poly = bmd.modelData.objectData[0].polys.objectData[0];
		const bounds = modelPolyLocalBounds(poly.disp);
		const fit = IRON_BALL_STATIC_DEFAULT_DIAMETER / (Math.max(bounds.width, bounds.height) * 16);
		const world = modelWorldYExtent(bounds.min[1], bounds.max[1], fit);

		ball.provideRes({ mdl: [{ bmd, getBoundingCollisionModel: () => ({ dat: [], scale: 1 }) } as never], other: [] });

		expect(ball.collidable).toBe(false);
		expect((ball as unknown as { _yOffset: number })._yOffset).toBe(0);
		expect(world.height / 2).toBeGreaterThanOrEqual(50);
	});
});
