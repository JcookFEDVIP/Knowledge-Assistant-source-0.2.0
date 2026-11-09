// npm run package: make the two hand-off zips in release/ (after type check, tests and build pass).
//   Knowledge-Assistant-app-<version>.zip     the finished app: unzip, double-click index.html (nothing to install)
//   Knowledge-Assistant-source-<version>.zip  everything needed to maintain it: code, content, tests, docs, slide images
// node_modules, dist and release are never included (npm install / npm run build recreate them).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;
const run = (cmd: string, a: string[]) => execFileSync(cmd, a, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" && cmd === "npm" });

console.log(`== Checks before packaging v${version}`);
run("npm", ["run", "typecheck", "--silent"]);
run("npm", ["test", "--silent"]);
run("npm", ["run", "build", "--silent"]);

const OUT = join(ROOT, "release");
mkdirSync(OUT, { recursive: true });
const app = join(OUT, `Knowledge-Assistant-app-${version}.zip`);
const src = join(OUT, `Knowledge-Assistant-source-${version}.zip`);
for (const f of [app, src]) if (existsSync(f)) rmSync(f);

// Python caches are machine-specific: never ship them
for (const d of ["ingest/__pycache__"]) if (existsSync(join(ROOT, d))) rmSync(join(ROOT, d), { recursive: true, force: true });
const SOURCE_ITEMS = ["START_HERE.md", "README.md", "CLAUDE.md", "ROADMAP.md", "MAINTAINING.md", "CHANGELOG.md", "eval", "package.json", "package-lock.json", "tsconfig.json", "ka.config.json",
  "src", "scripts", "tests", "ingest", "content"].filter((p) => existsSync(join(ROOT, p)));
const ps = (cmd: string) => run("powershell", ["-NoProfile", "-Command", cmd]);
const q = (p: string) => `'${p.replace(/'/g, "''")}'`;
console.log(`\n== Writing ${app}`);
ps(`Compress-Archive -Path ${q(join(ROOT, "dist", "*"))} -DestinationPath ${q(app)} -CompressionLevel Optimal`);
console.log(`== Writing ${src}`);
ps(`Compress-Archive -Path ${SOURCE_ITEMS.map((p) => q(join(ROOT, p))).join(",")} -DestinationPath ${q(src)} -CompressionLevel Optimal`);
console.log(`\nDone:\n  ${app}\n  ${src}\nThe app zip is the preview for reviewers; the source zip is for the maintainer (see MAINTAINING.md).`);
