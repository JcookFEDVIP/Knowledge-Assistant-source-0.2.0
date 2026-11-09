// Roles (content/real/roles.json): each role sees ONLY the job aids in its folders. A job aid outside a role's folders
// must never reach that role: not as a result, group, conflict card, "different situation", safety pin or script line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContent } from "../scripts/build.ts";
import { buildKnowledge } from "../src/build/knowledge.ts";
import { createEngine, search } from "../src/engine/search.ts";
import { responseScript } from "../src/engine/script.ts";
import type { Profile, RoleDef } from "../src/engine/types.ts";
import { ROOT, displayed } from "./helpers.ts";

const { corpus, vocab } = loadContent(join(ROOT, "content", "real"));
const kb = buildKnowledge(corpus, vocab, { imageExt: ".jpg" });
const engine = createEngine(kb);
const roles = kb.roles!;
const questions = ["golden.txt", "coverage.txt", "sentences.txt"].flatMap((f) => readFileSync(join(ROOT, "tests", "fixtures", f), "utf8")
  .split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("|")[2]!));
const folderOf = new Map(kb.sources.map((s) => [s.title, s.folders ?? [""]]));
const allowed = (r: RoleDef, title: string) => (folderOf.get(title) ?? [""]).some((f) => r.folders.includes(f));

test("roles are defined: L1, Senior rep and SME, with the folders the owner set", () => {
  assert.deepEqual(roles.map((r) => [r.id, r.folders, r.priority ?? null]), [
    ["L1", ["L1 Job Aids"], null],
    ["SR", ["Senior Rep Job Aids", "L1 Job Aids"], "Senior Rep Job Aids"],
    ["SME", ["L1 Job Aids", "SME Job Aids"], null],
  ]);
});

test("job aids in no role's folder are left out of the app entirely (no passages)", () => {
  const reachable = new Set(roles.flatMap((r) => r.folders));
  const out = kb.sources.filter((s) => !(s.folders ?? [""]).some((f) => reachable.has(f)));
  for (const s of out) assert.equal(s.indexed, false, s.title);
  const outIds = new Set(out.map((s) => s.id));
  assert.equal(kb.passages.filter((p) => outIds.has(p.sourceId)).length, 0);
});

test("every role sees only its own folders, for every test question (results, groups, conflicts, pins, scripts, quick answers)", () => {
  const fails: string[] = [];
  for (const r of roles) {
    const profile: Profile = { audience: r.id, season: "STEADY_STATE" };
    for (const q of questions) {
      const res = search(engine, q, profile);
      for (const d of displayed(res)) if (!allowed(r, d.result.passage.sourceTitle)) fails.push(`${r.id} "${q}" -> ${d.where}: ${d.result.passage.sourceTitle}`);
      if (res.quickAnswer && !allowed(r, res.quickAnswer.sourceTitle)) fails.push(`${r.id} "${q}" -> quick answer: ${res.quickAnswer.sourceTitle}`);
      for (const x of res.results.slice(0, 2)) for (const l of responseScript(engine, x, res, profile)) {
        if (l.sourceTitle && !allowed(r, l.sourceTitle)) fails.push(`${r.id} "${q}" -> script line from ${l.sourceTitle}`);
      }
    }
  }
  assert.deepEqual(fails.slice(0, 20), [], `${fails.length} leaks`);
});

test("an unknown role gets the most limited role (L1), never everything", () => {
  const res = search(engine, "system down checklist", { audience: "ADMIN", season: "STEADY_STATE" });
  for (const d of displayed(res)) assert.ok(allowed(roles[0]!, d.result.passage.sourceTitle), d.result.passage.sourceTitle);
});

test("senior rep: Senior Rep job aids rank ahead of L1 job aids; L1 job aids' scores are unchanged", () => {
  const sr = roles.find((r) => r.id === "SR")!;
  const flat = createEngine(kb, { ...sr, priority: undefined });
  const profile: Profile = { audience: "SR", season: "STEADY_STATE" };
  let boosted = 0;
  for (const q of questions.slice(0, 120)) {
    const a = new Map(search(engine, q, profile).results.map((x) => [x.passage.id, x]));
    for (const b of search(flat, q, profile).results) {
      const x = a.get(b.passage.id);
      if (!x) continue;
      if ((folderOf.get(b.passage.sourceTitle) ?? []).includes(sr.priority!)) { assert.ok(x.score > b.score, `${q}: ${b.passage.id} not boosted`); boosted++; }
      else assert.equal(x.score, b.score, `${q}: ${b.passage.id} (L1) score changed`);
    }
  }
  assert.ok(boosted > 0, "no Senior Rep job aid was compared");
});
