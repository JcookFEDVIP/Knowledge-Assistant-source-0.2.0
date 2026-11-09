// Engineering checks against the REAL job-aid content (content/real). Expected sources are chosen from job-aid titles
// and verified job-aid wording; they are not SME judgments. Safety invariants are the same as for the fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContent } from "../scripts/build.ts";
import { buildKnowledge } from "../src/build/knowledge.ts";
import { createEngine, engineFor, fitsFacets, roleThatSees, search } from "../src/engine/search.ts";
import type { Profile, SearchResponse, Result, FacetName } from "../src/engine/types.ts";
import { ROOT } from "./helpers.ts";

const DIR = join(ROOT, "content", "real");
const { corpus, vocab } = loadContent(DIR);
const kb = buildKnowledge(corpus, vocab, { imageExt: ".jpg" });
const engine = createEngine(kb);
const L1: Profile = { audience: "L1", season: "STEADY_STATE" };
// the dependent-age and LWOP job aids are in the Senior Rep folder: those answers are checked as a senior rep
const SR: Profile = { audience: "SR", season: "STEADY_STATE" };
const ask = (q: string, p: Profile = L1) => search(engine, q, p);
const shown = (r: SearchResponse): { where: string; result: Result }[] => [
  ...r.results.map((result) => ({ where: "results", result })),
  ...r.groups.flatMap((g) => g.results.map((result) => ({ where: `group:${g.value}`, result }))),
  ...(r.conflict?.results ?? []).map((result) => ({ where: "conflict", result })),
  ...r.differentSituation.map((result) => ({ where: "different", result })),
];
const titles = (list: Result[]) => [...new Set(list.map((x) => x.passage.sourceTitle))];

// S-3 (owner policy 2026-11-06, conflictPolicy "newest-revision"): in an on-topic conflict decided by revision date, only
// the most recently revised job aid's wording may be shown; older members' passages on that point never appear. An
// undecided conflict (no dates, or a tie) is shown only in the side-by-side conflict card.
function violations(r: SearchResponse, audience = "L1"): string[] {
  const out: string[] = [];
  const winner = engineFor(engine, audience).conflictWinner;
  const fitsStated = (p: (typeof kb.passages)[number]) => (Object.entries(r.resolvedFacets) as [FacetName, string][]).every(([f, v]) => !(p.facets[f]?.length) || p.facets[f]!.includes(v));
  const onTopic = new Set(kb.conflictGroups.filter((g) => (g.requires ?? [g.concept]).every((c) => r.concepts.includes(c)) && kb.passages.some((p) => p.conflictGroups.includes(g.id) && fitsStated(p))).map((g) => g.id));
  const indexed = new Set(kb.sources.filter((s) => s.indexed).map((s) => s.id));
  for (const d of shown(r)) {
    const p = d.result.passage;
    if (!indexed.has(p.sourceId)) out.push(`S-4 ${p.id}`);
    for (const g of p.conflictGroups.filter((x) => onTopic.has(x))) {
      const w = winner.get(g);
      if (w ? w.sourceId !== p.sourceId : d.where !== "conflict") out.push(`S-3 ${p.id} in ${d.where}${w ? ` (older than ${w.sourceTitle})` : ""}`);
    }
    const src = kb.passages.find((x) => x.id === p.id)!;
    if (src.text !== p.text || JSON.stringify(src.conditions) !== JSON.stringify(p.conditions)) out.push(`S-5 ${p.id}`);
    // S-1: a rule scoped to one situation, shown flat while that situation is unknown, must never be a Strong match,
    // and must never be shown flat at all when the question is about that rule's topic.
    if (d.where === "results") for (const c of p.concepts) for (const f of engine.concepts.get(c)!.ruleFacets) {
      if (r.resolvedFacets[f as FacetName] || !(p.facets[f as FacetName]?.length)) continue;
      if (r.concepts.includes(c) || d.result.band === "Strong match") out.push(`S-1 ${p.id} (${c}/${f}) flat while ${f} unresolved`);
    }
  }
  return out;
}

// The independent extraction (_knowledge_base/job_aids, made by a separate tool) exists only on the original build machine.
const REF_DIR = join(ROOT, "..", "_knowledge_base", "job_aids");
test("ingestion: every PowerPoint passage is verbatim job-aid text (checked against an independent extraction)", { skip: existsSync(REF_DIR) ? false : "independent extraction not on this computer (../_knowledge_base/job_aids)" }, () => {
  let checked = 0; const bad: string[] = [];
  const norm = (s: string) => s.replace(/[​ ]/g, " ").replace(/\s+/g, " ").trim();
  const dupTitles = new Set(corpus.sources.filter((x, i, all) => all.findIndex((y) => y.title === x.title) !== i).map((x) => x.title));
  for (const s of corpus.sources.filter((x) => x.format === "pptx" && !dupTitles.has(x.title))) { // reference .md is ambiguous when two files share a title
    const md = join(ROOT, "..", "_knowledge_base", "job_aids", `${s.id}.md`);
    if (!existsSync(md)) continue;
    const ref = norm(readFileSync(md, "utf8"));
    for (const sl of s.slides) if (!sl.transcribed) for (const u of sl.units) for (const line of u.text.split("\n").flatMap((x) => x.split(" | "))) { // grid rows are verbatim cells joined with " | "
      const l = norm(line);
      if (l.length < 12) continue;
      checked++;
      if (!ref.includes(l)) bad.push(`${s.id} s${sl.n}: ${l.slice(0, 80)}`);
    }
  }
  assert.ok(checked > 3000, `checked ${checked} lines`);
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} lines not found verbatim`);
});

test("every indexed slide with an image reference has a rendered image from the original file", () => {
  const missing = kb.sources.filter((s) => s.indexed && s.format === "pptx").flatMap((s) => s.slides.filter((sl) => sl.image && !existsSync(join(DIR, sl.image))).map((sl) => `${s.id}-${sl.n}`));
  assert.deepEqual(missing, []);
});

test("all content is labeled pending owner approval; nothing is presented as approved", () => {
  assert.ok(kb.passages.length > 1500);
  assert.ok(kb.passages.every((p) => p.approval === "pending"));
});

test("USM dependent age returns the uniformed-service rule (21, or 23 for students)", () => {
  const r = ask("USM dependent age", SR);
  assert.equal(r.outcome, "ANSWER");
  assert.deepEqual(titles(r.results.slice(0, 3)).every((t) => ["Dependent Eligibility Age 21 or 23 – USM", "Eligibility of USM Dependents"].includes(t)), true, titles(r.results.slice(0, 3)).join(" | "));
  assert.match(r.results[0]!.passage.text, /\b21\b/);
  assert.ok(r.results.every((x) => !(x.passage.facets.affiliation ?? []).includes("FED_CIV")), "no civilian rules in the USM answer");
  assert.deepEqual(violations(r, "SR"), []);
  const l1 = ask("USM dependent age"); // L1 sees only its own folder; the affiliation rules still hold there
  assert.ok(l1.results.every((x) => !(x.passage.facets.affiliation ?? []).includes("FED_CIV")), "L1: no civilian rules in the USM answer");
  assert.deepEqual(violations(l1), []);
});

test("Federal Civilian dependent age returns the civilian rule (22)", () => {
  const r = ask("federal civilian employee, daughter turning 22", SR);
  assert.equal(r.outcome, "ANSWER");
  assert.ok(["Dependent Eligibility Age 22 – CIV Employee or USPS", "FEDVIP Eligibility - Dependents (FED CIV)"].includes(r.results[0]!.passage.sourceTitle));
  assert.match(r.results[0]!.passage.text, /\b22\b/);
  assert.ok(r.results.every((x) => !(x.passage.facets.affiliation ?? []).includes("USM")), "no USM rules in the civilian answer");
  const l1 = ask("federal civilian employee, daughter turning 22");
  assert.ok(l1.results.every((x) => !(x.passage.facets.affiliation ?? []).includes("USM")), "L1: no USM rules in the civilian answer");
  assert.deepEqual(violations(l1), []);
});

test("the example question shows civilian AND uniformed rules, plus job aids that don't say, and asks", () => {
  for (const q of ["Someone is calling about their 21 year old aging out, but their child is now full time", "kid is aging out, what do i do", "dependant agin out ful time studnet"]) {
    const r = ask(q);
    assert.equal(r.outcome, "CLARIFY", q);
    const values = r.groups.map((g) => g.value);
    assert.ok(values.some((v) => v?.includes("FED_CIV")), `${q}: civilian group`);
    assert.ok(values.some((v) => v?.includes("USM")), `${q}: uniformed group`);
    assert.deepEqual(violations(r), [], q);
  }
});

const CONFLICTS: [string, string][] = [
  ["caller reporting a death, how many security pieces before I transfer", "CG-DEATH-SECURITY"],
  ["daughter wants to pay her mothers bill by ach", "CG-THIRD-PARTY-ACH"],
  ["how many pieces of security on an outbound call back", "CG-OUTBOUND-SECURITY"],
  ["how long before I check back on a caller on hold", "CG-HOLD-CHECKBACK"],
  ["spanish abw script", "CG-SPANISH-ABW"],
  ["can we reinstate coverage for workforce changes", "CG-WORKFORCE-REINSTATE"],
];
// Each conflict is asked as a role that sees at least two of its job aids (L1 first). Decided by revision date: the
// newest job aid is answered, older wording on the point is left out and named in a note. Undecided: side by side.
const membersOf = (g: string) => [...new Set(kb.passages.filter((p) => p.conflictGroups.includes(g)).map((p) => p.sourceId))];
const roleFor = (g: string) => (kb.roles ?? []).find((r) => membersOf(g).filter((id) => (kb.sources.find((s) => s.id === id)!.folders ?? []).some((f) => r.folders.includes(f))).length >= 2)!.id;
for (const [q, g] of CONFLICTS) test(`known conflict follows the owner's rule (newest revision, else side by side): "${q}"`, () => {
  const audience = roleFor(g);
  const r = ask(q, { ...L1, audience });
  const w = engineFor(engine, audience).conflictWinner.get(g);
  if (w) {
    assert.notEqual(r.outcome, "CONFLICT", q);
    const top = shown(r).slice(0, 5).map((d) => d.result.passage.sourceTitle);
    assert.ok(top.includes(w.sourceTitle), `${q}: newest (${w.sourceTitle}) shown; got ${top.join(" | ")}`);
    // the note appears when the conflict applies to this question (two or more of its job aids fit the situation)
    const fitting = membersOf(g).filter((id) => engineFor(engine, audience).byId.size && [...engineFor(engine, audience).byId.values()].some((p) => p.sourceId === id && p.conflictGroups.includes(g) && fitsFacets(kb, r.resolvedFacets, p)));
    if (fitting.length >= 2 && r.concepts.includes(kb.conflictGroups.find((x) => x.id === g)!.concept)) assert.ok(r.notes.some((n) => n.includes("most recently revised") && n.includes(w.sourceTitle)), `${q}: note names the newest`);
    for (const d of shown(r)) assert.ok(!(d.result.passage.conflictGroups.includes(g) && d.result.passage.sourceId !== w.sourceId), `${q}: older ${d.result.passage.id} shown`);
  } else {
    assert.equal(r.outcome, "CONFLICT", q);
    assert.equal(r.conflict!.groupId, g);
    assert.ok(new Set(r.conflict!.results.map((x) => x.passage.sourceId)).size >= 2);
  }
  assert.deepEqual(violations(r, audience), [], q);
});

test("conflict policy: decided only by a newer printed date; undated or tied conflicts stay side by side", () => {
  for (const [g, w] of engineFor(engine, "SR").conflictWinner) {
    const dates = membersOf(g).map((id) => kb.sources.find((s) => s.id === id)!.printedRevision);
    assert.match(w.printedRevision, /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/, `${g}: winner has a printed date`);
    assert.ok(dates.filter((d) => d === w.printedRevision).length === 1, `${g}: no tie`);
  }
});

const ANSWERS: [string, string[]][] = [
  ["how do i do a cold tranfser", ["CXone Cold Transfers (Internal)", "CXone Cold Transfers (External)"]],
  ["POA vs ADI what can they do", ["Third Party Callers", "Authorization (ADI) - Denial Letters"]],
  ["caller is deaf", ["Communication Options for the Deaf"]],
  ["a news reporter is calling", ["Handling Inquiries From the Media"]],
  ["employee is on lwop", ["Leave Without Pay (LWOP)", "Handling a Leave Without Pay Call"]],
  ["customer is threatening me", ["Handling Threats and Inappropriate Behavior"]],
  ["how do I clear my edge cache", ["Clearing MS Edge Cache"]],
  ["login.gov help", ["BENEFEDS Login.gov Support", "BENEFEDS.gov Linked Account Sign In", "BENEFEDS.gov Unlinked Account Sign In"]],
];
for (const [q, expect] of ANSWERS) test(`finds the right job aid: "${q}"`, () => {
  const r = ask(q, { ...L1, audience: roleThatSees(kb, "L1", expect)! });
  const top = titles([...r.results, ...r.groups.flatMap((g) => g.results)].slice(0, 5));
  assert.ok(top.some((t) => expect.includes(t)), `${q}: top ${top.join(" | ")}`);
  assert.deepEqual(violations(r), [], q);
});

test("unsupported questions get no answer", () => {
  const wifi = ask("what is the wifi password");
  assert.ok(!shown(wifi).some((d) => d.result.band === "Strong match"), "wifi: password-reset aids are not a strong match");
  assert.ok(wifi.notes.some((n) => n.includes("wifi")), "wifi: says the job aids don't mention it");
  for (const q of ["what is the dress code for the holiday party", "best pizza near the office", "can i bring my dog to work"]) {
    const r = ask(q);
    assert.equal(r.outcome, "NO_ANSWER", q);
    assert.equal(shown(r).length, 0, q);
  }
});

test("job aids flagged with outdated dates carry their advisory", () => {
  const r = ask("open season current plan year call script");
  const hit = shown(r).find((d) => d.result.passage.sourceTitle === "Open Season Current Plan Year Call");
  assert.ok(hit, "found");
  assert.match(hit!.result.passage.advisory ?? "", /2025/);
});

test("safety sweep on real content: affiliation-dependent topics never shown as universal", () => {
  let n = 0; const fails: string[] = [];
  for (const c of kb.vocab.concepts.filter((x) => x.ruleFacets.length && !x.autoTitle)) for (const term of c.terms.slice(0, 10))
    for (const cue of ["", "federal civilian", "usps", "military", "postal and military"]) {
      const q = `caller asking about ${term} ${cue}`.trim();
      const r = ask(q); n++;
      for (const v of violations(r)) fails.push(`${v} <= "${q}"`);
    }
  assert.deepEqual(fails.slice(0, 10), [], `${fails.length} violations / ${n}`);
  assert.ok(n >= 200, `sweep size ${n}`);
});

test("latency on real content stays interactive (dev machine sanity bound)", () => {
  const qs = ["USM dependent age", "cold transfer", "daughter wants to pay her mothers bill", "kid is aging out", "login.gov help"];
  const t0 = performance.now();
  for (let i = 0; i < 50; i++) ask(qs[i % qs.length]!);
  const per = (performance.now() - t0) / 50;
  assert.ok(per < 150, `mean ${per.toFixed(1)} ms per search`);
});
