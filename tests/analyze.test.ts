import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, editDistance } from "../src/engine/analyze.ts";
import { ask } from "./helpers.ts";

test("normalization: case, punctuation, hyphens, number words, ages", () => {
  assert.equal(normalize("Full-Time STUDENT!!"), "full time student");
  assert.equal(normalize("their twenty one year old"), "their 21 year old");
  assert.equal(normalize("a 21yo and a 23-year-old"), "a 21 year old and a 23 year old");
  assert.equal(normalize("the 24th birthday"), "the 24 birthday");
  assert.equal(normalize("Dependent’s coverage"), "dependent coverage");
});

test("negation and limiting words are never dropped", () => {
  const r = ask("child is not eligible unless a student");
  for (const w of ["not", "unless"]) assert.ok(r.normalized.split(" ").includes(w), `kept '${w}'`);
});

test("typo correction fixes domain words but leaves short ordinary words alone", () => {
  const r = ask("caller says their husband passed away, need help");
  assert.deepEqual(r.corrections, [], "no rewriting of 'says' or 'need'");
  const t = ask("dependant agin out ful time studnet");
  const fixed = Object.fromEntries(t.corrections.map((c) => [c.from, c.to]));
  assert.equal(fixed["studnet"], "student");
  assert.equal(fixed["agin"], "aging");
  assert.equal(fixed["dependant"], "dependent");
});

test("acronyms are protected from correction and expanded", () => {
  const r = ask("adi vs poa");
  assert.deepEqual(r.corrections, []);
  assert.ok(r.expansions.includes("authorization"));
  assert.ok(r.concepts.includes("THIRD_PARTY_AUTH"));
});

test("'full time' alone never maps to full-time student; it raises a clarification note", () => {
  const r = ask("their child is now full time");
  assert.ok(!r.concepts.includes("FULL_TIME_STUDENT"));
  assert.ok(r.notes.some((n) => n.includes("could mean full-time student status or full-time employment")));
  const s = ask("their child is a full time student");
  assert.ok(s.concepts.includes("FULL_TIME_STUDENT"));
  assert.ok(!s.notes.some((n) => n.includes("could mean")));
});

test("edit distance handles transpositions", () => {
  assert.equal(editDistance("tranfser", "transfer", 2), 1);
  assert.equal(editDistance("abc", "xyz", 1), 2);
});
