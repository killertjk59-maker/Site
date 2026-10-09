#!/usr/bin/env node
"use strict";
/** node --check барои ҳамаи файлҳои JS-и loyiha (server, src, scripts, tests, public). */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DIRS = ["src", "scripts", "tests", "public"];
const files = [path.join(ROOT, "server.js")];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".js")) files.push(full);
  }
}
for (const d of DIRS) {
  const full = path.join(ROOT, d);
  if (fs.existsSync(full)) walk(full);
}

let bad = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (err) {
    bad += 1;
    console.error(`✗ ${path.relative(ROOT, f)}\n${String(err.stderr || err.message)}`);
  }
}
console.log(`node --check: ${files.length - bad}/${files.length} файл дуруст аст`);
process.exit(bad ? 1 : 0);
