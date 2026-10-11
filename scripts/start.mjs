#!/usr/bin/env node
// Watches/builds bundle.js and runs the dev server together: `npm start`.
import { spawn } from "node:child_process";

const opts = { stdio: "inherit", shell: true };
const procs = [spawn("npx webpack --mode development --watch", opts), spawn("node devserver.js", opts)];
const stop = () => procs.forEach((p) => p.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", stop));
