// Zero-tolerance safety invariants (S-1..S-7) checked over a generated sweep of query variants for every
// concept whose rule depends on a facet, plus fixed high-risk cases. Any single violation fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kb, engine, ask, displayed, L1 } from "./helpers.ts";
import type { FacetName, Profile, SearchResponse } from "../src/engine/types.ts";

const typo = (w: string) => (w.length >= 6 ? w.slice(0, 2) + w[3] + w[2] + w.slice(4) : w); // swap two letters

/** Returns a list of violations for one response. */
function violations(r: SearchResponse, profile: Profile): string[] {
  const out: string[] = [];
  const shown = displayed(r);
  // S-4: only indexed (approved, current) sources
  const indexed = new Set(kb.sources.filter((s) => s.indexed).map((s) => s.id));
  for (const d of shown) if (!indexed.has(d.result.passage.sourceId)) out.push(`S-4 non-authoritative ${d.result.passage.id}`);
  // S-3: open-conflict passages only in the conflict card, never with Strong band
  const fitsStated = (p: (typeof kb.passages)[number]) => (Object.entries(r.resolvedFacets) as [FacetName, string][]).every(([f, v]) => !(p.facets[f]?.length) || p.facets[f]!.includes(v));
  const onTopic = new Set(kb.conflictGroups.filter((g) => g.status === "open" && (g.requires ?? [g.concept]).every((c) => r.concepts.includes(c)) && kb.passages.some((p) => p.conflictGroups.includes(g.id) && fitsStated(p))).map((g) => g.id));
  for (const d of shown) if (d.result.passage.conflictGroups.some((g) => onTopic.has(g)) && d.where !== "conflict") out.push(`S-3 conflict passage ${d.result.passage.id} in ${d.where}`);
  // S-5: conditions shown verbatim (same as source passage)
  for (const d of shown) {
    const src = kb.passages.find((p) => p.id === d.result.passage.id);
    if (!src || JSON.stringify(src.conditions) !== JSON.stringify(d.result.passage.conditions) || src.text !== d.result.passage.text) out.push(`S-5 text/conditions differ ${d.result.passage.id}`);
  }
  // S-7: citation consistent with passage and source hash
  for (const d of shown) {
    const c = d.result.citation; const s = kb.sources.find((x) => x.id === c.sourceId);
    if (!s || s.sha256 !== c.sha256 || c.slide !== d.result.passage.slide || !s.slides.some((sl) => sl.n === c.slide)) out.push(`S-7 citation ${d.result.passage.id}`);
  }
  // S-1 / S-2: rule-facet handling
  const resolved: Partial<Record<FacetName, string>> = { ...r.resolvedFacets };
  for (const d of shown.filter((x) => x.where === "results")) {
    const p = d.result.passage;
    for (const c of p.concepts) for (const f of engine.concepts.get(c)!.ruleFacets) {
      const scope = p.facets[f] ?? [];
      if (!scope.length) continue;
      const v = resolved[f];
      if (!v && (r.concepts.includes(c) || d.result.band === "Strong match")) out.push(`S-1 universalized: ${p.id} (${c} depends on ${f}, unresolved) shown as a flat result`);
      else if (v && !scope.includes(v)) out.push(`S-2 wrong scope: ${p.id} (${f}=${scope}) shown for ${f}=${v}`);
    }
  }
  if (r.outcome === "ANSWER" && r.groups.length) out.push("ANSWER with groups");
  return out;
}

test("invariant sweep over every facet-dependent concept (terms x facet cues x typo)", () => {
  let n = 0; const fails: string[] = [];
  const profiles: Profile[] = [L1, { audience: "SR", season: "OPEN_SEASON" }];
  for (const c of kb.vocab.concepts.filter((x) => x.ruleFacets.length)) {
    for (const f of c.ruleFacets) {
      const values = Object.entries(kb.vocab.facets[f].values);
      const cueSets: string[][] = [[], ...values.map(([, d]) => [d.cues[0]!]), values.length >= 2 ? [values[0]![1].cues[0]!, values[1]![1].cues[0]!] : []];
      for (const term of c.terms.slice(0, 8)) for (const cues of cueSets) for (const variant of [term, term.split(" ").map(typo).join(" ")]) for (const p of profiles) {
        const q = [`caller asking about`, variant, ...cues].join(" ");
        const r = ask(q, p); n++;
        for (const v of violations(r, p)) fails.push(`${v}  <= "${q}" ${JSON.stringify(p)}`);
        // unresolved rule facet with alternatives present must never be a plain ANSWER
        const unresolved = !r.resolvedFacets[f];
        const variesIn = new Set((engine.passagesByConcept.get(c.id) ?? []).flatMap((x) => x.facets[f] ?? [])).size > 1;
        if (r.concepts.includes(c.id) && unresolved && variesIn && r.outcome === "ANSWER" && r.results.some((x) => x.passage.concepts.includes(c.id)))
          fails.push(`S-1 ANSWER for unresolved ${f} on ${c.id}  <= "${q}"`);
      }
    }
  }
  assert.deepEqual(fails, [], `${fails.length} violations / ${n} variants`);
  assert.ok(n > 300, `sweep size ${n}`);
});

test("high-risk fixed cases: the example question shows BOTH affiliation rules and asks which applies", () => {
  for (const q of ["Someone is calling about their 21 year old aging out, but their child is now full time",
    "dependant agin out ful time studnet", "how old can a kid be and still be covered"]) {
    const r = ask(q);
    assert.equal(r.outcome, "CLARIFY", q);
    assert.equal(r.unresolvedFacet, "affiliation", q);
    const groupSources = r.groups.map((g) => [...new Set(g.results.map((x) => x.passage.sourceId))].sort().join(","));
    assert.deepEqual(groupSources.sort(), ["S01", "S02"], q);
    assert.deepEqual(violations(r, L1), [], q);
  }
});

test("contradictory cues never resolve a facet", () => {
  const r = ask("postal worker who is also in the army, kid age limit");
  assert.equal(r.outcome, "CLARIFY");
  assert.ok(r.contradictoryFacets.includes("affiliation"));
  assert.deepEqual(violations(r, L1), []);
});

test("security rules depend on who is calling: unresolved caller => clarify; resolved => that rule only", () => {
  const u = ask("how many security items do I need");
  assert.equal(u.outcome, "CLARIFY"); assert.equal(u.unresolvedFacet, "callerRole");
  const p = ask("how many security items when the enrollee is calling for themselves");
  assert.equal(p.outcome, "ANSWER");
  assert.ok(p.results.every((x) => x.passage.sourceId === "S04"));
  assert.deepEqual(violations(p, L1), []);
});

test("S-6: high-risk-sounding unsupported questions are declined, never answered", () => {
  for (const q of ["can a grandchild stay covered after age 30", "does a stepchild need a court order", "can a third party cancel coverage over email",
    "how many security items for a provider office", "can we backdate a termination 6 months"]) {
    const r = ask(q);
    assert.ok(!r.results.some((x) => x.band === "Strong match"), `${q}: no strong match`);
    assert.deepEqual(violations(r, L1), [], q);
  }
});
