// Quick answer (src/engine/answer.ts): one verbatim job-aid sentence or table row above the results, only when the
// answer is clear. Never generated, never shown when the situation must be confirmed, a conflict is open, or a safety
// procedure comes first; always from a result the agent's role can see; off when the content turns it off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContent } from "../scripts/build.ts";
import { buildKnowledge } from "../src/build/knowledge.ts";
import { createEngine, search } from "../src/engine/search.ts";
import type { Profile } from "../src/engine/types.ts";
import { ROOT } from "./helpers.ts";

const { corpus, vocab } = loadContent(join(ROOT, "content", "real"));
const kb = buildKnowledge(corpus, vocab, { imageExt: ".jpg" });
const engine = createEngine(kb);
const L1: Profile = { audience: "L1", season: "STEADY_STATE" };
const SR: Profile = { audience: "SR", season: "STEADY_STATE" };
const questions = ["golden.txt", "coverage.txt"].flatMap((f) => readFileSync(join(ROOT, "tests", "fixtures", f), "utf8")
  .split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("|")[2]!));

test("the switch is on for the real content", () => {
  assert.deepEqual(kb.quickAnswers, { facts: true, steps: true, sentences: true });
});

test("every quick answer is verbatim job-aid text from a result the role sees, never a clarify/conflict/safety answer", () => {
  let shown = 0; const fails: string[] = [];
  for (const profile of [L1, SR, { ...L1, audience: "SME" }]) for (const q of questions) {
    const r = search(engine, q, profile);
    const qa = r.quickAnswer;
    if (!qa) continue;
    shown++;
    const p = kb.passages.find((x) => x.id === qa.passageId);
    if (!p) { fails.push(`${q}: unknown passage`); continue; }
    const slideText = kb.passages.filter((x) => x.sourceId === p.sourceId && x.slide === p.slide).map((x) => x.text).join("\n");
    const verbatim = qa.steps ? qa.steps.every((l) => slideText.includes(l)) : qa.text.includes(" | ") ? qa.text.split(" | ").every((cell) => p.text.includes(cell)) : p.text.includes(qa.text);
    if (!verbatim) fails.push(`${q}: not verbatim: "${qa.text}"`);
    if (qa.value && !qa.text.includes(qa.value)) fails.push(`${q}: value outside the quoted text`);
    if (!r.results.some((x) => x.passage.id === qa.passageId && x.band === "Strong match")) fails.push(`${q}: not a Strong result`);
    if (r.outcome !== "ANSWER" || r.groups.length || r.conflict) fails.push(`${q}: shown with outcome ${r.outcome}`);
    if (r.notes.some((n) => n.startsWith("Safety procedure shown first"))) fails.push(`${q}: shown above a safety procedure`);
    if (qa.sourceTitle !== p.sourceTitle || qa.slide !== p.slide) fails.push(`${q}: citation mismatch`);
  }
  assert.deepEqual(fails.slice(0, 10), [], `${fails.length} problems`);
  assert.ok(shown > 200, `${shown} quick answers checked`);
});

test("no quick answer when the rule depends on the situation, nothing is found, or safety comes first", () => {
  for (const q of ["kid is aging out, what do i do", "Someone is calling about their 21 year old aging out, but their child is now full time"]) assert.equal(search(engine, q, L1).quickAnswer, undefined, q);
  assert.equal(search(engine, "pizza delivery tracking", L1).quickAnswer, undefined);
  for (const q of ["customer is threatening me", "man said if his coverage gets cancelled he's going to come down there and hurt somebody"]) assert.equal(search(engine, q, L1).quickAnswer, undefined, q);
});

test("fact questions get the fact, marked inside the quoted text", () => {
  const fax = search(engine, "poa fax number", L1).quickAnswer;
  assert.equal(fax?.fact, "phone");
  assert.match(fax!.value!, /\d{3}.\d{3}.\d{4}/);
  const age = search(engine, "how old can a usm dependent child be covered until", SR).quickAnswer;
  assert.equal(age?.fact, "age");
  assert.match(age!.value!, /21/);
});

test("member data typed in the question never appears in the quick answer", () => {
  for (const q of ["ssn 123-45-6789 poa fax number", "member id 12345678 what is the 24 hour rule"]) {
    const qa = search(engine, q, L1).quickAnswer;
    assert.ok(!qa || !/6789|12345678/.test(JSON.stringify(qa)), q);
  }
});

test("turning the switch off removes quick answers; facts and sentences switch separately", () => {
  const off = createEngine({ ...kb, quickAnswers: undefined });
  const factsOnly = createEngine({ ...kb, quickAnswers: { facts: true, sentences: false } });
  for (const q of questions.slice(0, 150)) {
    assert.equal(search(off, q, L1).quickAnswer, undefined, q);
    const f = search(factsOnly, q, L1).quickAnswer;
    assert.ok(!f || f.kind === "fact", `${q}: sentence shown with sentences off`);
  }
});
