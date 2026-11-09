// npm run score -- <file> [<file> ...]   Measure search quality on a question set.
// File format (one per line; lines starting with # are ignored):  role|season|question|Expected Job Aid Title
//   role: L1 | SR | SME      season: STEADY_STATE | OPEN_SEASON    title: exact job-aid title (several allowed, separated by ~)
// Prints top-1 / top-3 (expected job aid first, or within the first 3 shown passages) and lists every miss with what
// was shown instead. Use it on:
//   tests/fixtures/coverage.txt     one question per job aid (also guarded by a test floor)
//   tests/fixtures/golden.txt       questions that must keep working
//   eval/*.txt                      worklists and fresh "holdout" sets (see ROADMAP.md: how to run an honest holdout)
// Add --misses-only to print only the misses, --quiet to print only the summary.
import { readFileSync } from "node:fs";
import { loadContent } from "./build.ts";
import { buildKnowledge } from "../src/build/knowledge.ts";
import { createEngine, roleThatSees, search } from "../src/engine/search.ts";

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
if (!files.length) { console.error("usage: npm run score -- <question file> [...]"); process.exit(1); }
const { corpus, vocab, hasImages } = loadContent();
const engine = createEngine(buildKnowledge(corpus, vocab, { imageExt: hasImages ? ".jpg" : ".svg" }));
const titles = new Set(engine.kb.sources.map((s) => s.title));

for (const file of files) {
  const rows = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("|"));
  let t1 = 0, t3 = 0, hidden = 0, asked = 0; const misses: string[] = []; const unknown = new Set<string>();
  for (const [audience, season, q, want] of rows) {
    const wants = (want ?? "").split("~").map((w) => w.split("#")[0]!.trim());
    for (const w of wants) if (!titles.has(w)) unknown.add(w);
    // asked as its own role, or as a role whose folders hold the expected job aid
    const role = roleThatSees(engine.kb, audience || "L1", wants);
    if (!role) { hidden++; continue; }
    if (role !== (audience || "L1")) asked++;
    const r = search(engine, q!, { audience: role, season: season || "STEADY_STATE" });
    const first = [...(r.conflict?.results ?? []), ...r.groups.flatMap((g) => g.results), ...r.results].slice(0, 3).map((x) => x.passage.sourceTitle);
    if (wants.includes(first[0]!)) t1++;
    if (first.some((t) => wants.includes(t))) t3++;
    else misses.push(`  MISS (${audience}) ${q}\n       -> ${r.outcome}: ${first.join(" | ") || "(nothing shown)"}\n       want: ${wants.join(" or ")}`);
  }
  const n = rows.length - hidden;
  const pct = (k: number) => `${(100 * k / Math.max(1, n)).toFixed(1)}%`;
  if (!args.includes("--quiet")) console.log(misses.join("\n"));
  console.log(`\n${file}: ${n} questions  top-1 ${t1} (${pct(t1)})  top-3 ${t3} (${pct(t3)})  misses ${n - t3}` +
    (asked ? `  (${asked} asked as a role that can see the job aid)` : "") + (hidden ? `  (${hidden} skipped: job aid in no role's folders)` : ""));
  if (unknown.size) console.log(`  note: these expected titles are not job aids (typo or removed): ${[...unknown].join("; ")}`);
}
