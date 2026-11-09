// npm run quick-eval [-- --show N]   How the quick answer behaves on the test questions (golden + coverage).
// Reports how often a quick answer appears, how often it quotes the expected job aid, and prints samples to review.
// "Quotes the expected job aid" is a proxy: a person still has to judge whether the sentence answers the question.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContent } from "./build.ts";
import { buildKnowledge } from "../src/build/knowledge.ts";
import { createEngine, roleThatSees, search } from "../src/engine/search.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { corpus, vocab } = loadContent();
const kb = buildKnowledge(corpus, vocab, { imageExt: ".jpg" });
const engine = createEngine(kb);
const show = Number(process.argv[process.argv.indexOf("--show") + 1]) || 40;
const rows = ["golden.txt", "coverage.txt"].flatMap((f) => readFileSync(join(ROOT, "tests", "fixtures", f), "utf8").split(/\r?\n/)
  .filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("|")));
const seen = new Set<string>();
let asked = 0, shown = 0, expected = 0; const kinds = new Map<string, number>(); const samples: string[] = [];
for (const [a, season, q, want] of rows) {
  if (seen.has(q!)) continue; seen.add(q!);
  const wants = want!.split("~");
  const role = roleThatSees(kb, a!, wants);
  if (!role) continue;
  asked++;
  const r = search(engine, q!, { audience: role, season: season! });
  const qa = r.quickAnswer;
  if (!qa) continue;
  shown++;
  const k = qa.fact ?? qa.kind; kinds.set(k, (kinds.get(k) ?? 0) + 1);
  const ok = wants.includes(qa.sourceTitle);
  if (ok) expected++;
  samples.push(`${ok ? " " : "X"} [${k}] (${role}) ${q}\n      "${qa.text}"${qa.value ? `  [${qa.value}]` : ""}\n      - ${qa.sourceTitle}, slide ${qa.slide}${ok ? "" : `   (expected ${want})`}`);
}
const pct = (n: number, d: number) => `${(100 * n / Math.max(1, d)).toFixed(1)}%`;
console.log(samples.filter((_, i) => i % Math.max(1, Math.floor(samples.length / show)) === 0).slice(0, show).join("\n"));
console.log(`\n${asked} questions: quick answer shown for ${shown} (${pct(shown, asked)}); from the expected job aid ${expected}/${shown} (${pct(expected, shown)})`);
console.log(`by kind: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(", ")}`);
