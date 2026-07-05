//
// nkm.js
//--------------------
// Loads nkm files and provides a variety of functions for accessing and using the data.
//
// nkm files usually drive the game logic of tracks (checkpoints, ai waypoints, objects on track) so it's pretty
// crucial to have this up and running.
//
// by RHY3756547
//
// includes: gl-matrix.js (glMatrix 2.0)
//

import { MKSUtils } from "./utils";

const FX32_SCALE = 4096;

function readVecFx32(view: DataView, off: number): vec3 {
	const v = vec3.create();
	v[0] = view.getInt32(off, true) / FX32_SCALE;
	v[1] = view.getInt32(off + 4, true) / FX32_SCALE;
	v[2] = view.getInt32(off + 8, true) / FX32_SCALE;
	return v;
}

function readLinks3(view: DataView, off: number): number[] {
	return [0, 1, 2].map((i) => view.getUint8(off + i)).filter((v) => v !== 0xff);
}

function readLinks8(view: DataView, off: number): number[] {
	return Array.from({ length: 8 }, (_, i) => view.getUint8(off + i)).filter((v) => v !== 0xff);
}

function readRgb555(view: DataView, off: number): number[] {
	const dat = view.getUint16(off, true);
	return [dat & 31, (dat >> 5) & 31, (dat >> 10) & 31];
}

function readKartPointBase(view: DataView, off: number): { pos: vec3; angle: vec3 } {
	return {
		pos: readVecFx32(view, off),
		angle: readVecFx32(view, off + 0xc),
	};
}

export type nkm_section_OBJI = {
	ID: number;
	objectId: number;
	routeID: number;
	pathId: number;
	settings: number[];
	flags: number;
	showsInTT: number;
	timeTrials: number;
	padding: number;
	setting1: number;
	setting2: number;
	setting3: number;
	setting4: number;
	nextOff: number;
	scale: vec3;
	pos: vec3;
	angle: vec3;
};

export type nkm_section_PATH = {
	routeID: number;
	loop: number;
	numPts: number;
	nextOff: number;
};

export type nkm_section_POIT = {
	pos: vec3;
	pointIndex: number;
	pointInd: number;
	duration: number;
	unknown1: number;
	unknown2: number;
	nextOff: number;
};

export type nkm_section_KTPS = {
	pos: vec3;
	angle: vec3;
	padding: number;
	index: number;
	id1: number;
	id2: number;
	nextOff: number;
};

export type nkm_section_KTP2 = {
	pos: vec3;
	angle: vec3;
	padding: number;
	id: number;
	id1: number;
	id2: number;
	nextOff: number;
};

export type nkm_section_KTPC = {
	pos: vec3;
	angle: vec3;
	nextMepo: number;
	id: number;
	id1: number;
	id2: number;
	nextOff: number;
};

export type nkm_section_KTPM = {
	pos: vec3;
	angle: vec3;
	padding: number;
	id: number;
	id1: number;
	id2: number;
	nextOff: number;
};

export type nkm_section_KTPJ = {
	pos: vec3;
	angle: vec3;
	enemyPointId: number;
	itemPointId: number;
	id: number;
	padding: number;
	id1: number;
	id2: number;
	respawnID: number;
	nextOff: number;
};

export type nkm_section_CPOI = {
	x1: number;
	z1: number;
	x2: number;
	z2: number;
	sinus: number;
	cosinus: number;
	distance: number;
	gotoSection: number;
	startSection: number;
	keyId: number;
	respawnId: number;
	flags: number;
	nextSection: number;
	currentSection: number;
	keyPoint: number;
	respawn: number;
	unknown: number;
	nextOff: number;
};

export type nkm_section_CPAT = {
	start: number;
	length: number;
	next: number[];
	previous: number[];
	sectionOrder: number;
	startInd: number;
	pathLen: number;
	dest: number[];
	source: number[];
	nextOff: number;
};

export type nkm_section_IPAT = {
	start: number;
	length: number;
	next: number[];
	previous: number[];
	sectionOrder: number;
	startInd: number;
	pathLen: number;
	dest: number[];
	source: number[];
	nextOff: number;
};

export type nkm_section_MEPA = {
	start: number;
	length: number;
	next: number[];
	previous: number[];
	startInd: number;
	pathLen: number;
	dest: number[];
	source: number[];
	nextOff: number;
};

export type nkm_section_IPOI = {
	pos: vec3;
	radius: number;
	recalcIdx: number;
	padding: number[];
	nextOff: number;
	unknown1?: number;
	unknown2?: number;
	unknown3?: number;
	unknown4?: number;
	unknown5?: number;
};

export type nkm_section_EPOI = {
	pos: vec3;
	radius: number;
	drifting: number;
	unknown1: number;
	unknown2: number;
	pointSize: number;
	cpuDrift: number;
	nextOff: number;
};

export type nkm_section_MEPO = {
	pos: vec3;
	radius: number;
	drifting: number;
	unknown1: number;
	pointSize: number;
	cpuDrift: number;
	nextOff: number;
};

export type nkm_section_AREA = {
	pos: vec3;
	position: vec3;
	dimensions: vec3;
	length: vec3;
	xVector: vec3;
	yVector: vec3;
	zVector: vec3;
	param0: number;
	param1: number;
	enemyPointId: number;
	shape: number;
	cameraId: number;
	type: number;
	field45: number;
	field46: number;
	field47: number;
	came: number;
	one?: number;
	nextOff: number;
};

export type nkm_section_CAME = {
	position: vec3;
	rotation: vec3;
	target1: vec3;
	target2: vec3;
	fovBegin: number;
	fovBeginSin: number;
	fovBeginCos: number;
	fovEnd: number;
	fovEndSin: number;
	fovEndCos: number;
	fovSpeed: number;
	type: number;
	pathId: number;
	routeSpeed: number;
	targetSpeed: number;
	duration: number;
	next: number;
	introFirst: number;
	unknown: number;
	pos1: vec3;
	pos2: vec3;
	pos3: vec3;
	angle: vec3;
	zoomSpeedM1: number;
	zoomStart: number;
	zoomEnd: number;
	zoomSpeedM2: number;
	zoomMark1: number;
	zoomMark2: number;
	zoomSpeed: number;
	camType: number;
	camRoute: number;
	pointSpeed: number;
	nextCam: number;
	firstCam: number;
	one: number;
	nextOff: number;
};

export type nkm_STAGObj = {
	type: "STAG";
	courseID: number;
	courseId: number;
	laps: number;
	nrLaps: number;
	polePosition: number;
	fogEnable: number;
	fogEnabled: number;
	fogMode: number;
	fogTableGenMode: number;
	fogSlope: number;
	unknown2: number[];
	fogDensity: number;
	fogDist: number;
	fogColorRaw: number;
	fogCol: number[];
	fogAlpha: number;
	kclCol: number[][];
	mobjFarClip: number;
	frustumFar: number;
};

type SectionContent =
	| nkm_section_CAME
	| nkm_section_AREA
	| nkm_section_MEPO
	| nkm_section_EPOI
	| nkm_section_IPOI
	| nkm_section_MEPA
	| nkm_section_CPAT
	| nkm_section_IPAT
	| nkm_section_CPOI
	| nkm_section_KTPJ
	| nkm_section_KTPM
	| nkm_section_KTPC
	| nkm_section_KTP2
	| nkm_section_KTPS
	| nkm_section_POIT
	| nkm_section_PATH
	| nkm_section_OBJI;

type SectionObj = nkm_STAGObj | { type: string; entries: SectionContent[] };

type Section<T extends SectionContent> = {
	type: string;
	entries: T[];
};

export type nkm_Section = {
	STAG: nkm_STAGObj;
	OBJI: Section<nkm_section_OBJI>;
	PATH: Section<nkm_section_PATH>;
	POIT: Section<nkm_section_POIT>;
	KTPS: Section<nkm_section_KTPS>;
	KTPJ: Section<nkm_section_KTPJ>;
	CPOI: Section<nkm_section_CPOI>;
	CPAT: Section<nkm_section_CPAT>;
	MEPA: Section<nkm_section_MEPA>;
	IPOI: Section<nkm_section_IPOI>;
	EPOI: Section<nkm_section_EPOI>;
	MEPO: Section<nkm_section_MEPO>;
	AREA: Section<nkm_section_AREA>;
	CAME: Section<nkm_section_CAME>;
	KTP2: Section<nkm_section_KTP2>;
	KTPC: Section<nkm_section_KTPC>;
	KTPM: Section<nkm_section_KTPM>;
	IPAT: Section<nkm_section_IPAT>;
	EPAT: Section<nkm_section_IPAT>;
};

export class nkm implements MKJSDataFormator {
	input: MKJSDataInput;
	view!: DataView;
	handlers: {
		[x: string]: (view: DataView, off: number) => SectionContent;
	};
	sections!: nkm_Section;
	stamp!: string;
	version!: number;
	constructor(input: MKJSDataInput) {
		this.input = input;
		//todo, support versions for other games (MKWii etc)
		//this.mkwii = mkwii;

		this.handlers = {};

		this.handlers["OBJI"] = (view: DataView, off: number): nkm_section_OBJI => {
			const pos = readVecFx32(view, off);
			const angle = readVecFx32(view, off + 0xc);
			const scale = readVecFx32(view, off + 0x18);

			const objectId = view.getUint16(off + 0x24, true);
			const pathId = view.getInt16(off + 0x26, true);
			const routeID = view.getUint16(off + 0x26, true);
			const settings = Array.from({ length: 7 }, (_, i) => view.getInt16(off + 0x28 + i * 2, true));
			const flags = view.getInt16(off + 0x36, true);
			const showsInTT = view.getUint16(off + 0x38, true);
			const padding = view.getUint16(off + 0x3a, true);

			const setting1 = view.getUint32(off + 0x28, true);
			const setting2 = view.getUint32(off + 0x2c, true);
			const setting3 = view.getUint32(off + 0x30, true);
			const setting4 = view.getUint32(off + 0x34, true);
			const timeTrials = view.getUint32(off + 0x38, true);
			const nextOff = off + 0x3c;

			return {
				ID: objectId,
				objectId,
				routeID,
				pathId,
				settings,
				flags,
				showsInTT,
				timeTrials,
				padding,
				setting1,
				setting2,
				setting3,
				setting4,
				nextOff,
				scale,
				pos,
				angle,
			};
		};

		this.handlers["PATH"] = (view: DataView, off: number): nkm_section_PATH => {
			const routeID = view.getUint8(off);
			const loop = view.getUint8(off + 1);
			const numPts = view.getUint16(off + 2, true);
			const nextOff = off + 0x4;
			return {
				routeID,
				loop,
				numPts,
				nextOff,
			};
		};

		this.handlers["POIT"] = (view: DataView, off: number): nkm_section_POIT => {
			const pos = readVecFx32(view, off);
			const pointIndex = view.getUint8(off + 0xc);
			const unknown1 = view.getUint8(off + 0xd);
			const duration = view.getInt16(off + 0xe, true);
			const unknown2 = view.getUint32(off + 0x10, true);
			const nextOff = off + 0x14;

			return {
				pos,
				pointIndex,
				pointInd: pointIndex,
				duration,
				unknown1,
				unknown2,
				nextOff,
			};
		};

		this.handlers["KTPS"] = (view: DataView, off: number): nkm_section_KTPS => {
			const { pos, angle } = readKartPointBase(view, off);
			const padding = view.getUint16(off + 0x18, true);
			const index = view.getInt16(off + 0x1a, true);
			const nextOff = off + 0x1c;

			return {
				pos,
				angle,
				padding,
				index,
				id1: padding,
				id2: index,
				nextOff,
			};
		};

		this.handlers["KTPJ"] = (view: DataView, off: number): nkm_section_KTPJ => {
			const { pos, angle } = readKartPointBase(view, off);
			const enemyPointId = view.getUint16(off + 0x18, true);
			const itemPointId = view.getUint16(off + 0x1a, true);
			const id = view.getInt16(off + 0x1c, true);
			const padding = view.getUint16(off + 0x1e, true);
			const nextOff = off + 0x20;

			return {
				pos,
				angle,
				enemyPointId,
				itemPointId,
				id,
				padding,
				id1: enemyPointId,
				id2: itemPointId,
				respawnID: id,
				nextOff,
			};
		};

		this.handlers["KTP2"] = (view: DataView, off: number): nkm_section_KTP2 => {
			const { pos, angle } = readKartPointBase(view, off);
			const padding = view.getUint16(off + 0x18, true);
			const id = view.getUint16(off + 0x1a, true);
			const nextOff = off + 0x1c;

			return {
				pos,
				angle,
				padding,
				id,
				id1: padding,
				id2: id,
				nextOff,
			};
		};

		this.handlers["KTPC"] = (view: DataView, off: number): nkm_section_KTPC => {
			const { pos, angle } = readKartPointBase(view, off);
			const nextMepo = view.getInt16(off + 0x18, true);
			const id = view.getUint16(off + 0x1a, true);
			const nextOff = off + 0x1c;

			return {
				pos,
				angle,
				nextMepo,
				id,
				id1: nextMepo,
				id2: id,
				nextOff,
			};
		};

		this.handlers["KTPM"] = (view: DataView, off: number): nkm_section_KTPM => {
			const { pos, angle } = readKartPointBase(view, off);
			const padding = view.getUint16(off + 0x18, true);
			const id = view.getInt16(off + 0x1a, true);
			const nextOff = off + 0x1c;

			return {
				pos,
				angle,
				padding,
				id,
				id1: padding,
				id2: id,
				nextOff,
			};
		};

		this.handlers["CPOI"] = (view: DataView, off: number): nkm_section_CPOI => {
			const x1 = view.getInt32(off, true) / FX32_SCALE;
			const z1 = view.getInt32(off + 0x4, true) / FX32_SCALE;
			const x2 = view.getInt32(off + 0x8, true) / FX32_SCALE;
			const z2 = view.getInt32(off + 0xc, true) / FX32_SCALE;
			const sinus = view.getInt32(off + 0x10, true) / FX32_SCALE;
			const cosinus = view.getInt32(off + 0x14, true) / FX32_SCALE;
			const distance = view.getInt32(off + 0x18, true) / FX32_SCALE;

			const gotoSection = view.getInt16(off + 0x1c, true);
			const startSection = view.getInt16(off + 0x1e, true);
			const keyId = view.getInt16(off + 0x20, true);
			const respawnId = view.getUint8(off + 0x22);
			const flags = view.getUint8(off + 0x23);
			const nextOff = off + 0x24;

			return {
				x1,
				z1,
				x2,
				z2,
				sinus,
				cosinus,
				distance,
				gotoSection,
				startSection,
				keyId,
				respawnId,
				flags,
				nextSection: gotoSection,
				currentSection: startSection,
				keyPoint: keyId,
				respawn: respawnId,
				unknown: flags,
				nextOff,
			};
		};

		this.handlers["CPAT"] = (view: DataView, off: number): nkm_section_CPAT => {
			const start = view.getUint16(off, true);
			const length = view.getUint16(off + 0x2, true);
			const next = readLinks3(view, off + 0x4);
			const previous = readLinks3(view, off + 0x7);
			const sectionOrder = view.getUint8(off + 0xa);
			const nextOff = off + 0xc;

			return {
				start,
				length,
				next,
				previous,
				sectionOrder,
				startInd: start,
				pathLen: length,
				dest: next,
				source: previous,
				nextOff,
			};
		};

		this.handlers["IPAT"] = (view: DataView, off: number): nkm_section_IPAT => {
			const start = view.getUint16(off, true);
			const length = view.getUint16(off + 0x2, true);
			const next = readLinks3(view, off + 0x4);
			const previous = readLinks3(view, off + 0x7);
			const sectionOrder = view.getInt16(off + 0xa, true);
			const nextOff = off + 0xc;

			return {
				start,
				length,
				next,
				previous,
				sectionOrder,
				startInd: start,
				pathLen: length,
				dest: next,
				source: previous,
				nextOff,
			};
		};

		this.handlers["EPAT"] = this.handlers["IPAT"];

		this.handlers["MEPA"] = (view: DataView, off: number): nkm_section_MEPA => {
			const start = view.getUint16(off, true);
			const length = view.getUint16(off + 0x2, true);
			const next = readLinks8(view, off + 0x4);
			const previous = readLinks8(view, off + 0xc);
			const nextOff = off + 0x14;

			return {
				start,
				length,
				next,
				previous,
				startInd: start,
				pathLen: length,
				dest: next,
				source: previous,
				nextOff,
			};
		};

		this.handlers["IPOI"] = (view: DataView, off: number): nkm_section_IPOI => {
			const pos = readVecFx32(view, off);
			const radius = view.getInt32(off + 0xc, true) / FX32_SCALE;
			const recalcIdx = view.getUint8(off + 0x10);
			const padding = [
				view.getUint8(off + 0x11),
				view.getUint8(off + 0x12),
				view.getUint8(off + 0x13),
			];
			const nextOff = off + 0x14;

			return {
				pos,
				radius,
				recalcIdx,
				padding,
				unknown1: recalcIdx,
				unknown2: padding[0],
				unknown3: padding[1],
				unknown4: padding[2],
				nextOff,
			};
		};

		this.handlers["EPOI"] = (view: DataView, off: number): nkm_section_EPOI => {
			const pos = readVecFx32(view, off);
			const radius = view.getInt32(off + 0xc, true) / FX32_SCALE;
			const drifting = view.getUint16(off + 0x10, true);
			const unknown1 = view.getUint16(off + 0x12, true);
			const unknown2 = view.getUint32(off + 0x14, true);
			const nextOff = off + 0x18;

			return {
				pos,
				radius,
				drifting,
				unknown1,
				unknown2,
				pointSize: radius,
				cpuDrift: drifting,
				nextOff,
			};
		};

		this.handlers["MEPO"] = (view: DataView, off: number): nkm_section_MEPO => {
			const pos = readVecFx32(view, off);
			const radius = view.getInt32(off + 0xc, true) / FX32_SCALE;
			const drifting = view.getUint32(off + 0x10, true);
			const unknown1 = view.getUint32(off + 0x14, true);
			const nextOff = off + 0x18;

			return {
				pos,
				radius,
				drifting,
				unknown1,
				pointSize: radius,
				cpuDrift: drifting,
				nextOff,
			};
		};

		this.handlers["AREA"] = (view: DataView, off: number): nkm_section_AREA => {
			const position = readVecFx32(view, off);
			const length = readVecFx32(view, off + 0xc);
			const xVector = readVecFx32(view, off + 0x18);
			const yVector = readVecFx32(view, off + 0x24);
			const zVector = readVecFx32(view, off + 0x30);
			const param0 = view.getInt16(off + 0x3c, true);
			const param1 = view.getInt16(off + 0x3e, true);
			const enemyPointId = view.getInt16(off + 0x40, true);
			const shape = view.getUint8(off + 0x42);
			const cameraId = view.getUint8(off + 0x43);
			const type = view.getUint8(off + 0x44);
			const field45 = view.getUint8(off + 0x45);
			const field46 = view.getUint8(off + 0x46);
			const field47 = view.getUint8(off + 0x47);
			const nextOff = off + 0x48;

			return {
				pos: position,
				position,
				dimensions: length,
				length,
				xVector,
				yVector,
				zVector,
				param0,
				param1,
				enemyPointId,
				shape,
				cameraId,
				type,
				field45,
				field46,
				field47,
				came: cameraId,
				one: field45,
				nextOff,
			};
		};

		this.handlers["CAME"] = (view: DataView, off: number): nkm_section_CAME => {
			const position = readVecFx32(view, off);
			const rotation = readVecFx32(view, off + 0xc);
			const target1 = readVecFx32(view, off + 0x18);
			const target2 = readVecFx32(view, off + 0x24);

			const fovBegin = view.getUint16(off + 0x30, true);
			const fovBeginSin = view.getInt16(off + 0x32, true) / FX32_SCALE;
			const fovBeginCos = view.getInt16(off + 0x34, true) / FX32_SCALE;
			const fovEnd = view.getUint16(off + 0x36, true);
			const fovEndSin = view.getInt16(off + 0x38, true) / FX32_SCALE;
			const fovEndCos = view.getInt16(off + 0x3a, true) / FX32_SCALE;
			const fovSpeed = view.getInt16(off + 0x3c, true);
			const type = view.getUint16(off + 0x3e, true);
			const pathId = view.getInt16(off + 0x40, true);
			const routeSpeed = view.getInt16(off + 0x42, true);
			const targetSpeed = view.getUint16(off + 0x44, true);
			const duration = view.getUint16(off + 0x46, true);
			const next = view.getInt16(off + 0x48, true);
			const introFirst = view.getUint8(off + 0x4a);
			const unknown = view.getUint8(off + 0x4b);
			const nextOff = off + 0x4c;

			return {
				position,
				rotation,
				target1,
				target2,
				fovBegin,
				fovBeginSin,
				fovBeginCos,
				fovEnd,
				fovEndSin,
				fovEndCos,
				fovSpeed,
				type,
				pathId,
				routeSpeed,
				targetSpeed,
				duration,
				next,
				introFirst,
				unknown,
				pos1: position,
				pos2: target1,
				pos3: target2,
				angle: rotation,
				zoomSpeedM1: fovBegin / FX32_SCALE,
				zoomStart: fovBeginSin,
				zoomEnd: fovBeginCos,
				zoomSpeedM2: fovEnd / FX32_SCALE,
				zoomMark1: fovEndSin,
				zoomMark2: fovEndCos,
				zoomSpeed: fovSpeed / FX32_SCALE,
				camType: type,
				camRoute: pathId,
				pointSpeed: targetSpeed,
				nextCam: next,
				firstCam: introFirst,
				one: unknown,
				nextOff,
			};
		};

		if (this.input != null) {
			if (typeof this.input == "string") {
				const xml = new XMLHttpRequest();
				xml.responseType = "arraybuffer";
				xml.open("GET", this.input, true);
				xml.onload = () => {
					this.load(xml.response);
				};
				xml.send();
			} else {
				this.load(this.input);
			}
		}
	}

	load(buffer: MKJSDataInput) {
		buffer = MKSUtils.prepareInput(buffer);
		const view = new DataView(buffer);
		this.stamp =
			MKSUtils.asciireadChar(view, 0x0) +
			MKSUtils.asciireadChar(view, 0x1) +
			MKSUtils.asciireadChar(view, 0x2) +
			MKSUtils.asciireadChar(view, 0x3);
		this.version = view.getUint16(0x4, true);
		const n = view.getUint16(0x6, true);
		let off = 8;
		this.sections = {
			STAG: undefined!,
			OBJI: undefined!,
			PATH: undefined!,
			POIT: undefined!,
			KTPS: undefined!,
			KTPJ: undefined!,
			CPOI: undefined!,
			CPAT: undefined!,
			MEPA: undefined!,
			IPOI: undefined!,
			EPOI: undefined!,
			MEPO: undefined!,
			AREA: undefined!,
			CAME: undefined!,
			KTP2: undefined!,
			KTPC: undefined!,
			KTPM: undefined!,
			IPAT: undefined!,
			EPAT: undefined!,
		};

		for (let i = 0; i < (n - 8) / 4; i++) {
			const soff = view.getUint32(off, true);
			const section = this._readSection(view, soff + n);
			if (section.type === "STAG" && "courseId" in section) {
				this.sections.STAG = section;
			} else if (Object.prototype.hasOwnProperty.call(this.sections, section.type)) {
				const t = section.type as unknown as keyof nkm_Section;
				(this.sections[t] as unknown) = section;
			}
			off += 4;
		}
	}

	private _readSTAG(view: DataView, off: number): nkm_STAGObj {
		const courseId = view.getUint16(off + 0x4, true);
		const nrLaps = view.getUint16(off + 0x6, true);
		const polePosition = view.getUint8(off + 0x8);
		const fogEnabled = view.getUint8(off + 0x9);
		const fogTableGenMode = view.getUint8(off + 0xa);
		const fogSlope = view.getUint8(off + 0xb);
		const unknown2 = Array.from({ length: 8 }, (_, i) => view.getUint8(off + 0xc + i));

		const fogDensity = view.getInt32(off + 0x14, true) / FX32_SCALE;
		const fogColorRaw = view.getUint32(off + 0x18, true);
		const fogCol = [fogColorRaw & 0xff, (fogColorRaw >> 8) & 0xff, (fogColorRaw >> 16) & 0xff];
		const fogAlpha = (fogColorRaw >> 24) & 0xff;

		const kclCol = [
			readRgb555(view, off + 0x1c),
			readRgb555(view, off + 0x1e),
			readRgb555(view, off + 0x20),
			readRgb555(view, off + 0x22),
		];

		const mobjFarClip = view.getInt32(off + 0x24, true) / FX32_SCALE;
		const frustumFar = view.getInt32(off + 0x28, true) / FX32_SCALE;

		return {
			type: "STAG",
			courseID: courseId,
			courseId,
			laps: nrLaps,
			nrLaps,
			polePosition,
			fogEnable: fogEnabled,
			fogEnabled,
			fogMode: fogTableGenMode,
			fogTableGenMode,
			fogSlope,
			unknown2,
			fogDensity,
			fogDist: fogDensity,
			fogColorRaw,
			fogCol,
			fogAlpha,
			kclCol,
			mobjFarClip,
			frustumFar,
		};
	}

	private _readSection(view: DataView, off: number): SectionObj {
		const type =
			MKSUtils.asciireadChar(view, off + 0x0) +
			MKSUtils.asciireadChar(view, off + 0x1) +
			MKSUtils.asciireadChar(view, off + 0x2) +
			MKSUtils.asciireadChar(view, off + 0x3);
		if (type == "STAG") {
			const stag = this._readSTAG(view, off);
			console.log(stag)
			return stag
		}

		const handler = this.handlers[type];
		const obj: { type: string; entries: SectionContent[] } = {
			type,
			entries: [],
		};
		if (handler == null) {
			console.error(`Unknown NKM section type ${type}!`);
			return obj;
		}
		const entN = view.getUint32(off + 0x4, true);
		off += 0x8;
		for (let i = 0; i < entN; i++) {
			const item = handler(view, off);
			obj.entries.push(item);
			off = item.nextOff;
		}
		return obj;
	}
}
