var fs = require("fs");
var path = require("path");
var liveServer = require("live-server");

// Serves the first .nds file found in rom/ (or the repo root) at /rom.nds, so the game can
// load it without the file picker. Both locations are gitignored.
function findLocalRom() {
	for (const dir of [path.join(__dirname, "rom"), __dirname]) {
		if (!fs.existsSync(dir)) continue;
		const file = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith(".nds"));
		if (file) return path.join(dir, file);
	}
	return null;
}

function serveLocalRom(req, res, next) {
	if (req.url.split("?")[0] !== "/rom.nds") return next();
	const rom = findLocalRom();
	if (!rom) {
		res.statusCode = 404;
		return res.end("No .nds file in rom/");
	}
	res.setHeader("Content-Type", "application/octet-stream");
	res.setHeader("Content-Length", fs.statSync(rom).size);
	fs.createReadStream(rom).pipe(res);
}

var params = {
	port: Number(process.env.PORT) || 8181,
	host: "0.0.0.0",
	root: __dirname,
	open: false,
	ignore: "rom,test,node_modules,src",
	wait: 500,
	mount: [["/components", "./node_modules"]],
	logLevel: 1,
	middleware: [serveLocalRom],
};
liveServer.start(params);
