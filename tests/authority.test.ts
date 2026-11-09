// Source-authority model (A1 conflict, A2 superseded, A3 unknown, A4 facet alternatives, A5 no approved source)
// and the pre-index validator (V-1..V-6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKnowledge, ValidationError } from "../src/build/knowledge.ts";
import { kb, ask, displayed, sourcesOf, loadInputs, clone } from "./helpers.ts";
import { createEngine, search } from "../src/engine/search.ts";
import { L1 } from "./helpers.ts";

const ALL_QUERIES = ["death certificate needed when someone passed away", "caller reporting a death", "how long is hold check back",
  "reinstate coverage after workforce changes", "pay for her mother", "security items", "aging out", "divorce"];

test("A2: superseded source is never indexed, shown or cited", () => {
  assert.equal(kb.passages.filter((p) => p.sourceId === "S08").length, 0);
  for (const q of ALL_QUERIES) for (const d of displayed(ask(q))) assert.notEqual(d.result.passage.sourceId, "S08", q);
  const r = ask("does the caller need a death certificate to report a death");
  assert.equal(r.outcome, "ANSWER");
  assert.equal(r.results[0]?.passage.sourceId, "S07", "current replacement only");
});

test("A3: approval-unknown sources are excluded; their topics get no answer", () => {
  assert.equal(kb.passages.filter((p) => ["S14", "S16"].includes(p.sourceId)).length, 0);
  const r = ask("can we reinstate coverage after workforce changes");
  assert.equal(r.outcome, "NO_ANSWER");
  assert.equal(displayed(r).length, 0);
  const hold = ask("how long can a caller be on hold");
  for (const d of displayed(hold)) assert.notEqual(d.result.passage.sourceId, "S14");
  assert.ok(!JSON.stringify(hold).includes("4 minutes"), "draft 4-minute rule never shown");
});

test("A1: two current approved sources that disagree are shown side by side, unresolved", () => {
  for (const q of ["daughter calling to pay her mothers bill", "can someone else pay for the enrollee", "third party payment from their bank account"]) {
    const r = ask(q);
    assert.equal(r.outcome, "CONFLICT", q);
    assert.deepEqual(sourcesOf(r.conflict!.results).sort(), ["S04", "S06"], q);
    for (const d of displayed(r)) if (d.result.passage.conflictGroups.includes("CG-01")) assert.equal(d.where, "conflict", `${q}: conflict passage only inside the conflict card`);
    assert.ok(r.conflict!.results.every((x) => x.band !== "Strong match"));
  }
});

test("A1 with the owner's newest-revision policy: newest job aid answers, older wording is left out and named; ties and undated stay side by side", () => {
  const withPolicy = (edit: (c: ReturnType<typeof loadInputs>["corpus"]) => void) => {
    const inputs = loadInputs(); const corpus = clone(inputs.corpus); edit(corpus);
    return createEngine(buildKnowledge({ ...corpus, conflictPolicy: "newest-revision" }, clone(inputs.vocab)));
  };
  const q = "daughter calling to pay her mothers bill";
  // S06 (Revised on 09/11/26) is newer than S04 (Reviewed on 08/20/26)
  const decided = search(withPolicy(() => {}), q, L1);
  assert.notEqual(decided.outcome, "CONFLICT");
  for (const d of displayed(decided)) if (d.result.passage.conflictGroups.includes("CG-01")) assert.equal(d.result.passage.sourceId, "S06", `${d.where}: only the newest`);
  assert.ok(displayed(decided).some((d) => d.result.passage.sourceId === "S06"));
  assert.ok(decided.notes.some((n) => n.includes("most recently revised") && n.includes("Security Verification")), "the left-out job aid is named");
  // same date, or no dates at all: cannot decide, so both sides are shown in the conflict card
  for (const edit of [(c: ReturnType<typeof loadInputs>["corpus"]) => { c.sources.find((s) => s.id === "S04")!.printedRevision = "Revised on 09/11/26"; },
    (c: ReturnType<typeof loadInputs>["corpus"]) => { for (const s of c.sources) s.printedRevision = "(no revision date printed)"; }]) {
    const r = search(withPolicy(edit), q, L1);
    assert.equal(r.outcome, "CONFLICT");
    assert.deepEqual(sourcesOf(r.conflict!.results).sort(), ["S04", "S06"]);
  }
});

test("A1 passages never leak into ordinary results for neighbouring questions", () => {
  for (const q of ["how many security items for the enrollee", "verify the enrollee before sharing details", "third party authorization"]) {
    { const r = ask(q); for (const d of displayed(r)) if (d.result.passage.conflictGroups.includes("CG-01") && r.concepts.includes("THIRD_PARTY_PAYMENT")) assert.equal(d.where, "conflict", q); }
  }
});

test("A4: facet differences are alternatives (Clarify), not conflicts", () => {
  const r = ask("caller is getting divorced, how do they remove the spouse");
  assert.equal(r.outcome, "CLARIFY");
  assert.equal(r.unresolvedFacet, "affiliation");
  assert.equal(r.conflict, undefined);
  assert.deepEqual(r.groups.map((g) => sourcesOf(g.results)).flat().sort(), ["S09", "S10"]);
});

test("A5: unsupported questions get an explicit no-answer with no passages", () => {
  for (const q of ["what is the dress code for the holiday party", "can a grandchild be covered", "best pizza near the office",
    "can I get a refund for a cracked crown", "is lasik covered for my spouse"]) {
    const r = ask(q);
    assert.equal(r.outcome, "NO_ANSWER", q);
    assert.equal(displayed(r).length, 0, q);
  }
});

// ---------- validator ----------
const base = loadInputs();
const expectFail = (mutate: (c: ReturnType<typeof loadInputs>["corpus"]) => void, rx: RegExp) => {
  const c = clone(base.corpus); mutate(c);
  assert.throws(() => buildKnowledge(c, clone(base.vocab)), (e: unknown) => e instanceof ValidationError && e.problems.some((p) => rx.test(p)));
};

test("validator: build fails on an unclassified conflict candidate (V-4)", () => {
  expectFail((c) => { c.classifications = []; }, /V-4 unclassified conflict candidate: S04#s2#u1 <-> S06#s1#u2/);
});
test("validator: build fails when a superseded source points to a missing replacement (V-3)", () => {
  expectFail((c) => { c.sources.find((s) => s.id === "S08")!.supersededBy = "S99"; }, /V-3 S08/);
});
test("validator: build fails on an unknown concept (V-5) and on facet-dependent passages without scope (V-5)", () => {
  expectFail((c) => { c.sources[0]!.slides[0]!.units[0]!.concepts!.push("NOPE"); }, /V-5 .*unknown concept NOPE/);
  expectFail((c) => { c.sources.find((s) => s.id === "S01")!.facets = {}; }, /V-5 S01#s1#u1: concept DEPENDENT_AGE_LIMIT depends on 'affiliation'/);
});
test("validator: an open conflict group needs two current approved sources (V-4)", () => {
  expectFail((c) => { c.sources.find((s) => s.id === "S06")!.approval = "unknown"; }, /conflict group CG-01 needs passages from at least two/);
});
test("validator: a source whose approval record doesn't resolve is excluded, not indexed (V-2)", () => {
  const c = clone(base.corpus); c.sources.find((s) => s.id === "S13")!.approvalRecord = "OWN-NOBODY";
  const k = buildKnowledge(c, clone(base.vocab));
  assert.equal(k.sources.find((s) => s.id === "S13")!.indexed, false);
  assert.equal(k.passages.filter((p) => p.sourceId === "S13").length, 0);
});
test("validator: conditions must carry a condition marker (V-6)", () => {
  expectFail((c) => { c.sources[0]!.slides[0]!.units[1]!.conditions = ["There is no student extension."]; }, /V-6/);
});
