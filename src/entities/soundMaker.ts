//
// soundMaker.js
//--------------------
// Provides env sound object, such as crowd for figure 8
// by RHY3756547
//
import { nitroAudio, nitroAudioSound } from "../audio/nitroAudio";
import { SoundBox } from "../audio/soundBox";
import { nkm_section_OBJI } from "../formats/nkm";
import { nitroRender } from "../render/nitroRender";

const MARKER_COLORS: Record<number, number[]> = {
	0x0005: [0.25, 0.65, 1, 0.9], // blue
	0x0008: [1, 0.85, 0.2, 0.9], // yellow
	0x000a: [0.35, 1, 0.45, 0.9], // green
	0x000e: [1, 0.35, 0.75, 0.9], // pink
};

export class ObjSoundMaker implements SceneEntityObject {
	collidable!: boolean;
	transparent = true;
	obji: nkm_section_OBJI;
	pos: vec3;
	res: ProvidedRes;
	frame: number;
	soundProps: {
		pos: vec3;
		refDistance: number;
		rolloffFactor: number;
	};
	sound: nitroAudioSound | null;
	sN: number;
	threshold: number;
	gain: number;
	constructor(obji: nkm_section_OBJI, _scene: Scene) {
		this.obji = obji;
		this.res = undefined!;
		this.frame = 0;
		this.pos = vec3.clone(this.obji.pos);
		this.soundProps = {
			pos: this.pos,
			refDistance: 1024,
			rolloffFactor: 1,
		};
		this.sound = null;
		this.sN = 0;
		this.threshold = 0.2;
		this.gain = 1;
		switch (this.obji.ID) {
			case 0x0005:
				this.sN = 261;
				this.gain = 1;
				this.threshold = 0.2;
				break;
			case 0x0008:
				this.sN = 259;
				this.gain = 2;
				this.threshold = 0.2;
				break;
			case 0x000a:
				this.sN = 262;
				this.gain = 1;
				this.threshold = 0.2;
				break;
			case 0x000e:
				this.sN = 263;
				this.gain = 1;
				this.threshold = 0.2;
				break;
		}
	}

	draw(view: mat4, pMatrix: mat4) {
		if (!window.debug.showSoundMakers || nitroRender.flagShadow || this.res?.mdl[0] == null) return;

		const color = MARKER_COLORS[this.obji.ID] ?? [1, 1, 1, 0.9];
		const bob = Math.sin(this.frame / 30) * 16;

		if (this.res.mdl[1] != null) {
			const ringMat = mat4.translate(mat4.create(), view, this.pos);
			const ringScale = this.soundProps.refDistance / 32;
			mat4.scale(ringMat, ringMat, [ringScale, 1, ringScale]);
			nitroRender.setColMult([color[0], color[1], color[2], 0.15]);
			nitroRender.setShadowReceive(false);
			this.res.mdl[1].draw(ringMat, pMatrix);
			nitroRender.setShadowReceive(true);
		}

		const markerMat = mat4.translate(mat4.create(), view, this.pos);
		mat4.translate(markerMat, markerMat, [0, bob + 48, 0]);
		mat4.scale(markerMat, markerMat, [20, 40, 20]);
		nitroRender.setColMult(color);
		nitroRender.setShadowReceive(false);
		this.res.mdl[0].draw(markerMat, pMatrix);
		nitroRender.setShadowReceive(true);
		nitroRender.setColMult([1, 1, 1, 1]);
	}

	update() {
		this.frame++;
	}

	sndUpdate(view: mat4) {
		//t.soundProps.pos = vec3.transformMat4([], t.pos, view);
		//t.soundProps.pos = [0, 0, Math.sqrt(vec3.dot(t.soundProps.pos, t.soundProps.pos))]
		//if (t.soundProps.lastPos != null) t.soundProps.vel = vec3.sub([], t.soundProps.pos, t.soundProps.lastPos);
		//else t.soundProps.vel = [0, 0, 0];
		//t.soundProps.lastPos = t.soundProps.pos;

		this.soundProps.pos = this.pos; //todo: when reintroducing doppler, disable it on this source

		this.soundProps.refDistance = 1024;
		//t.soundProps.rolloffFactor = 1;

		const relPos = vec3.transformMat4([0, 0, 0], this.pos, view);

		const calcVol =
			this.soundProps.refDistance /
			(this.soundProps.refDistance + this.soundProps.rolloffFactor * (relPos[2] - this.soundProps.refDistance));

		if (calcVol < this.threshold) {
			if (this.sound != null) {
				nitroAudio.instaKill(this.sound);
				this.sound = null;
			}
		} else {
			if (this.sound == null) {
				const snd = SoundBox.ambient(this.sN, this);
				if (snd == null) return;
				this.sound = snd;
				this.sound.gainN.gain.value = parseFloat(`${this.gain}`);
			}
		}
	}

	requireRes(): { mdl: { nsbmd: string }[] } {
		return { mdl: [{ nsbmd: "box.nsbmd" }, { nsbmd: "obj_shadow.nsbmd" }] };
	}

	provideRes(r: ProvidedRes) {
		this.res = r;
	}
}
