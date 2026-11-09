import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildKnowledge } from "../src/build/knowledge.ts";
import { createEngine, search } from "../src/engine/search.ts";
import type { CorpusInput, Profile, SearchResponse, VocabInput, Result } from "../src/engine/types.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export function loadInputs(): { corpus: CorpusInput; vocab: VocabInput } {
  const dir = join(ROOT, "content", "synthetic");
  return {
    corpus: JSON.parse(readFileSync(join(dir, "corpus.json"), "utf8")),
    vocab: JSON.parse(readFileSync(join(dir, "vocab.json"), "utf8")),
  };
}
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const inputs = loadInputs();
export const kb = buildKnowledge(clone(inputs.corpus), clone(inputs.vocab));
export const engine = createEngine(kb);
export const L1: Profile = { audience: "L1", season: "STEADY_STATE" };
export const ask = (q: string, p: Profile = L1): SearchResponse => search(engine, q, p);

/** Every passage the UI would display for a response, with where it is displayed. */
export function displayed(r: SearchResponse): { where: string; result: Result }[] {
  return [
    ...r.results.map((result) => ({ where: "results", result })),
    ...r.groups.flatMap((g) => g.results.map((result) => ({ where: `group:${g.value}`, result }))),
    ...(r.conflict?.results ?? []).map((result) => ({ where: "conflict", result })),
    ...r.differentSituation.map((result) => ({ where: "different", result })),
  ];
}
export const sourcesOf = (list: Result[]) => [...new Set(list.map((x) => x.passage.sourceId))];
