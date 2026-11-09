// Coverage of the whole job-aid library on real content. Questions come from the foundation swarm (10/2026):
// - golden.txt: questions that reach the expected job aid; every one must keep doing so.
// - coverage.txt: one natural question per job aid (all 306 aids), including ones that don't work yet. The pass rate is a
//   ratchet: it may only go up. Raise the floors when it improves.
// Roles: a question is asked as its own role when that role can see the expected job aid, else as a role that can
// (an L1 question about a Senior Rep job aid is asked as a senior rep). Job aids no role can see are not counted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContent } from "../scripts/build.ts";
import { buildKnowledge } from "../src/build/knowledge.ts";
import { createEngine, roleThatSees, search } from "../src/engine/search.ts";
import { ROOT } from "./helpers.ts";

const { corpus, vocab } = loadContent(join(ROOT, "content", "real"));
const kb = buildKnowledge(corpus, vocab, { imageExt: ".jpg" });
const engine = createEngine(kb);
const all = (f: string) => readFileSync(join(ROOT, "tests", "fixtures", f), "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("|"));
// expected title: one title, or alternatives separated by ~ (any of them counts)
const rows = (f: string) => all(f).flatMap(([a, s, q, t]) => { const r = roleThatSees(kb, a!, t!.split("~")); return r ? [[r, s, q, t]] : []; });
const firstThree = (q: string, audience: string, season: string) => {
  const r = search(engine, q, { audience, season });
  return [...(r.conflict?.results ?? []), ...r.groups.flatMap((g) => g.results), ...r.results].slice(0, 3).map((x) => x.passage.sourceTitle);
};

test("golden questions keep reaching their job aid", () => {
  const g = rows("golden.txt");
  const failed = g.filter(([audience, season, q, title]) => !firstThree(q!, audience!, season!).some((x) => title!.split("~").includes(x))).map(([a, , q, t]) => `${q} (${a}) -> want ${t}`);
  assert.ok(all("golden.txt").length >= 300, `${all("golden.txt").length} golden questions`);
  assert.ok(g.length >= 280, `${g.length} golden questions reach a role-visible job aid`);
  assert.deepEqual(failed, [], `${failed.length}/${g.length} missed`);
});

test("library coverage ratchet: one question per job aid", () => {
  const c = rows("coverage.txt");
  let top1 = 0, top3 = 0;
  for (const [audience, season, q, title] of c) {
    const f = firstThree(q!, audience!, season!);
    const wants = title!.split("~");
    if (wants.includes(f[0]!)) top1++;
    if (f.some((x) => wants.includes(x))) top3++;
  }
  const p1 = top1 / c.length, p3 = top3 / c.length;
  assert.ok(all("coverage.txt").length >= 300 && c.length >= 260, `${c.length}/${all("coverage.txt").length} coverage questions about role-visible job aids`);
  assert.ok(p3 >= 0.92, `top-3 coverage ${(100 * p3).toFixed(1)}% fell below the 92% floor`);
  assert.ok(p1 >= 0.66, `top-1 coverage ${(100 * p1).toFixed(1)}% fell below the 66% floor`);
});
