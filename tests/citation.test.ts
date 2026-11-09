// Citation integrity: every passage and every displayed result resolves to the exact source version, slide and
// verbatim text; slide images exist for every cited slide; excluded sources ship no text or images.
import { test, before } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { kb, ask, displayed, loadInputs, ROOT } from "./helpers.ts";
import { canonicalSource } from "../src/build/knowledge.ts";
import { runBuild } from "../scripts/build.ts";

const { corpus } = loadInputs();
const OUT = mkdtempSync(join(tmpdir(), "ka-build-"));
before(async () => { await runBuild({ content: "content/synthetic", out: OUT }); });

test("every passage is verbatim from its source unit, and its locator is exact", () => {
  for (const p of kb.passages) {
    const src = corpus.sources.find((s) => s.id === p.sourceId)!;
    const unit = src.slides.find((s) => s.n === p.slide)!.units[p.unit - 1]!;
    assert.equal(p.text, unit.text, p.id);
    assert.deepEqual(p.conditions, unit.conditions ?? [], p.id);
    assert.equal(p.id, `${p.sourceId}#s${p.slide}#u${p.unit}`);
  }
});

test("source hashes bind citations to the exact content version", () => {
  for (const s of kb.sources) {
    const raw = corpus.sources.find((x) => x.id === s.id)!;
    assert.equal(s.sha256, createHash("sha256").update(canonicalSource(raw), "utf8").digest("hex"), s.id);
  }
  for (const p of kb.passages) assert.equal(p.sourceSha256, kb.sources.find((s) => s.id === p.sourceId)!.sha256);
});

test("every displayed result across many queries has a resolvable citation and an existing slide image", () => {
  const queries = ["their 21 year old is aging out", "cold transfer", "pay for her mother", "divorce uniformed", "POA", "hold", "plan change open season", "death", "security items", "effective date"];
  let checked = 0;
  for (const q of queries) for (const d of displayed(ask(q))) {
    const c = d.result.citation;
    const src = kb.sources.find((s) => s.id === c.sourceId)!;
    assert.ok(src.indexed, `${q}: cited source indexed`);
    const slide = src.slides.find((s) => s.n === c.slide);
    assert.ok(slide, `${q}: slide ${c.slide} exists`);
    assert.ok(existsSync(join(OUT, slide!.image!)), `${q}: image ${slide!.image}`);
    assert.equal(c.knowledgeVersion, kb.knowledgeVersion);
    const svg = readFileSync(join(OUT, slide!.image!), "utf8");
    const firstWords = d.result.passage.text.split(" ").slice(0, 4).join(" ").replace(/&/g, "&amp;").replace(/'/g, "'");
    assert.ok(svg.includes(firstWords), `${q}: slide image contains cited text "${firstWords}"`);
    checked++;
  }
  assert.ok(checked > 20, `checked ${checked} citations`);
});

test("excluded sources (superseded / approval unknown) ship no text and no slide images in the build", () => {
  const data = readFileSync(join(OUT, "data.js"), "utf8");
  for (const s of kb.sources.filter((x) => !x.indexed)) {
    const raw = corpus.sources.find((x) => x.id === s.id)!;
    for (const sl of raw.slides) {
      assert.ok(!existsSync(join(OUT, "slides", `${s.id}-${sl.n}.svg`)), `${s.id} slide image absent`);
      for (const u of sl.units) assert.ok(!data.includes(u.text), `${s.id} text absent from data.js`);
    }
  }
});
