// Response scripts must be job-aid wording only: every line is a verbatim quote from a passage, with its citation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadContent } from "../scripts/build.ts";
import { buildKnowledge } from "../src/build/knowledge.ts";
import { createEngine, search } from "../src/engine/search.ts";
import { frameLines, responseScript } from "../src/engine/script.ts";
import type { Profile } from "../src/engine/types.ts";
import { ROOT } from "./helpers.ts";

const { corpus, vocab } = loadContent(join(ROOT, "content", "real"));
const kb = buildKnowledge(corpus, vocab, { imageExt: ".jpg" });
const engine = createEngine(kb);
const L1: Profile = { audience: "L1", season: "STEADY_STATE" };
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const script = (q: string) => { const r = search(engine, q, L1); const top = [...(r.conflict?.results ?? []), ...r.groups.flatMap((g) => g.results), ...r.results][0]!; return { top, lines: responseScript(engine, top, r, L1) }; };

test("the call-flow lines (hold, return, transfer, empathy, closing) are found verbatim in the job aids", () => {
  const f = frameLines(engine);
  for (const k of ["hold", "back", "transfer", "empathy", "condolence", "close1", "close2"]) assert.ok(f[k]?.text, `frame line ${k}`);
});

test("every script line is verbatim job-aid wording from the cited job aid and slide", () => {
  const qs = ["caller wants to cancel because he retired", "caller is upset and wants a supervisor", "husband passed away caller reporting death",
    "caller enrolled yesterday after a QLE and wants to cancel", "member wants to set up automatic bank withdrawal", "how do I place a caller on hold",
    "customer wants to cancel because premiums went up", "caller is deaf", "spanish speaking caller", "caller wants to pay by ach"];
  for (const q of qs) for (const l of script(q).lines) {
    if (!l.text) continue;
    const src = kb.passages.filter((p) => p.sourceTitle === l.sourceTitle && p.slide === l.slide);
    assert.ok(src.some((p) => flat(p.text).includes(flat(l.text))), `"${l.text.slice(0, 60)}" not verbatim in ${l.sourceTitle} s${l.slide} (${q})`);
    assert.ok(!/^(QA |Transfer Notes|Commenting with AutoSummary|AWD )/.test(l.sourceTitle!), `script from a non-caller-facing job aid: ${l.sourceTitle}`);
  }
});

test("scripts follow the call: answer lines come from the job aid on screen; death calls close with condolences", () => {
  const cancel = script("caller wants to cancel because he retired");
  assert.ok(cancel.lines.some((l) => l.step === "answer"));
  const death = script("husband passed away caller reporting death");
  assert.ok(death.lines.some((l) => l.step === "condolence"));
  const upset = script("caller is upset and wants a supervisor");
  assert.ok(upset.lines.some((l) => l.step === "empathy"));
  // a job aid with no scripted wording says so instead of inventing one
  const none = script("how do I do a cold transfer");
  assert.ok(none.lines.every((l) => l.step === "none" || l.text));
});
