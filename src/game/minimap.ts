//
// minimap.ts
//--------------------
// Top-right course map. The track shape is built from the course's checkpoint lines (CPOI), each of
// which spans the road edge to edge, so joining consecutive ones gives the real road outline.
//

import type { courseScene } from "../engine/scenes/courseScene";
import type { Kart } from "../entities/kart";
import type { nkm_section_CPAT, nkm_section_CPOI } from "../formats/nkm";

type Pt = [number, number];

export type MinimapRacer = { kart: Kart; color: string; portrait: HTMLImageElement | null; isPlayer: boolean };

const PADDING = 12;
const ITEM_COLORS: Record<string, string> = {
	koura_g: "#3ddc4a",
	koura_r: "#ff3b30",
	banana: "#ffd60a",
	f_box: "#ff9f0a",
	bomb: "#1c1c1e",
};

export class Minimap {
	readonly canvas: HTMLCanvasElement;
	private _ctx: CanvasRenderingContext2D;
	private _track: HTMLCanvasElement | null = null;
	private _scale = 1;
	private _min: Pt = [0, 0];
	private _off: Pt = [0, 0];
	private _size: number;
	private _dpr: number;

	constructor(
		private scene: courseScene,
		private racers: MinimapRacer[],
		size = 200
	) {
		this._size = size;
		this._dpr = Math.min(2, window.devicePixelRatio || 1);
		this.canvas = document.createElement("canvas");
		this.canvas.className = "minimap";
		this.canvas.width = size * this._dpr;
		this.canvas.height = size * this._dpr;
		this.canvas.style.width = size + "px";
		this.canvas.style.height = size + "px";
		this._ctx = this.canvas.getContext("2d")!;
		this._buildTrack();
	}

	/** False for courses without checkpoint data (battle arenas). */
	get available() {
		return this._track != null;
	}

	private _toMap(x: number, z: number): Pt {
		return [(x - this._min[0]) * this._scale + this._off[0], (z - this._min[1]) * this._scale + this._off[1]];
	}

	private _buildTrack() {
		const nkm = this.scene.nkm;
		const cps = nkm.sections["CPOI"]?.entries as nkm_section_CPOI[] | undefined;
		const paths = nkm.sections["CPAT"]?.entries as nkm_section_CPAT[] | undefined;
		if (!cps?.length || !paths?.length) return;

		// Each road segment is the quad between two consecutive checkpoint lines.
		const quads: [nkm_section_CPOI, nkm_section_CPOI][] = [];
		for (const p of paths) {
			const last = p.startInd + p.pathLen - 1;
			for (let i = p.startInd; i < last; i++) quads.push([cps[i], cps[i + 1]]);
			for (const d of p.dest) {
				const next = paths[d];
				if (next) quads.push([cps[last], cps[next.startInd]]);
			}
		}

		let minX = Infinity,
			minZ = Infinity,
			maxX = -Infinity,
			maxZ = -Infinity;
		for (const c of cps) {
			minX = Math.min(minX, c.x1, c.x2);
			maxX = Math.max(maxX, c.x1, c.x2);
			minZ = Math.min(minZ, c.z1, c.z2);
			maxZ = Math.max(maxZ, c.z1, c.z2);
		}
		const inner = this._size - PADDING * 2;
		this._scale = Math.min(inner / (maxX - minX || 1), inner / (maxZ - minZ || 1)) * this._dpr;
		this._min = [minX, minZ];
		const w = (maxX - minX) * this._scale;
		const h = (maxZ - minZ) * this._scale;
		this._off = [(this.canvas.width - w) / 2, (this.canvas.height - h) / 2];

		const track = document.createElement("canvas");
		track.width = this.canvas.width;
		track.height = this.canvas.height;
		const ctx = track.getContext("2d")!;
		const quadPath = (a: nkm_section_CPOI, b: nkm_section_CPOI) => {
			const pts = [this._toMap(a.x1, a.z1), this._toMap(a.x2, a.z2), this._toMap(b.x2, b.z2), this._toMap(b.x1, b.z1)];
			ctx.moveTo(pts[0][0], pts[0][1]);
			for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
			ctx.closePath();
		};
		ctx.lineJoin = "round";

		// Outline: the whole road stroked thick, then the road surface on top.
		ctx.beginPath();
		for (const [a, b] of quads) quadPath(a, b);
		ctx.strokeStyle = "rgba(10, 14, 40, 0.9)";
		ctx.lineWidth = 5 * this._dpr;
		ctx.stroke();
		ctx.fillStyle = "rgba(10, 14, 40, 0.9)";
		ctx.fill();

		ctx.beginPath();
		for (const [a, b] of quads) quadPath(a, b);
		ctx.strokeStyle = "#e9ecf5";
		ctx.lineWidth = 1 * this._dpr;
		ctx.stroke();
		ctx.fillStyle = "#e9ecf5";
		ctx.fill();

		// Checkered start/finish line on checkpoint 0.
		const s = cps[0];
		const a = this._toMap(s.x1, s.z1);
		const b = this._toMap(s.x2, s.z2);
		const segs = 8;
		ctx.lineWidth = 3 * this._dpr;
		ctx.lineCap = "butt";
		for (let i = 0; i < segs; i++) {
			ctx.beginPath();
			ctx.moveTo(a[0] + ((b[0] - a[0]) * i) / segs, a[1] + ((b[1] - a[1]) * i) / segs);
			ctx.lineTo(a[0] + ((b[0] - a[0]) * (i + 1)) / segs, a[1] + ((b[1] - a[1]) * (i + 1)) / segs);
			ctx.strokeStyle = i % 2 ? "#111" : "#fff";
			ctx.stroke();
		}
		this._track = track;
	}

	draw() {
		if (!this._track) return;
		const ctx = this._ctx;
		const d = this._dpr;
		ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		ctx.drawImage(this._track, 0, 0);

		// Thrown/dropped items on the track.
		for (const it of this.scene.items.items) {
			if (it.held || it.dead) continue;
			const color = ITEM_COLORS[it.type];
			if (!color) continue;
			const [x, y] = this._toMap(it.pos[0], it.pos[2]);
			ctx.beginPath();
			ctx.arc(x, y, 2.6 * d, 0, Math.PI * 2);
			ctx.fillStyle = color;
			ctx.fill();
			ctx.lineWidth = 1 * d;
			ctx.strokeStyle = "#fff";
			ctx.stroke();
		}

		// Racers, last place first so the leaders (and you) draw on top.
		const order = this.racers.slice().sort((a, b) => (a.isPlayer ? 1 : b.isPlayer ? -1 : b.kart.placement - a.kart.placement));
		for (const r of order) {
			const [x, y] = this._toMap(r.kart.pos[0], r.kart.pos[2]);
			const rad = (r.isPlayer ? 9 : 7) * d;
			if (r.isPlayer) {
				// Heading pointer.
				const dir = r.kart.physicalDir;
				ctx.save();
				ctx.translate(x, y);
				ctx.rotate(dir);
				ctx.beginPath();
				ctx.moveTo(0, -rad - 7 * d);
				ctx.lineTo(5 * d, -rad + 1 * d);
				ctx.lineTo(-5 * d, -rad + 1 * d);
				ctx.closePath();
				ctx.fillStyle = "#ffcc1a";
				ctx.fill();
				ctx.restore();
			}
			ctx.beginPath();
			ctx.arc(x, y, rad, 0, Math.PI * 2);
			ctx.fillStyle = r.color;
			ctx.fill();
			if (r.portrait?.complete) {
				ctx.save();
				ctx.beginPath();
				ctx.arc(x, y, rad - 1 * d, 0, Math.PI * 2);
				ctx.clip();
				ctx.drawImage(r.portrait, x - rad, y - rad * 1.05, rad * 2, rad * 2);
				ctx.restore();
			}
			ctx.beginPath();
			ctx.arc(x, y, rad, 0, Math.PI * 2);
			ctx.lineWidth = (r.isPlayer ? 2.5 : 1.5) * d;
			ctx.strokeStyle = r.isPlayer ? "#ffcc1a" : "#fff";
			ctx.stroke();
		}
	}
}
