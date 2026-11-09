// Vocabulary self-check on real content: every curated topic term must trigger its own topic when typed on its own,
// and every situation cue must resolve its own value. A term that can never match is dead weight that hides gaps.
// (Terms that are entirely filler words, e.g. "the caller", are skipped: they are removed before matching by design.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadContent } from "../scripts/build.ts";
import { buildKnowledge } from "../src/build/knowledge.ts";
import { createEngine, search } from "../src/engine/search.ts";
import { normalize, stripFillers } from "../src/engine/analyze.ts";
import type { FacetName, Profile } from "../src/engine/types.ts";
import { ROOT } from "./helpers.ts";

const { corpus, vocab } = loadContent(join(ROOT, "content", "real"));
const kb = buildKnowledge(corpus, vocab, { imageExt: ".jpg" });
const engine = createEngine(kb);
const L1: Profile = { audience: "L1", season: "STEADY_STATE" };
const fillerFree = (t: string) => stripFillers(normalize(t), kb.vocab.fillers) === normalize(t);

test("every topic term triggers its own topic", () => {
  const dead: string[] = [];
  for (const c of kb.vocab.concepts.filter((x) => !x.autoTitle)) for (const t of c.terms) {
    const q = t.replace(/\*$/, "");
    if (!fillerFree(q)) continue;
    if (!search(engine, q, L1).concepts.includes(c.id)) dead.push(`${c.id}: "${t}"`);
  }
  assert.deepEqual(dead, []);
});

test("every situation cue resolves its own value", () => {
  const dead: string[] = [];
  for (const [f, def] of Object.entries(kb.vocab.facets) as [FacetName, (typeof kb.vocab.facets)[FacetName]][]) {
    if (f === "audience" || f === "season") continue; // role and season come from the profile (season: the calendar), never from the question
    for (const [val, v] of Object.entries(def.values)) for (const cue of v.cues) {
      if (!fillerFree(cue)) continue;
      const r = search(engine, cue, L1);
      if (r.resolvedFacets[f] !== val && !r.contradictoryFacets.includes(f)) dead.push(`${f}=${val}: "${cue}"`);
    }
  }
  assert.deepEqual(dead, []);
});
