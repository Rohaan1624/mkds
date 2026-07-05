import { describe, expect, it } from "vitest";
import { BinaryWriter } from "../helpers/binary";
import { nkm } from "../../src/formats/nkm";

function buildNkmWithSections(sections: { type: string; body: ArrayBuffer }[]): ArrayBuffer {
	const headerLen = 8 + sections.length * 4;
	let cursor = headerLen;
	const offsets: number[] = [];
	const sectionBuffers: ArrayBuffer[] = [];

	for (const section of sections) {
		offsets.push(cursor - headerLen);
		const writer = new BinaryWriter();
		writer.writeAscii(section.type, 4);
		writer.writeBytes(new Uint8Array(section.body));
		const buf = writer.toArrayBuffer();
		sectionBuffers.push(buf);
		cursor += buf.byteLength;
	}

	const header = new BinaryWriter();
	header.writeAscii("NKMD", 4);
	header.writeU16(37);
	header.writeU16(headerLen);
	for (const offset of offsets) {
		header.writeU32(offset);
	}
	for (const sectionBuffer of sectionBuffers) {
		header.writeBytes(new Uint8Array(sectionBuffer));
	}
	return header.toArrayBuffer();
}

function buildCountedSection(type: string, count: number, entryWriter: (w: BinaryWriter) => void): ArrayBuffer {
	const entry = new BinaryWriter();
	entryWriter(entry);
	const body = new BinaryWriter();
	body.writeU32(count);
	body.writeBytes(new Uint8Array(entry.toArrayBuffer()));
	return buildNkmWithSections([{ type, body: body.toArrayBuffer() }]);
}

describe("nkm section offsets", () => {
	it("parses OBJI settings, flags and showsInTT", () => {
		const buffer = buildCountedSection("OBJI", 1, (w) => {
			w.writeI32(0).writeI32(0).writeI32(0); // position
			w.writeI32(0).writeI32(0).writeI32(0); // rotation
			w.writeI32(4096).writeI32(4096).writeI32(4096); // scale
			w.writeU16(0x1234); // objectId
			w.writeU16(0xffff); // pathId as u16 bits for -1
			for (let i = 0; i < 7; i++) w.writeU16(0x0100 + i); // settings s16
			w.writeU16(0x00aa); // flags
			w.writeU16(0x0001); // showsInTT
			w.writeU16(0xbeef); // padding
		});

		const track = new nkm(buffer);
		const obji = track.sections.OBJI.entries[0];
		expect(obji.objectId).toBe(0x1234);
		expect(obji.pathId).toBe(-1);
		expect(obji.routeID).toBe(0xffff);
		expect(obji.settings).toEqual([0x0100, 0x0101, 0x0102, 0x0103, 0x0104, 0x0105, 0x0106]);
		expect(obji.flags).toBe(0x00aa);
		expect(obji.showsInTT).toBe(1);
		expect(obji.padding).toBe(0xbeef);
		expect(obji.setting1).toBe((0x0101 << 16) | 0x0100);
	});

	it("parses STAG course metadata and clip distances", () => {
		const body = new BinaryWriter();
		body.writeU16(7); // courseId
		body.writeU16(3); // nrLaps
		body.writeU8(2); // polePosition
		body.writeU8(1); // fogEnabled
		body.writeU8(0); // fogTableGenMode
		body.writeU8(4); // fogSlope
		body.writeZeros(8); // unknown2
		body.writeI32(8192); // fogDensity
		body.writeU32(0x80402010); // fogColor
		for (let i = 0; i < 4; i++) body.writeU16(0x7c00); // kclColors
		body.writeI32(40960); // mobjFarClip
		body.writeI32(81920); // frustumFar

		const track = new nkm(buildNkmWithSections([{ type: "STAG", body: body.toArrayBuffer() }]));
		expect(track.sections.STAG.type).toBe("STAG");
		expect(track.sections.STAG.courseId).toBe(7);
		expect(track.sections.STAG.nrLaps).toBe(3);
		expect(track.sections.STAG.mobjFarClip).toBeCloseTo(10);
		expect(track.sections.STAG.frustumFar).toBeCloseTo(20);
		expect(track.sections.STAG.fogDist).toBeCloseTo(2);
	});

	it("parses IPOI radius and recalcIdx", () => {
		const buffer = buildCountedSection("IPOI", 1, (w) => {
			w.writeI32(0).writeI32(0).writeI32(0);
			w.writeI32(8192); // radius fx32
			w.writeU8(5); // recalcIdx
			w.writeU8(0).writeU8(0).writeU8(0); // padding
		});

		const track = new nkm(buffer);
		const ipoi = track.sections.IPOI.entries[0];
		expect(ipoi.radius).toBeCloseTo(2);
		expect(ipoi.recalcIdx).toBe(5);
	});

	it("parses MEPO drifting as u32", () => {
		const buffer = buildCountedSection("MEPO", 1, (w) => {
			w.writeI32(0).writeI32(0).writeI32(0);
			w.writeI32(4096); // radius
			w.writeU32(0x12345678); // drifting
			w.writeU32(0x9abcdef0); // unknown1
		});

		const track = new nkm(buffer);
		const mepo = track.sections.MEPO.entries[0];
		expect(mepo.radius).toBeCloseTo(1);
		expect(mepo.drifting).toBe(0x12345678);
		expect(mepo.unknown1).toBe(0x9abcdef0);
		expect(mepo.pointSize).toBeCloseTo(1);
		expect(mepo.cpuDrift).toBe(0x12345678);
	});

	it("parses AREA type, cameraId and params", () => {
		const buffer = buildCountedSection("AREA", 1, (w) => {
			for (let i = 0; i < 5; i++) {
				w.writeI32(0).writeI32(0).writeI32(0);
			}
			w.writeU16(0xffff); // param0 s16
			w.writeU16(0x0002); // param1 s16
			w.writeU16(0x0003); // enemyPointId s16
			w.writeU8(1); // shape
			w.writeU8(4); // cameraId
			w.writeU8(2); // type
			w.writeU8(0x11); // field45
			w.writeU8(0x22); // field46
			w.writeU8(0x33); // field47
		});

		const track = new nkm(buffer);
		const area = track.sections.AREA.entries[0];
		expect(area.param0).toBe(-1);
		expect(area.param1).toBe(2);
		expect(area.enemyPointId).toBe(3);
		expect(area.shape).toBe(1);
		expect(area.cameraId).toBe(4);
		expect(area.type).toBe(2);
		expect(area.came).toBe(4);
	});

	it("parses KTPJ id and padding", () => {
		const buffer = buildCountedSection("KTPJ", 1, (w) => {
			w.writeI32(0).writeI32(0).writeI32(0);
			w.writeI32(0).writeI32(0).writeI32(0);
			w.writeU16(1); // enemyPointId
			w.writeU16(2); // itemPointId
			w.writeU16(0xffff); // id s16 as u16 bits
			w.writeU16(0xabcd); // padding
		});

		const track = new nkm(buffer);
		const ktpj = track.sections.KTPJ.entries[0];
		expect(ktpj.enemyPointId).toBe(1);
		expect(ktpj.itemPointId).toBe(2);
		expect(ktpj.id).toBe(-1);
		expect(ktpj.padding).toBe(0xabcd);
		expect(ktpj.respawnID).toBe(-1);
	});

	it("reads CPAT sectionOrder as u8 and IPAT as s16", () => {
		const cpatBuffer = buildCountedSection("CPAT", 1, (w) => {
			w.writeU16(0).writeU16(1);
			w.writeU8(0).writeU8(1).writeU8(0xff);
			w.writeU8(2).writeU8(0xff).writeU8(0xff);
			w.writeU8(0x7f);
		});
		const cpat = new nkm(cpatBuffer).sections.CPAT.entries[0];
		expect(cpat.sectionOrder).toBe(0x7f);
		expect(cpat.next).toEqual([0, 1]);
		expect(cpat.previous).toEqual([2]);

		const ipatBuffer = buildCountedSection("IPAT", 1, (w) => {
			w.writeU16(0).writeU16(1);
			w.writeU8(0xff).writeU8(0xff).writeU8(0xff);
			w.writeU8(0xff).writeU8(0xff).writeU8(0xff);
			w.writeU16(0xfffe); // sectionOrder s16 = -2
		});
		const ipat = new nkm(ipatBuffer).sections.IPAT.entries[0];
		expect(ipat.sectionOrder).toBe(-2);
		expect(ipat.next).toEqual([]);
	});
});
