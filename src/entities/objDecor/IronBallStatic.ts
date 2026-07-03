import { nkm_section_OBJI } from "../../formats/nkm";
import { modelPolyLocalBounds } from "../../utils/modelLocalBounds";
import { ObjDecor } from "../objDecor";

/** Retail pinball static mounts (0x01b3) leave setting1 at 0; use the standard route ball size. */
export const IRON_BALL_STATIC_DIAMETER = 90;

/**
 * Wall-mounted iron ball decoration (0x01b3) on pinball_course.
 *
 * Purely visual — not collidable. OBJI.pos is the model origin (center of the disc).
 * setting1 is usually 0; diameter defaults to IRON_BALL_STATIC_DEFAULT_DIAMETER (105 u).
 */
export class IronBallStatic extends ObjDecor {
	constructor(obji: nkm_section_OBJI, _scene: Scene) {
		super(obji, _scene);
		this.collidable = false;
		this._staringAtCamera = false;
	}

	provideRes(r: ProvidedRes) {
		const poly = r.mdl[0].bmd.modelData.objectData[0].polys.objectData[0];
		const bounds = modelPolyLocalBounds(poly.disp);
		const modelDiameter = Math.max(bounds.width, bounds.height) * 16 * this.scale[0];
		const fit = IRON_BALL_STATIC_DIAMETER / modelDiameter;
		this._drawScale = [fit, fit, fit];
		super.provideRes(r);
	}

	requireRes() {
		return { mdl: [{ nsbmd: "IronBall.nsbmd" }] };
	}
}