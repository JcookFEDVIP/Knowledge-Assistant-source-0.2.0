// All topics first (RANK.partialTopicFactor): when a question names two topics ("sponsor" + "cancel"), a job aid about
// only one of them ("cancel" in an ABW payment job aid) must not outrank job aids about both.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadContent } from "../scripts/build.ts";
import { buildKnowledge } from "../src/build/knowledge.ts";
import { createEngine, search } from "../src/engine/search.ts";
import { ROOT } from "./helpers.ts";

const { corpus, vocab } = loadContent(join(ROOT, "content", "real"));
const kb = buildKnowledge(corpus, vocab, { imageExt: ".jpg" });
const engine = createEngine(kb);
const ask = (q: string, audience: string) => search(engine, q, { audience, season: "STEADY_STATE" });

test("sponsor wants to cancel their account: the ABW payment job aid is not first", () => {
  for (const audience of ["L1", "SME"]) {
    const top = ask("sponsor wants to cancel their account", audience).results[0]!;
    assert.notEqual(top.passage.sourceTitle, "Edit ABW Information L1", audience);
    assert.ok(top.passage.concepts.includes("CANCELLATION"), `${audience}: ${top.passage.sourceTitle}`);
  }
});

test("senior rep, Uniformed Service sponsor wants to cancel: the sponsor inactivation procedure is in the top results", () => {
  const titles = ask("sponsor wants to cancel their account usm", "SR").results.slice(0, 5).map((r) => r.passage.sourceTitle);
  assert.ok(titles.includes("Enrollment or Inactivation Due to Divorce"), titles.join("; "));
});

test("a single-topic question is unaffected", () => {
  const top = ask("member wants to cancel", "L1").results[0]!;
  assert.equal(top.passage.sourceTitle, "Cancelling FEDVIP Coverage Talking Points");
});
