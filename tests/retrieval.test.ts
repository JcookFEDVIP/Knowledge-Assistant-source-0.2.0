// Engineering retrieval cases over the SYNTHETIC corpus. Expected sources were written by the engineer who
// wrote the synthetic content; they are not SME judgments and say nothing about real-content quality.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ask, sourcesOf } from "./helpers.ts";

const ANSWER_CASES: [string, string][] = [
  ["how do i do a cold transfer", "S11"],
  ["how do i do a cold tranfser", "S11"],
  ["POA vs ADI what can they change", "S05"],
  ["caller says their husband passed away", "S07"],
  ["how long can i keep someone on hold", "S13"],
  ["when does coverage start for a new hire", "S17"],
  ["civilian employee child age limit", "S01"],
  ["retired military sponsor kid turning 21 is a full-time student", "S02"],
  ["postal worker daughter turning 24 aging out", "S01"],
  ["dependent who is disabled and cant support themselves", "S03"],
  ["can the enrollee change plans", "S15"],
  ["uniformed member divorced, remove ex wife", "S10"],
];

for (const [q, src] of ANSWER_CASES) {
  test(`answer: "${q}" -> ${src} ranked first`, () => {
    const r = ask(q);
    assert.equal(r.outcome, "ANSWER", `outcome for "${q}"`);
    assert.equal(r.results[0]?.passage.sourceId, src);
    assert.equal(r.results[0]?.band, "Strong match");
  });
}

test("acronym + typo + conversational filler still finds the transfer procedure", () => {
  const r = ask("I have a caller, how do I trasnfer them to the reserch team");
  assert.equal(r.results[0]?.passage.sourceId, "S11");
});

test("audience profile resolves the transfer rule; the senior-rep rule is shown only as a different situation", () => {
  const l1 = ask("how do i escalate a call");
  assert.deepEqual(sourcesOf(l1.results), ["S11"]);
  assert.deepEqual(sourcesOf(l1.differentSituation), ["S12"]);
  const sr = ask("how do i escalate a call", { audience: "SR", season: "STEADY_STATE" });
  assert.deepEqual(sourcesOf(sr.results), ["S12"]);
});

test("season is a calendar fact: the profile decides; a season named in the question only adds a note", () => {
  const steady = ask("can the enrollee change plans");
  assert.equal(steady.results[0]?.passage.id, "S15#s1#u2");
  const os = ask("can the enrollee change plans during open season");
  assert.equal(os.results[0]?.passage.id, "S15#s1#u2", "outside Open Season, 'during open season' does not switch the rules");
  assert.ok(os.notes.some((n) => n.includes("showing guidance for the current period")));
  const osProfile = ask("can the enrollee change plans", { audience: "L1", season: "OPEN_SEASON" });
  assert.equal(osProfile.results[0]?.passage.id, "S15#s1#u1");
});

test("results are passage-level, ranked, and carry transparent labels and explanations", () => {
  const r = ask("civilian employee child age limit");
  const scores = r.results.map((x) => x.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), "descending scores");
  for (const x of r.results) {
    assert.ok(["Strong match", "Related guidance", "Possible match"].includes(x.band));
    assert.ok(!/%/.test(x.band), "no percentages as labels");
    assert.ok(Number.isInteger(x.score));
    assert.ok(x.why.facetFit.length > 0);
  }
});

test("determinism: identical input gives identical output", () => {
  for (const q of ["their 21 year old is aging out", "how many security items", "pay for her mother"]) {
    assert.deepEqual(JSON.stringify(ask(q)), JSON.stringify(ask(q)));
  }
});

test("latency: 200 searches complete quickly on the dev machine (sanity bound, not a target-hardware claim)", () => {
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) ask(i % 2 ? "dependant agin out ful time studnet" : "how do i do a cold transfer");
  const per = (performance.now() - t0) / 200;
  assert.ok(per < 50, `mean ${per.toFixed(2)} ms per search`);
});
