// course-viewer.js
// -----------------
// Standalone NKM / course debug viewer. Loads a course from a ROM already loaded via
// bundle.js globals (fileStore, ndsFS, narc, lz77, kcl, nkm, nsbmd, nsbtx, nsbta, nsbtp,
// nitroModel, nitroRender, ObjDatabase, MKDSCONST, MKDS_COLTYPE, vec3, mat4) and renders:
//  - the course collision mesh (kcl) and/or the real 3D course model (nsbmd)
//  - every NKM section as a colour-coded gizmo (objects, paths, checkpoints, item/enemy
//    points, mission points, areas, cameras, kart start/respawn points)
// with a free-fly camera and a sidebar for inspecting raw field values.

(function () {
	"use strict";

	// -----------------------------------------------------------------------
	// Globals / state
	// -----------------------------------------------------------------------

	var gl = null;
	var gameROM = null;
	var course = null; // { name, mainNarc, texNarc, nkm, kcl, model, sky, paths }
	var gizmo = { program: null, aPos: -1, aColor: -1, uMVP: null };
	var buffers = { lines: null, lineCount: 0, tris: null, triCount: 0, sel: null, selCount: 0 };
	var pickList = []; // [{type, index, pos, radius, label}]
	var selected = null; // {type, index}

	var layers = {
		MODEL: true,
		KCL: false,
		OBJI: true,
		PATH: true,
		KTPS: true,
		KTPJ: true,
		KTP2: true,
		KTPC: true,
		KTPM: true,
		CPOI: true,
		IPOI: true,
		EPOI: true,
		MEPO: true,
		AREA: true,
		CAME: true,
	};

	var LAYER_LABELS = {
		MODEL: "3D model",
		KCL: "Collision (KCL)",
		OBJI: "Objects (OBJI)",
		PATH: "Routes (PATH/POIT)",
		KTPS: "Start grid (KTPS)",
		KTPJ: "Respawn (KTPJ)",
		KTP2: "KTP2",
		KTPC: "KTPC",
		KTPM: "KTPM",
		CPOI: "Checkpoints (CPOI)",
		IPOI: "Item pts (IPOI)",
		EPOI: "Enemy pts (EPOI)",
		MEPO: "Mission pts (MEPO)",
		AREA: "Areas (AREA)",
		CAME: "Cameras (CAME)",
	};

	var cam = {
		pos: [0, 500, 0],
		yaw: 0,
		pitch: -0.6,
		speed: 400,
	};

	var keys = Object.create(null);
	var drag = { active: false, lastX: 0, lastY: 0 };

	var animFrame = 0;
	var animRemainder = 0;

	// -----------------------------------------------------------------------
	// Small colour helpers
	// -----------------------------------------------------------------------

	function hsl(h, s, l, a) {
		h = ((h % 360) + 360) % 360;
		s /= 100;
		l /= 100;
		var c = (1 - Math.abs(2 * l - 1)) * s;
		var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
		var m = l - c / 2;
		var r, g, b;
		if (h < 60) {
			r = c;
			g = x;
			b = 0;
		} else if (h < 120) {
			r = x;
			g = c;
			b = 0;
		} else if (h < 180) {
			r = 0;
			g = c;
			b = x;
		} else if (h < 240) {
			r = 0;
			g = x;
			b = c;
		} else if (h < 300) {
			r = x;
			g = 0;
			b = c;
		} else {
			r = c;
			g = 0;
			b = x;
		}
		return [r + m, g + m, b + m, a == null ? 1 : a];
	}

	function objectColor(objectId) {
		return hsl((objectId * 137.508) % 360, 70, 58, 1);
	}

	function routeColor(i) {
		return hsl((i * 63.5) % 360, 80, 60, 1);
	}

	var COLLISION_COLORS = {
		0x00: [0.55, 0.55, 0.58, 1], // road
		0x01: [0.45, 0.35, 0.2, 1], // offroad main
		0x02: [0.4, 0.3, 0.15, 1], // offroad3
		0x03: [0.35, 0.28, 0.14, 1], // offroad2
		0x04: [0.9, 0.5, 0.1, 1], // rainbow fall
		0x05: [0.5, 0.4, 0.2, 1], // offroad1
		0x06: [0.6, 0.85, 1, 1], // slippery (ice)
		0x07: [1, 0.6, 0, 1], // boost
		0x08: [0.8, 0.15, 0.15, 1], // wall
		0x09: [0.7, 0.1, 0.1, 1], // wall2
		0x0a: [0.05, 0.05, 0.05, 1], // OOB
		0x0b: [0.1, 0.05, 0.2, 1], // fall
		0x0c: [1, 0.8, 0, 1], // jump pad
		0x0d: [0.8, 0.4, 0.8, 1], // sticky
		0x0e: [0.9, 0.7, 0.2, 1], // small jump
		0x0f: [0.9, 0.2, 0.9, 1], // cannon
		0x10: [0.6, 0.15, 0.15, 1], // wall oob
		0x11: [0.15, 0.35, 0.9, 1], // falls water
		0x12: [1, 0.5, 0, 1], // boost2
		0x13: [0.2, 0.9, 0.9, 1], // loop
		0x14: [0.55, 0.55, 0.58, 1], // sound road
		0x15: [0.7, 0.2, 0.2, 1], // rr special wall
		0x1f: [1, 0, 0, 1], // knockback damage
	};

	function collisionColor(type) {
		return COLLISION_COLORS[type] || [0.3, 0.3, 0.3, 1];
	}

	var colTypeNames = null;
	function collisionTypeName(type) {
		if (colTypeNames == null) {
			colTypeNames = {};
			if (typeof MKDS_COLTYPE !== "undefined") {
				Object.keys(MKDS_COLTYPE).forEach(function (k) {
					var v = MKDS_COLTYPE[k];
					if (typeof v === "number" && colTypeNames[v] == null) colTypeNames[v] = k;
				});
			}
		}
		return colTypeNames[type] || "0x" + type.toString(16);
	}

	// -----------------------------------------------------------------------
	// Geometry helpers (line list / triangle list accumulators)
	// -----------------------------------------------------------------------

	function pushLine(arr, a, b, col) {
		arr.push(a[0], a[1], a[2], col[0], col[1], col[2], col[3]);
		arr.push(b[0], b[1], b[2], col[0], col[1], col[2], col[3]);
	}

	function pushTri(arr, a, b, c, col) {
		arr.push(a[0], a[1], a[2], col[0], col[1], col[2], col[3]);
		arr.push(b[0], b[1], b[2], col[0], col[1], col[2], col[3]);
		arr.push(c[0], c[1], c[2], col[0], col[1], col[2], col[3]);
	}

	var CUBE_LOCAL = [
		[-1, -1, -1],
		[1, -1, -1],
		[1, 1, -1],
		[-1, 1, -1],
		[-1, -1, 1],
		[1, -1, 1],
		[1, 1, 1],
		[-1, 1, 1],
	];
	var CUBE_EDGES = [
		[0, 1],
		[1, 2],
		[2, 3],
		[3, 0],
		[4, 5],
		[5, 6],
		[6, 7],
		[7, 4],
		[0, 4],
		[1, 5],
		[2, 6],
		[3, 7],
	];

	function pushBoxWireMat(arr, mat, col) {
		var pts = CUBE_LOCAL.map(function (p) {
			var v = vec3.create();
			vec3.transformMat4(v, p, mat);
			return v;
		});
		CUBE_EDGES.forEach(function (e) {
			pushLine(arr, pts[e[0]], pts[e[1]], col);
		});
	}

	// Corners enumerated with bit pattern sx,sy,sz (0=negative,1=positive) -> idx = sx*4+sy*2+sz
	var AXIS_EDGES = [
		[0, 1],
		[0, 2],
		[0, 4],
		[1, 3],
		[1, 5],
		[2, 3],
		[2, 6],
		[3, 7],
		[4, 5],
		[4, 6],
		[5, 7],
		[6, 7],
	];

	function pushBoxWireAxes(arr, center, ax, ay, az, col) {
		var corners = [];
		[-1, 1].forEach(function (sx) {
			[-1, 1].forEach(function (sy) {
				[-1, 1].forEach(function (sz) {
					corners.push([
						center[0] + ax[0] * sx + ay[0] * sy + az[0] * sz,
						center[1] + ax[1] * sx + ay[1] * sy + az[1] * sz,
						center[2] + ax[2] * sx + ay[2] * sy + az[2] * sz,
					]);
				});
			});
		});
		AXIS_EDGES.forEach(function (e) {
			pushLine(arr, corners[e[0]], corners[e[1]], col);
		});
	}

	function pushCross(arr, c, size, col) {
		pushLine(arr, [c[0] - size, c[1], c[2]], [c[0] + size, c[1], c[2]], col);
		pushLine(arr, [c[0], c[1] - size, c[2]], [c[0], c[1] + size, c[2]], col);
		pushLine(arr, [c[0], c[1], c[2] - size], [c[0], c[1], c[2] + size], col);
	}

	function pushCircle(arr, center, radius, plane, col, segs) {
		segs = segs || 20;
		var pts = [];
		for (var i = 0; i < segs; i++) {
			var t = (i / segs) * Math.PI * 2;
			var cc = Math.cos(t) * radius,
				ss = Math.sin(t) * radius;
			var p;
			if (plane === "xz") p = [center[0] + cc, center[1], center[2] + ss];
			else if (plane === "xy") p = [center[0] + cc, center[1] + ss, center[2]];
			else p = [center[0], center[1] + cc, center[2] + ss];
			pts.push(p);
		}
		for (var j = 0; j < segs; j++) pushLine(arr, pts[j], pts[(j + 1) % segs], col);
	}

	function pushSphereGizmo(arr, center, radius, col) {
		pushCircle(arr, center, radius, "xz", col);
		pushCircle(arr, center, radius, "xy", col);
		pushCircle(arr, center, radius, "yz", col);
	}

	function yawForward(yawDeg) {
		var r = (yawDeg * Math.PI) / 180;
		return [Math.sin(r), 0, Math.cos(r)];
	}

	// Simple forward-facing arrow gizmo for kart points (single yaw angle).
	function pushYawArrow(arr, pos, yawDeg, length, col) {
		var f = yawForward(yawDeg);
		var tip = [pos[0] + f[0] * length, pos[1] + f[1] * length, pos[2] + f[2] * length];
		pushLine(arr, pos, tip, col);
		var back = length * 0.28;
		var spread = (28 * Math.PI) / 180;
		var baseAng = Math.atan2(f[0], f[2]);
		[spread, -spread].forEach(function (a) {
			var ang = baseAng + Math.PI - a;
			var p = [tip[0] + Math.sin(ang) * back, tip[1], tip[2] + Math.cos(ang) * back];
			pushLine(arr, tip, p, col);
		});
	}

	// Full XYZ (degrees, Z*Y*X order matching objDecor.ts) forward vector, for OBJI.
	function objiForwardMat(angle) {
		var m = mat4.create();
		mat4.rotateZ(m, m, (angle[2] * Math.PI) / 180);
		mat4.rotateY(m, m, (angle[1] * Math.PI) / 180);
		mat4.rotateX(m, m, (angle[0] * Math.PI) / 180);
		return m;
	}

	function objiMatrix(pos, angle, scale, size) {
		var m = mat4.create();
		mat4.translate(m, m, pos);
		mat4.rotateZ(m, m, (angle[2] * Math.PI) / 180);
		mat4.rotateY(m, m, (angle[1] * Math.PI) / 180);
		mat4.rotateX(m, m, (angle[0] * Math.PI) / 180);
		mat4.scale(m, m, [Math.max(0.01, scale[0]) * size, Math.max(0.01, scale[1]) * size, Math.max(0.01, scale[2]) * size]);
		return m;
	}

	// -----------------------------------------------------------------------
	// WebGL setup (own tiny shader for gizmos, independent from nitroRender)
	// -----------------------------------------------------------------------

	function initGL(canvas) {
		var ctx = canvas.getContext("webgl", { premultipliedAlpha: false, stencil: true, antialias: true });
		ctx.clearColor(0.08, 0.09, 0.1, 1);
		ctx.enable(ctx.DEPTH_TEST);
		ctx.viewportWidth = canvas.width;
		ctx.viewportHeight = canvas.height;
		// nitroRender/nitroShaders reference a bare `gl` identifier (declared as a true
		// global in global.d.ts), so it must be reachable via `window.gl`, not just a
		// local variable inside this module's closure.
		window.gl = ctx;
		return ctx;
	}

	function resizeCanvas() {
		var canvas = document.getElementById("canvas3d");
		var w = canvas.clientWidth,
			h = canvas.clientHeight;
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		gl.viewportWidth = canvas.width;
		gl.viewportHeight = canvas.height;
	}

	function compileShader(src, type) {
		var s = gl.createShader(type);
		gl.shaderSource(s, src);
		gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
			var log = gl.getShaderInfoLog(s);
			gl.deleteShader(s);
			throw new Error("Shader compile error: " + log);
		}
		return s;
	}

	function initGizmoShader() {
		var vsSrc = [
			"attribute vec3 aPos;",
			"attribute vec4 aColor;",
			"uniform mat4 uMVP;",
			"varying vec4 vColor;",
			"void main() {",
			"  gl_Position = uMVP * vec4(aPos, 1.0);",
			"  vColor = aColor;",
			"}",
		].join("\n");
		var fsSrc = ["precision mediump float;", "varying vec4 vColor;", "void main() { gl_FragColor = vColor; }"].join("\n");
		var vs = compileShader(vsSrc, gl.VERTEX_SHADER);
		var fs = compileShader(fsSrc, gl.FRAGMENT_SHADER);
		var prog = gl.createProgram();
		gl.attachShader(prog, vs);
		gl.attachShader(prog, fs);
		gl.linkProgram(prog);
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
			throw new Error("Program link error: " + gl.getProgramInfoLog(prog));
		}
		gizmo.program = prog;
		gizmo.aPos = gl.getAttribLocation(prog, "aPos");
		gizmo.aColor = gl.getAttribLocation(prog, "aColor");
		gizmo.uMVP = gl.getUniformLocation(prog, "uMVP");
	}

	function uploadBuffer(existing, floatArr) {
		var buf = existing || gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(floatArr), gl.DYNAMIC_DRAW);
		return buf;
	}

	function drawBuffer(buf, count, mode, mvp) {
		if (count === 0) return;
		gl.useProgram(gizmo.program);
		gl.uniformMatrix4fv(gizmo.uMVP, false, mvp);
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		var stride = 7 * 4;
		gl.enableVertexAttribArray(gizmo.aPos);
		gl.vertexAttribPointer(gizmo.aPos, 3, gl.FLOAT, false, stride, 0);
		gl.enableVertexAttribArray(gizmo.aColor);
		gl.vertexAttribPointer(gizmo.aColor, 4, gl.FLOAT, false, stride, 12);
		gl.drawArrays(mode, 0, count);
	}

	// -----------------------------------------------------------------------
	// ROM loading (subset of debug.html's flow)
	// -----------------------------------------------------------------------

	function setStatus(txt) {
		document.getElementById("status").textContent = txt;
	}

	function setupRomControls() {
		document.getElementById("loadCachedRom").addEventListener("click", loadCachedRom);
		document.getElementById("openRomFile").addEventListener("click", promptOverwriteRom);
		fileStore.getInstance().checkRom(updateCachedRomButton);
	}

	function updateCachedRomButton(hasRom) {
		var btn = document.getElementById("loadCachedRom");
		btn.disabled = !hasRom;
		btn.title = hasRom ? "Reload ROM from IndexedDB (game cache)" : "No ROM in IndexedDB — use Open ROM file";
	}

	function loadCachedRom() {
		setStatus("Loading cached ROM…");
		fileStore.getInstance().loadRom(onRomLoaded);
	}

	function promptOverwriteRom() {
		var input = document.getElementById("fileIn");
		input.value = "";
		input.onchange = function (e) {
			var file = e.target.files && e.target.files[0];
			if (!file) return;
			setStatus("Loading " + file.name + "…");
			var reader = new FileReader();
			reader.onload = function (ev) {
				onRomLoaded(ev.target.result);
			};
			reader.onerror = function () {
				setStatus("Failed to read ROM file");
			};
			reader.readAsArrayBuffer(file);
		};
		input.click();
	}

	function onRomLoaded(rom) {
		if (!rom) {
			setStatus("No ROM in cache — use Open ROM file to load a .nds into memory");
			return;
		}
		gameROM = new ndsFS(rom);
		document.getElementById("romInfo").textContent = rom.byteLength ? (rom.byteLength / (1024 * 1024)).toFixed(1) + " MiB" : "";
		fileStore.getInstance().checkRom(updateCachedRomButton);
		setStatus("ROM loaded — pick a course");
		populateCourseList();
	}

	// -----------------------------------------------------------------------
	// Course listing / loading
	// -----------------------------------------------------------------------

	function friendlyCourseName(rawName) {
		if (typeof MKDSCONST !== "undefined" && MKDSCONST.COURSES) {
			var found = MKDSCONST.COURSES.filter(function (c) {
				return c.name === rawName;
			})[0];
			if (found) return rawName;
		}
		return rawName;
	}

	function populateCourseList() {
		var files = gameROM.list();
		var names = [];
		files.forEach(function (f) {
			var m = /^\/data\/Course\/([^/]+)\.carc$/.exec(f);
			if (!m) return;
			var base = m[1];
			if (/Tex$/.test(base) || /D$/.test(base)) return;
			names.push(base);
		});
		names.sort();

		var sel = document.getElementById("courseSelect");
		sel.innerHTML = "";
		if (names.length === 0) {
			sel.innerHTML = '<option value="">(no courses found)</option>';
			sel.disabled = true;
			return;
		}
		names.forEach(function (n) {
			var opt = document.createElement("option");
			opt.value = n;
			opt.textContent = friendlyCourseName(n);
			sel.appendChild(opt);
		});
		sel.disabled = false;
		document.getElementById("reloadCourse").disabled = false;
		sel.onchange = function () {
			loadCourse(sel.value);
		};
		loadCourse(names[0]);
	}

	function loadCourse(name) {
		if (!name || !gameROM) return;
		setStatus("Loading course " + name + "…");
		try {
			var cDir = "/data/Course/" + name;
			var mainBuf = gameROM.getFile(cDir + ".carc");
			var mainNarc = new narc(lz77.decompress(mainBuf));
			var texBuf = gameROM.getFile(cDir + "Tex.carc");
			var texNarc = texBuf ? new narc(lz77.decompress(texBuf)) : null;

			var nkmBuf = mainNarc.tryGetFile("/course_map.nkm") || mainNarc.tryGetFile("/map.nkm");
			if (!nkmBuf) throw new Error("No course_map.nkm / map.nkm in this course archive");
			var nkmMap = new nkm(nkmBuf);

			var kclInst = null;
			var kclBuf = mainNarc.tryGetFile("/course_collision.kcl");
			if (kclBuf) {
				try {
					kclInst = new kcl(kclBuf, false);
				} catch (e) {
					console.error("KCL parse failed", e);
				}
			}

			var model = null;
			try {
				var bmdBuf = mainNarc.tryGetFile("/course_model.nsbmd");
				if (bmdBuf) {
					var bmd = new nsbmd(bmdBuf);
					var btxBuf = texNarc ? texNarc.tryGetFile("/course_model.nsbtx") : null;
					var btx = btxBuf ? new nsbtx(btxBuf) : null;
					model = new nitroModel(bmd, btx);
					var taBuf = mainNarc.tryGetFile("/course_model.nsbta");
					if (taBuf) model.loadTexAnim(new nsbta(taBuf));
					var tpBuf = mainNarc.tryGetFile("/course_model.nsbtp");
					if (tpBuf) model.loadTexPAnim(new nsbtp(tpBuf));
				}
			} catch (e) {
				console.error("Course model load failed", e);
				model = null;
			}

			course = {
				name: name,
				mainNarc: mainNarc,
				texNarc: texNarc,
				nkm: nkmMap,
				kcl: kclInst,
				model: model,
			};

			layers.MODEL = model != null;
			layers.KCL = model == null && kclInst != null;
			updateLayerCheckboxes();

			animFrame = 0;
			animRemainder = 0;
			selected = null;

			buildRoutes();
			renderStagInfo();
			buildSections();
			rebuildGizmos();
			resetCameraToFit();

			setStatus(
				name +
					"  —  OBJI=" +
					(nkmMap.sections.OBJI ? nkmMap.sections.OBJI.entries.length : 0) +
					"  model=" +
					(model ? "yes" : "no") +
					"  kcl=" +
					(kclInst ? kclInst.planes.length - 1 + " tris" : "no")
			);
		} catch (err) {
			console.error(err);
			setStatus("Load error: " + (err && err.message ? err.message : err));
		}
	}

	// PATH/POIT are consumed sequentially: paths[i] = POIT.slice(cursor, cursor+PATH[i].numPts)
	// (mirrors courseScene.compilePaths()). OBJI.routeID / CAME.pathId index into this array
	// by position, not by the PATH.routeID field.
	function buildRoutes() {
		course.paths = [];
		var pathSec = course.nkm.sections.PATH;
		var poitSec = course.nkm.sections.POIT;
		if (!pathSec || !poitSec) return;
		var pts = poitSec.entries;
		var cursor = 0;
		for (var i = 0; i < pathSec.entries.length; i++) {
			var n = pathSec.entries[i].numPts;
			course.paths.push(pts.slice(cursor, cursor + n));
			cursor += n;
		}
	}

	// -----------------------------------------------------------------------
	// STAG summary panel
	// -----------------------------------------------------------------------

	function renderStagInfo() {
		var el = document.getElementById("stagInfo");
		var stag = course.nkm.sections.STAG;
		if (!stag) {
			el.textContent = "No STAG section.";
			return;
		}
		var lines = [
			"courseId=" + stag.courseId + "  laps=" + stag.nrLaps + "  pole=" + stag.polePosition,
			"fog: " + (stag.fogEnabled ? "on" : "off") + "  mode=" + stag.fogTableGenMode + "  dist=" + stag.fogDist.toFixed(1),
		];
		el.textContent = lines.join("\n");
	}

	// -----------------------------------------------------------------------
	// Sidebar: sections tree + detail panel
	// -----------------------------------------------------------------------

	function updateLayerCheckboxes() {
		var host = document.getElementById("layers");
		host.innerHTML = "";
		Object.keys(LAYER_LABELS).forEach(function (key) {
			var label = document.createElement("label");
			var cb = document.createElement("input");
			cb.type = "checkbox";
			cb.checked = !!layers[key];
			if (key === "MODEL" && (!course || !course.model)) cb.disabled = true;
			if (key === "KCL" && (!course || !course.kcl)) cb.disabled = true;
			cb.addEventListener("change", function () {
				layers[key] = cb.checked;
				rebuildGizmos();
			});
			label.appendChild(cb);
			label.appendChild(document.createTextNode(LAYER_LABELS[key]));
			host.appendChild(label);
		});
	}

	function entryLabel(type, index, entry) {
		switch (type) {
			case "OBJI": {
				var cls = typeof ObjDatabase !== "undefined" && ObjDatabase.has(entry.ID) ? ObjDatabase.get(entry.ID) : null;
				var nm = cls && cls.name ? cls.name : "id 0x" + entry.ID.toString(16);
				return "#" + index + "  " + nm;
			}
			case "CAME":
				return "#" + index + "  type=" + entry.camType + " route=" + entry.pathId;
			case "AREA":
				return "#" + index + "  type=" + entry.type + " shape=" + entry.shape + " cam=" + entry.cameraId;
			case "KTPJ":
				return "#" + index + "  id=" + entry.id;
			default:
				return "#" + index;
		}
	}

	function buildSections() {
		var host = document.getElementById("sections");
		host.innerHTML = "";
		var order = ["OBJI", "PATH", "KTPS", "KTPJ", "KTP2", "KTPC", "KTPM", "CPOI", "IPOI", "EPOI", "MEPO", "AREA", "CAME"];
		order.forEach(function (type) {
			var section = course.nkm.sections[type];
			var count = section ? section.entries.length : 0;
			var headEl = document.createElement("div");
			headEl.className = "secHead";
			headEl.textContent = (LAYER_LABELS[type] || type) + " (" + count + ")";
			host.appendChild(headEl);
			if (!section || count === 0) return;
			var body = document.createElement("div");
			var collapsed = false;
			headEl.addEventListener("click", function () {
				collapsed = !collapsed;
				body.style.display = collapsed ? "none" : "";
			});
			section.entries.forEach(function (entry, i) {
				var row = document.createElement("div");
				row.className = "secEntry";
				row.textContent = entryLabel(type, i, entry);
				row.dataset.type = type;
				row.dataset.index = i;
				row.addEventListener("click", function () {
					selectEntry(type, i);
				});
				body.appendChild(row);
			});
			host.appendChild(body);
		});
	}

	function fmtVal(key, value) {
		if (value == null || key === "nextOff" || key === "type") return null;
		if (Array.isArray(value)) {
			if (
				value.length === 3 &&
				value.every(function (x) {
					return typeof x === "number";
				})
			) {
				return (
					key +
					": [" +
					value
						.map(function (x) {
							return x.toFixed(2);
						})
						.join(", ") +
					"]"
				);
			}
			return key + ": [" + value.join(", ") + "]";
		}
		if (typeof value === "number") {
			var hex = Number.isInteger(value) && value >= 0 && value <= 0xffff ? " (0x" + value.toString(16) + ")" : "";
			return key + ": " + (Number.isInteger(value) ? value : value.toFixed(3)) + hex;
		}
		return key + ": " + String(value);
	}

	function showDetail(type, index, entry) {
		var lines = ["[" + type + "] #" + index, ""];
		Object.keys(entry).forEach(function (k) {
			var s = fmtVal(k, entry[k]);
			if (s) lines.push(s);
		});
		if (type === "OBJI") {
			var cls = typeof ObjDatabase !== "undefined" && ObjDatabase.has(entry.ID) ? ObjDatabase.get(entry.ID) : null;
			lines.splice(2, 0, "resolved class: " + (cls && cls.name ? cls.name : "(not in ObjDatabase)"), "");
		}
		document.getElementById("detail").textContent = lines.join("\n");
	}

	function entryPos(type, entry) {
		switch (type) {
			case "OBJI":
			case "IPOI":
			case "EPOI":
			case "MEPO":
			case "AREA":
			case "CAME":
				return entry.pos || entry.position;
			case "KTPS":
			case "KTPJ":
			case "KTP2":
			case "KTPC":
			case "KTPM":
				return entry.pos;
			case "CPOI":
				return [(entry.x1 + entry.x2) / 2, defaultGroundY(), (entry.z1 + entry.z2) / 2];
			default:
				return [0, 0, 0];
		}
	}

	function selectEntry(type, index) {
		var section = course.nkm.sections[type];
		if (!section) return;
		var entry = section.entries[index];
		selected = { type: type, index: index };
		showDetail(type, index, entry);
		document.querySelectorAll("#sections .secEntry.sel").forEach(function (n) {
			n.classList.remove("sel");
		});
		var row = document.querySelector('#sections .secEntry[data-type="' + type + '"][data-index="' + index + '"]');
		if (row) {
			row.classList.add("sel");
			row.scrollIntoView({ block: "nearest" });
		}
		focusOn(entryPos(type, entry));
		rebuildGizmos();
	}

	// -----------------------------------------------------------------------
	// Ground-height fallback for 2D-only sections (CPOI has no Y)
	// -----------------------------------------------------------------------

	function defaultGroundY() {
		var ktps = course.nkm.sections.KTPS;
		if (ktps && ktps.entries.length) {
			var sum = 0;
			ktps.entries.forEach(function (e) {
				sum += e.pos[1];
			});
			return sum / ktps.entries.length;
		}
		var obji = course.nkm.sections.OBJI;
		if (obji && obji.entries.length) {
			var s2 = 0;
			obji.entries.forEach(function (e) {
				s2 += e.pos[1];
			});
			return s2 / obji.entries.length;
		}
		return 0;
	}

	// -----------------------------------------------------------------------
	// Gizmo construction
	// -----------------------------------------------------------------------

	function linkedChain(linkSection, points, posOf, colorFn, lineArr) {
		if (!linkSection || !points) return;
		linkSection.entries.forEach(function (seg, segIdx) {
			var col = colorFn(segIdx);
			for (var i = 0; i < seg.length - 1; i++) {
				var a = points[seg.start + i],
					b = points[seg.start + i + 1];
				if (a && b) pushLine(lineArr, posOf(a), posOf(b), col);
			}
			(seg.dest || []).forEach(function (destIdx) {
				var destSeg = linkSection.entries[destIdx];
				if (!destSeg) return;
				var a = points[seg.start + seg.length - 1];
				var b = points[destSeg.start];
				if (a && b) pushLine(lineArr, posOf(a), posOf(b), col);
			});
		});
	}

	function rebuildGizmos() {
		if (!course) return;
		var lines = [];
		var tris = [];
		pickList = [];
		var sections = course.nkm.sections;

		// --- Collision mesh (solid triangles), colour-coded by collision type ---
		if (layers.KCL && course.kcl) {
			var planes = course.kcl.planes;
			for (var pi = 1; pi < planes.length; pi++) {
				var pl = planes[pi];
				if (!pl) continue;
				var shade = 0.55 + 0.45 * Math.max(0, pl.Normal[1]);
				var c = collisionColor(pl.CollisionType);
				var col = [c[0] * shade, c[1] * shade, c[2] * shade, 1];
				pushTri(tris, pl.Vertices[0], pl.Vertices[1], pl.Vertices[2], col);
			}
		}

		// --- OBJI: map objects ---
		if (layers.OBJI && sections.OBJI) {
			sections.OBJI.entries.forEach(function (o, i) {
				var col = objectColor(o.ID);
				var m = objiMatrix(o.pos, o.angle, o.scale, 22);
				pushBoxWireMat(lines, m, col);
				var fwd = vec3.create();
				vec3.transformMat4(fwd, [0, 0, 1], objiForwardMat(o.angle));
				pushLine(lines, o.pos, [o.pos[0] + fwd[0] * 40, o.pos[1] + fwd[1] * 40, o.pos[2] + fwd[2] * 40], [1, 1, 1, 1]);
				pickList.push({ type: "OBJI", index: i, pos: o.pos, radius: 30 });
				if (selected && selected.type === "OBJI" && selected.index === i && o.routeID !== 0xffff && course.paths[o.routeID]) {
					drawRoute(lines, course.paths[o.routeID], false, [1, 1, 0, 1]);
				}
			});
		}

		// --- PATH/POIT: generic routes (moving objects, cameras) ---
		if (layers.PATH && course.paths) {
			course.paths.forEach(function (pts, i) {
				var pathEntry = sections.PATH.entries[i];
				drawRoute(lines, pts, !!pathEntry.loop, routeColor(i));
			});
		}

		// --- Kart points ---
		if (layers.KTPS && sections.KTPS) {
			sections.KTPS.entries.forEach(function (k, i) {
				pushYawArrow(lines, k.pos, k.angle[1], 90, [0.3, 1, 0.3, 1]);
				pushCross(lines, k.pos, 12, [0.3, 1, 0.3, 1]);
				pickList.push({ type: "KTPS", index: i, pos: k.pos, radius: 30 });
			});
		}
		if (layers.KTPJ && sections.KTPJ) {
			sections.KTPJ.entries.forEach(function (k, i) {
				pushYawArrow(lines, k.pos, k.angle[1], 90, [1, 0.85, 0.2, 1]);
				pushCross(lines, k.pos, 12, [1, 0.85, 0.2, 1]);
				pickList.push({ type: "KTPJ", index: i, pos: k.pos, radius: 30 });
				if (layers.EPOI && sections.EPOI && sections.EPOI.entries[k.enemyPointId]) {
					pushLine(lines, k.pos, sections.EPOI.entries[k.enemyPointId].pos, [1, 0.85, 0.2, 0.5]);
				}
				if (layers.IPOI && sections.IPOI && sections.IPOI.entries[k.itemPointId]) {
					pushLine(lines, k.pos, sections.IPOI.entries[k.itemPointId].pos, [1, 0.85, 0.2, 0.5]);
				}
			});
		}
		if (layers.KTP2 && sections.KTP2) {
			sections.KTP2.entries.forEach(function (k, i) {
				pushYawArrow(lines, k.pos, k.angle[1], 70, [0.3, 0.8, 1, 1]);
				pickList.push({ type: "KTP2", index: i, pos: k.pos, radius: 25 });
			});
		}
		if (layers.KTPC && sections.KTPC) {
			sections.KTPC.entries.forEach(function (k, i) {
				pushYawArrow(lines, k.pos, k.angle[1], 70, [1, 0.4, 1, 1]);
				pickList.push({ type: "KTPC", index: i, pos: k.pos, radius: 25 });
				if (layers.MEPO && sections.MEPO && k.nextMepo >= 0 && sections.MEPO.entries[k.nextMepo]) {
					pushLine(lines, k.pos, sections.MEPO.entries[k.nextMepo].pos, [1, 0.4, 1, 0.5]);
				}
			});
		}
		if (layers.KTPM && sections.KTPM) {
			sections.KTPM.entries.forEach(function (k, i) {
				pushYawArrow(lines, k.pos, k.angle[1], 70, [0.4, 0.4, 1, 1]);
				pickList.push({ type: "KTPM", index: i, pos: k.pos, radius: 25 });
			});
		}

		// --- Checkpoints ---
		if (layers.CPOI && sections.CPOI) {
			var gY = defaultGroundY();
			sections.CPOI.entries.forEach(function (c2, i) {
				var a = [c2.x1, gY, c2.z1];
				var b = [c2.x2, gY, c2.z2];
				pushLine(lines, a, b, [1, 0.3, 0.3, 1]);
				pickList.push({ type: "CPOI", index: i, pos: [(c2.x1 + c2.x2) / 2, gY, (c2.z1 + c2.z2) / 2], radius: 30 });
			});
			if (sections.CPAT) {
				linkedChain(
					sections.CPAT,
					sections.CPOI.entries,
					function (e) {
						return [(e.x1 + e.x2) / 2, gY, (e.z1 + e.z2) / 2];
					},
					function () {
						return [1, 0.55, 0.55, 0.7];
					},
					lines
				);
			}
		}

		// --- Item / enemy / mission points (spheres + links) ---
		if (layers.IPOI && sections.IPOI) {
			sections.IPOI.entries.forEach(function (p, i) {
				pushSphereGizmo(lines, p.pos, Math.max(8, p.radius), [0.3, 0.9, 0.9, 1]);
				pickList.push({ type: "IPOI", index: i, pos: p.pos, radius: Math.max(20, p.radius) });
			});
			if (sections.IPAT) {
				linkedChain(
					sections.IPAT,
					sections.IPOI.entries,
					function (e) {
						return e.pos;
					},
					function () {
						return [0.3, 0.9, 0.9, 0.8];
					},
					lines
				);
			}
		}
		if (layers.EPOI && sections.EPOI) {
			sections.EPOI.entries.forEach(function (p, i) {
				pushSphereGizmo(lines, p.pos, Math.max(8, p.radius), [0.75, 0.4, 1, 1]);
				pickList.push({ type: "EPOI", index: i, pos: p.pos, radius: Math.max(20, p.radius) });
			});
			if (sections.EPAT) {
				linkedChain(
					sections.EPAT,
					sections.EPOI.entries,
					function (e) {
						return e.pos;
					},
					function () {
						return [0.75, 0.4, 1, 0.8];
					},
					lines
				);
			}
		}
		if (layers.MEPO && sections.MEPO) {
			sections.MEPO.entries.forEach(function (p, i) {
				pushSphereGizmo(lines, p.pos, Math.max(8, p.radius), [0.85, 0.85, 0.85, 1]);
				pickList.push({ type: "MEPO", index: i, pos: p.pos, radius: Math.max(20, p.radius) });
			});
			if (sections.MEPA) {
				linkedChain(
					sections.MEPA,
					sections.MEPO.entries,
					function (e) {
						return e.pos;
					},
					function () {
						return [0.85, 0.85, 0.85, 0.8];
					},
					lines
				);
			}
		}

		// --- Areas ---
		if (layers.AREA && sections.AREA) {
			sections.AREA.entries.forEach(function (a, i) {
				var col = hsl((a.type * 47) % 360, 75, 55, 1);
				var ax = [a.xVector[0] * a.dimensions[0], a.xVector[1] * a.dimensions[0], a.xVector[2] * a.dimensions[0]];
				var ay = [a.yVector[0] * a.dimensions[1], a.yVector[1] * a.dimensions[1], a.yVector[2] * a.dimensions[1]];
				var az = [a.zVector[0] * a.dimensions[2], a.zVector[1] * a.dimensions[2], a.zVector[2] * a.dimensions[2]];
				pushBoxWireAxes(lines, a.position, ax, ay, az, col);
				pickList.push({
					type: "AREA",
					index: i,
					pos: a.position,
					radius: Math.max(a.dimensions[0], a.dimensions[1], a.dimensions[2]),
				});
				if (layers.CAME && sections.CAME && sections.CAME.entries[a.cameraId]) {
					pushLine(lines, a.position, sections.CAME.entries[a.cameraId].position, [col[0], col[1], col[2], 0.4]);
				}
			});
		}

		// --- Cameras ---
		if (layers.CAME && sections.CAME) {
			sections.CAME.entries.forEach(function (cam2, i) {
				pushCross(lines, cam2.position, 20, [0.3, 0.6, 1, 1]);
				pushLine(lines, cam2.position, cam2.target1, [0.3, 0.6, 1, 0.8]);
				pushLine(lines, cam2.position, cam2.target2, [0.5, 0.8, 1, 0.5]);
				pickList.push({ type: "CAME", index: i, pos: cam2.position, radius: 40 });
			});
		}

		buffers.lines = uploadBuffer(buffers.lines, lines);
		buffers.lineCount = lines.length / 7;
		buffers.tris = uploadBuffer(buffers.tris, tris);
		buffers.triCount = tris.length / 7;

		rebuildSelectionGizmo();
	}

	function drawRoute(lineArr, pts, loop, col) {
		for (var i = 0; i < pts.length - 1; i++) {
			pushLine(lineArr, pts[i].pos, pts[i + 1].pos, col);
		}
		if (loop && pts.length > 1) pushLine(lineArr, pts[pts.length - 1].pos, pts[0].pos, col);
		pts.forEach(function (p) {
			pushCross(lineArr, p.pos, 8, col);
		});
	}

	function rebuildSelectionGizmo() {
		var lines = [];
		if (selected) {
			var section = course.nkm.sections[selected.type];
			var entry = section && section.entries[selected.index];
			if (entry) {
				var pos = entryPos(selected.type, entry);
				pushSphereGizmo(lines, pos, 45, [1, 1, 1, 1]);
				pushCross(lines, pos, 70, [1, 1, 1, 1]);
			}
		}
		buffers.sel = uploadBuffer(buffers.sel, lines);
		buffers.selCount = lines.length / 7;
	}

	// -----------------------------------------------------------------------
	// Free-fly camera
	// -----------------------------------------------------------------------

	function camForward() {
		return [Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch)];
	}

	function camRight() {
		return [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
	}

	function focusOn(pos) {
		if (!pos) return;
		var f = camForward();
		var dist = 250;
		cam.pos = [pos[0] - f[0] * dist, pos[1] - f[1] * dist + 60, pos[2] - f[2] * dist];
	}

	function computeBoundsCenter() {
		var min = [Infinity, Infinity, Infinity];
		var max = [-Infinity, -Infinity, -Infinity];
		var any = false;
		function extend(p) {
			any = true;
			for (var d = 0; d < 3; d++) {
				if (p[d] < min[d]) min[d] = p[d];
				if (p[d] > max[d]) max[d] = p[d];
			}
		}
		var sections = course.nkm.sections;
		["OBJI", "KTPS", "KTPJ"].forEach(function (t) {
			if (sections[t])
				sections[t].entries.forEach(function (e) {
					extend(e.pos || e.position);
				});
		});
		if (!any && course.kcl) {
			for (var i = 1; i < course.kcl.planes.length; i++) {
				var pl = course.kcl.planes[i];
				if (pl) extend(pl.Vertices[0]);
			}
		}
		if (!any) return { center: [0, 500, 0], radius: 1000 };
		var center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
		var radius = Math.max(max[0] - min[0], max[2] - min[2]) / 2 || 1000;
		return { center: center, radius: radius };
	}

	function resetCameraToFit() {
		var b = computeBoundsCenter();
		cam.yaw = 0;
		cam.pitch = -0.9;
		cam.speed = Math.max(150, b.radius * 0.15);
		// yaw=0/pitch=-0.9 forward points toward +Z and downward, so the camera must sit
		// on the -Z / +Y side of the center to actually look back at it.
		cam.pos = [b.center[0], b.center[1] + b.radius * 0.9, b.center[2] - b.radius * 0.9];
	}

	function setupCameraControls() {
		var canvas = document.getElementById("canvas3d");
		canvas.tabIndex = 0;
		canvas.addEventListener("mousedown", function (e) {
			if (e.button !== 0) return;
			drag.active = true;
			drag.lastX = e.clientX;
			drag.lastY = e.clientY;
			canvas.focus();
		});
		window.addEventListener("mouseup", function () {
			drag.active = false;
		});
		window.addEventListener("mousemove", function (e) {
			if (!drag.active) return;
			var dx = e.clientX - drag.lastX;
			var dy = e.clientY - drag.lastY;
			drag.lastX = e.clientX;
			drag.lastY = e.clientY;
			cam.yaw -= dx * 0.005;
			cam.pitch -= dy * 0.005;
			var lim = Math.PI / 2 - 0.01;
			if (cam.pitch > lim) cam.pitch = lim;
			if (cam.pitch < -lim) cam.pitch = -lim;
		});
		canvas.addEventListener(
			"wheel",
			function (e) {
				e.preventDefault();
				var factor = e.deltaY > 0 ? 0.85 : 1.15;
				cam.speed = Math.max(10, Math.min(20000, cam.speed * factor));
			},
			{ passive: false }
		);
		window.addEventListener("keydown", function (e) {
			keys[e.code] = true;
		});
		window.addEventListener("keyup", function (e) {
			keys[e.code] = false;
		});
	}

	function updateCamera(dt) {
		var f = camForward();
		var r = camRight();
		var boost = keys["ShiftLeft"] || keys["ShiftRight"] ? 3 : 1;
		var speed = cam.speed * boost * dt;
		var move = [0, 0, 0];
		if (keys["KeyW"] || keys["ArrowUp"]) {
			move[0] += f[0];
			move[1] += f[1];
			move[2] += f[2];
		}
		if (keys["KeyS"] || keys["ArrowDown"]) {
			move[0] -= f[0];
			move[1] -= f[1];
			move[2] -= f[2];
		}
		if (keys["KeyD"] || keys["ArrowRight"]) {
			move[0] += r[0];
			move[2] += r[2];
		}
		if (keys["KeyA"] || keys["ArrowLeft"]) {
			move[0] -= r[0];
			move[2] -= r[2];
		}
		if (keys["KeyE"] || keys["Space"]) move[1] += 1;
		if (keys["KeyQ"] || keys["ControlLeft"]) move[1] -= 1;
		var len = Math.hypot(move[0], move[1], move[2]);
		if (len > 0.0001) {
			cam.pos[0] += (move[0] / len) * speed;
			cam.pos[1] += (move[1] / len) * speed;
			cam.pos[2] += (move[2] / len) * speed;
		}
	}

	// -----------------------------------------------------------------------
	// Render loop
	// -----------------------------------------------------------------------

	function updateHud() {
		var hud = document.getElementById("hud");
		if (!course) {
			hud.textContent = "";
			return;
		}
		hud.textContent =
			"course: " +
			course.name +
			"\ncam: " +
			cam.pos
				.map(function (v) {
					return v.toFixed(0);
				})
				.join(", ") +
			"   speed: " +
			cam.speed.toFixed(0) +
			"/s";
	}

	var lastTime = 0;
	function renderLoop(now) {
		requestAnimationFrame(renderLoop);
		now = now || performance.now();
		var dt = lastTime ? Math.min(0.1, (now - lastTime) / 1000) : 0;
		lastTime = now;

		resizeCanvas();
		gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

		if (!course) return;

		updateCamera(dt);
		updateHud();

		var aspect = gl.viewportWidth / gl.viewportHeight;
		var proj = mat4.create();
		mat4.perspective(proj, (60 * Math.PI) / 180, aspect, 1, 60000);

		var f = camForward();
		var target = [cam.pos[0] + f[0], cam.pos[1] + f[1], cam.pos[2] + f[2]];
		var view = mat4.create();
		mat4.lookAt(view, cam.pos, target, [0, 1, 0]);

		var mvp = mat4.create();
		mat4.multiply(mvp, proj, view);

		// --- Real 3D course model (nitroModel/nitroRender pipeline) ---
		// course_model.nsbmd only reaches NKM world scale once its embedded
		// `model.head.scale` (baked into the bone matrix stack, typically 64) is combined
		// with a further x16 external correction (empirically verified against the KCL
		// collision mesh / NKM object placements; net effective scale x1024, the same
		// constant used for kart models in courseScene.draw()). nitroModel.draw(mv,
		// project, ...) multiplies as `project * (mv * vertex)`, so we pass this fixed
		// model scale as `mv` and the combined camera view+proj as `project`.
		if (layers.MODEL && course.model) {
			var fps = 30;
			animRemainder += dt * 1000;
			var frameDur = 1000 / fps;
			while (animRemainder >= frameDur) {
				animFrame++;
				animRemainder -= frameDur;
			}
			try {
				var modelMat = mat4.create();
				mat4.scale(modelMat, modelMat, [16, 16, 16]);
				course.model.setFrame(animFrame);
				nitroRender.unsetShadowMode();
				nitroRender.flagShadow = false;
				nitroRender.updateBillboards(view);
				course.model.draw(modelMat, mvp);
			} catch (e) {
				console.error("Model draw failed, disabling", e);
				layers.MODEL = false;
			}
		}

		// --- Gizmo pass (own shader) ---
		gl.useProgram(gizmo.program);
		gl.disable(gl.CULL_FACE);
		gl.enable(gl.DEPTH_TEST);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		drawBuffer(buffers.tris, buffers.triCount, gl.TRIANGLES, mvp);

		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		drawBuffer(buffers.lines, buffers.lineCount, gl.LINES, mvp);

		gl.disable(gl.DEPTH_TEST);
		drawBuffer(buffers.sel, buffers.selCount, gl.LINES, mvp);
		gl.enable(gl.DEPTH_TEST);
	}

	// -----------------------------------------------------------------------
	// Boot
	// -----------------------------------------------------------------------

	function init() {
		gl = initGL(document.getElementById("canvas3d"));
		nitroRender.init(gl);
		initGizmoShader();
		setupRomControls();
		setupCameraControls();
		updateLayerCheckboxes();
		document.getElementById("reloadCourse").addEventListener("click", function () {
			var sel = document.getElementById("courseSelect");
			if (sel.value) loadCourse(sel.value);
		});
		renderLoop();
		loadCachedRom();
	}

	window.addEventListener("load", init);
	window.onerror = function (msg, url, line, col, e) {
		if (e && e.stack) console.error(e.stack);
	};
})();
