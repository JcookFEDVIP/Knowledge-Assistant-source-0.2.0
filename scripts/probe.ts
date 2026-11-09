// Dev tool: run queries against the current content and print outcomes. Usage: node --experimental-strip-types scripts/probe.ts "query" ...
import { loadContent } from "./build.ts";
import { buildKnowledge } from "../src/build/knowledge.ts";
import { createEngine, search } from "../src/engine/search.ts";

const { corpus, vocab, hasImages } = loadContent();
const kb = buildKnowledge(corpus, vocab, { imageExt: hasImages ? ".jpg" : ".svg" });
const engine = createEngine(kb);
const profile = { audience: process.env.KA_ROLE ?? "L1", season: process.env.KA_SEASON ?? kb.defaultSeason };
const short = (t: string) => t.replace(/\s+/g, " ").slice(0, 150);
for (const q of process.argv.slice(2)) {
  const t0 = performance.now(); const r = search(engine, q, profile); const ms = (performance.now() - t0).toFixed(1);
  console.log(`\n> ${q}\n  ${r.outcome} (${ms} ms) concepts=${r.concepts.filter((c) => !c.startsWith("TITLE:")).join(",")} titles=${r.concepts.filter((c) => c.startsWith("TITLE:")).length} facets=${JSON.stringify(r.resolvedFacets)}${r.corrections.length ? " fixes=" + r.corrections.map((c) => c.from + ">" + c.to).join(" ") : ""}`);
  for (const n of r.notes) console.log(`  note: ${short(n)}`);
  if (r.conflict) { console.log(`  CONFLICT ${r.conflict.groupId}`); for (const x of r.conflict.results) console.log(`    - ${x.passage.sourceTitle} s${x.passage.slide}: ${short(x.passage.text)}`); }
  for (const g of r.groups) { console.log(`  [${g.label}]`); for (const x of g.results) console.log(`    - ${x.passage.sourceTitle} s${x.passage.slide}: ${short(x.passage.text)}`); }
  for (const x of r.results.slice(0, 5)) console.log(`  ${x.band.padEnd(16)} ${x.passage.sourceTitle} s${x.passage.slide}: ${short(x.passage.text)}`);
  if (r.differentSituation.length) console.log(`  (different situation: ${r.differentSituation.map((x) => x.passage.sourceTitle).join("; ")})`);
}
