// npm run refresh: bring the app up to date with the job-aid folder in one step.
//   1. re-read every job aid (ingest/ingest_real.py; the originals are opened read-only)
//   2. slide images: delete images of removed or changed job aids, then render the missing ones with PowerPoint
//   3. build + tests
//   4. report what changed (added / removed / changed job aids) and what to follow up
// Flags: --no-slides (skip rendering, e.g. on a machine without PowerPoint), --no-test
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(ROOT, "ka.config.json"), "utf8")) as { jobAidsDir: string; transcriptionsDir: string };
const jobAids = resolve(ROOT, cfg.jobAidsDir);
const trans = resolve(ROOT, cfg.transcriptionsDir);
const REAL = join(ROOT, "content", "real");
const SLIDES = join(REAL, "slides");
const MANIFEST = join(SLIDES, "manifest.json");
const args = new Set(process.argv.slice(2));
const run = (cmd: string, a: string[]) => execFileSync(cmd, a, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" && cmd === "npm" });

if (!existsSync(jobAids)) { console.error(`Job-aid folder not found: ${jobAids}\nSet "jobAidsDir" in ka.config.json.`); process.exit(1); }
type Src = { id: string; title: string; file: string; fileSha256: string; format: string };
const read = (): Src[] => existsSync(join(REAL, "corpus.base.json")) ? (JSON.parse(readFileSync(join(REAL, "corpus.base.json"), "utf8")).sources as Src[]) : [];

const before = read();
console.log(`\n== 1/4 Reading job aids from ${jobAids}`);
run(process.platform === "win32" ? "python" : "python3", ["-I", "-X", "utf8", "ingest/ingest_real.py", jobAids, REAL, trans]);
const after = read();

const bId = new Map(before.map((s) => [s.id, s])); const aId = new Map(after.map((s) => [s.id, s]));
const added = after.filter((s) => !bId.has(s.id)); const removed = before.filter((s) => !aId.has(s.id));
const changed = after.filter((s) => bId.has(s.id) && bId.get(s.id)!.fileSha256 !== s.fileSha256);

console.log(`\n== 2/4 Slide images`);
const manifest: Record<string, string> = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
let deleted = 0;
if (existsSync(SLIDES)) for (const f of readdirSync(SLIDES)) {
  if (!f.endsWith(".jpg")) continue;
  const id = f.replace(/-\d+\.jpg$/, "");
  const src = aId.get(id);
  // a removed job aid, or one whose file changed since its images were rendered -> stale image
  if (!src || (manifest[id] && manifest[id] !== src.fileSha256) || changed.some((c) => c.id === id)) { rmSync(join(SLIDES, f)); deleted++; }
}
console.log(`removed ${deleted} stale slide image(s)`);
const renderCmd = `powershell -NoProfile -File ingest/render_slides.ps1 -SrcDir "${jobAids}" -Corpus content/real/corpus.base.json -OutDir content/real/slides`;
if (!args.has("--no-slides")) {
  try {
    run("powershell", ["-NoProfile", "-File", "ingest/render_slides.ps1", "-SrcDir", jobAids, "-Corpus", join(REAL, "corpus.base.json"), "-OutDir", SLIDES]);
    writeFileSync(MANIFEST, JSON.stringify(Object.fromEntries(after.filter((s) => s.format === "pptx").map((s) => [s.id, s.fileSha256])), null, 1));
  } catch {
    console.error(`Slide rendering did not run (PowerPoint missing, or this computer does not allow running PowerShell scripts).\n` +
      `Ask IT, or render later with:\n  ${renderCmd}\nThe app still builds; slides without an image show a note instead.`);
  }
} else console.log(`skipped (--no-slides). To render later:\n  ${renderCmd}`);

console.log(`\n== 3/4 Build${args.has("--no-test") ? "" : " and tests"}`);
let ok = true;
try { run("npm", ["run", "build", "--silent"]); } catch { ok = false; }
if (ok && !args.has("--no-test")) { try { run("npm", ["test", "--silent"]); } catch { ok = false; } }

console.log(`\n== 4/4 What changed`);
const list = (xs: Src[]) => xs.length ? xs.map((s) => `   - ${s.title}`).join("\n") : "   (none)";
console.log(`Added (${added.length}):\n${list(added)}\nRemoved (${removed.length}):\n${list(removed)}\nChanged (${changed.length}):\n${list(changed)}`);
if (added.length) console.log(`\nNew job aids: ask one agent-style question about each (npm run probe -- "question"). If it isn't found, add phrasings in content/real/aliases.json and a line in tests/fixtures/coverage.txt.`);
if (removed.length) console.log(`Removed job aids: if the build failed, delete the entries that still name them (the error lists the file and entry).`);
if (changed.length) console.log(`Changed job aids: if a conflict or override no longer matches the new wording, the build names it; update or remove it in content/real/overlay.json.`);
console.log(ok ? "\nResult: OK. Open dist/index.html to check." : "\nResult: NOT OK. Fix the errors above, then run npm run check.");
process.exit(ok ? 0 : 1);
