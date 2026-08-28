/*
  Stage the original static absenteeism dashboard into public/ so Vercel serves
  it alongside the Next.js sick-leave app.

  Why this exists: once the repo is built as a Next.js project, Next owns routing
  and the root index.html is ignored. Copying it (and only the assets it actually
  loads) under public/absenteeism/ makes it reachable at /absenteeism, so one
  deployment serves both dashboards.

  The relative paths inside index.html (config/*.js and model/data/outputs/*.js)
  are preserved by mirroring the same directory structure, so the HTML needs no
  edits and there is one source of truth in the repo.

  Runs automatically before the build (npm "prebuild" lifecycle). The output
  directory is generated and git-ignored.
*/

import { copyFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEST = join(ROOT, "public", "absenteeism");

// Source path (relative to the repo root) -> destination path (relative to DEST).
// Destinations mirror the source layout so index.html's relative refs resolve.
const FILES = [
  ["index.html", "index.html"],
  ["config/industry.js", "config/industry.js"],
  ["config/agents.js", "config/agents.js"],
  // Only the .js feed variants are loaded by the page (they set window.WELO_FEED).
  // The .json copies and predictions.csv are for the pipeline, not the browser.
  ["model/data/outputs/dashboard_feed.js", "model/data/outputs/dashboard_feed.js"],
  ["model/data/outputs/dashboard_feed.manufacturing.js", "model/data/outputs/dashboard_feed.manufacturing.js"],
  ["model/data/outputs/dashboard_feed.logistics.js", "model/data/outputs/dashboard_feed.logistics.js"],
];

rmSync(DEST, { recursive: true, force: true });

let copied = 0;
const missing = [];
for (const [from, to] of FILES) {
  const src = join(ROOT, from);
  if (!existsSync(src)) {
    missing.push(from);
    continue;
  }
  const dst = join(DEST, to);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  copied++;
}

if (missing.length) {
  // Do not fail the build: the sick-leave app is independent of these files.
  // A missing feed only degrades the absenteeism page, which handles it.
  console.warn(`stage-static-dashboard: missing ${missing.length} file(s): ${missing.join(", ")}`);
}
console.log(`stage-static-dashboard: staged ${copied} file(s) into public/absenteeism.`);
