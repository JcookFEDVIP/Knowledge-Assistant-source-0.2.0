// Search pipeline: MiniSearch candidate retrieval (library) + deterministic domain layers (custom):
// facet resolution, transparent reranking, authority-aware conflict handling and the decision layer.
import MiniSearch from "minisearch";
import { analyze, buildCorrector, normalize, type Analysis, type Corrector } from "./analyze.ts";
import { COMMON_WORDS } from "./common-words.ts";
import { quickAnswer } from "./answer.ts";
const COMMON = COMMON_WORDS;
import type { Band, Citation, ConceptDef, FacetName, Group, KnowledgeBase, Passage, Profile, Result, RoleDef, SearchResponse } from "./types.ts";

const SCALE = 1_000_000; // integer-scaled scores => identical ordering in every JS engine

/** Every ranking and decision setting in one place. Change a value here, then run the coverage and golden tests
 *  (npm test); the coverage ratchet catches a setting that makes the library harder to reach. */
export const RANK = {
  /** MiniSearch field boosts and fuzzy matching for long words */
  fieldBoost: { title: 2.5, heading: 2, text: 1, conditions: 1 }, fuzzyMinLength: 6, fuzzy: 0.2,
  /** query-word weights: codes (DV35), everyday words, the agent's own words, expansions/synonyms */
  termBoost: { code: 3, common: 0.2, own: 1, expansion: 0.6 },
  /** score = lexical * w.lexical + topic coverage * w.topic + heading hit * w.heading + bonuses, x rank factors */
  weight: { lexical: 0.55, topic: 0.35, heading: 0.1 },
  bonus: { affiliationRule: 0.15, preferredSource: 0.12, ownRole: 0.05, alias: 0.5, priorityFolder: 0.15 },
  /** question names 2+ topics and some passage covers all of them: score factor for passages covering only some (1 = off) */
  partialTopicFactor: 0.8,
  /** demotion factor for a passage containing a topic's demoteText */
  demoteTextFactor: 0.6,
  /** Strong band: minimum score */
  strong: 0.6,
  /** a word is "distinctive" when used in fewer than this share of passages (partial coverage, word-match lane) */
  distinctiveDf: 0.03, rareDf: 0.01,
  /** conflicts: a member must be in the top N or score at least this share of the top score */
  conflictTopN: 5, conflictShare: 0.8,
  /** clarify: only when the best affiliation-specific rule scores at least this share of the best answer;
   *  skip it when an unscoped answer about something else beats the best scoped rule by this factor */
  clarifyShare: 0.5, clarifySkipFactor: 1.2,
  /** word-match admission lane: minimum lexical score and distinctive words, at most this many passages */
  admitLexical: 0.5, admitDistinct: 2, admitMax: 2,
  /** fallback (no topic): score scale for "Possible match" results */
  fallbackScale: 0.5,
} as const;
// Topic vocabulary is NOT indexed with each passage (it would make every passage of a topic match every topic word);
// topic matching is handled by concept coverage in the reranker instead.
const FIELDS = ["title", "heading", "text", "conditions"] as const;

export interface Engine {
  kb: KnowledgeBase; ms: MiniSearch; aliasIndex: MiniSearch; corrector: Corrector; byId: Map<string, Passage>;
  concepts: Map<string, ConceptDef>; passagesByConcept: Map<string, Passage[]>; processTerm: (t: string) => string | null;
  /** processed corpus words (domain words) and per-passage processed word sets, for partial-coverage checks */
  corpusTerms: Set<string>; passageTerms: Map<string, Set<string>>; cueTerms: Set<string>; termDf: Map<string, number>; nPassages: number;
  /** with roles: the role this engine serves (its passages are that role's folders only), and one engine per role */
  role?: RoleDef; roleEngines?: Map<string, Engine>;
  /** conflictPolicy "newest-revision": open conflict group -> a passage of its most recently revised member (this engine's job aids) */
  conflictWinner: Map<string, Passage>;
}

/** The printed revision date as yyyymmdd ("Revised on 03/09/26", "Reviewed 9.11.2026"); 0 when none is printed. */
export function revisionDate(printed: string): number {
  const m = printed.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/);
  if (!m) return 0;
  const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return y * 10000 + Number(m[1]) * 100 + Number(m[2]);
}

export function createEngine(kb: KnowledgeBase, role?: RoleDef): Engine {
  // Defence in depth: the build only emits indexed sources' passages, but never trust that here.
  const indexed = new Set(kb.sources.filter((s) => s.indexed).map((s) => s.id));
  const passages = kb.passages.filter((p) => indexed.has(p.sourceId) && (!role || (p.folders ?? [""]).some((f) => role.folders.includes(f))));
  if (role) kb = { ...kb, aliases: Object.fromEntries(Object.entries(kb.aliases ?? {}).filter(([t]) => passages.some((p) => p.sourceTitle === t))) };
  const concepts = new Map(kb.vocab.concepts.map((c) => [c.id, c]));
  const stop = new Set(kb.vocab.stopwords);
  const stem = (t: string) => (t.length > 4 && t.endsWith("ies") ? t.slice(0, -3) + "y" : t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);
  const processTerm = (t: string) => { const n = normalize(t); return !n || stop.has(n) ? null : stem(n); };
  const ms = new MiniSearch<Record<string, string>>({
    idField: "id", fields: [...FIELDS], processTerm,
    tokenize: (s) => s.split(/[\s]+/),
    searchOptions: { boost: { ...RANK.fieldBoost }, combineWith: "OR", prefix: false, fuzzy: (term) => (term.length >= RANK.fuzzyMinLength ? RANK.fuzzy : false) },
  });
  ms.addAll(passages.map((p) => ({
    id: p.id, title: normalize(p.sourceTitle), heading: normalize(p.heading), text: normalize(p.text), conditions: normalize(p.conditions.join(" ")),
  })));
  // Search aliases (agent phrasings per job aid) are scored per JOB AID in their own index, so they help pick the right
  // job aid without flattening the ranking of passages inside it.
  const aliasIndex = new MiniSearch<Record<string, string>>({ idField: "id", fields: ["text"], processTerm, tokenize: (s) => s.split(/[\s]+/) });
  aliasIndex.addAll(Object.entries(kb.aliases ?? {}).map(([title, text]) => ({ id: title, text: normalize(text) })));
  const words: string[] = []; const vocabWords: string[] = [];
  for (const p of passages) words.push(...normalize(`${p.sourceTitle} ${p.heading} ${p.text} ${p.conditions.join(" ")}`).split(" "));
  for (const c of kb.vocab.concepts) for (const t of [...c.terms, ...c.expand, c.label]) vocabWords.push(...normalize(t).split(" "));
  const cueWords: string[] = [];
  for (const f of Object.values(kb.vocab.facets)) for (const v of Object.values(f.values)) for (const cue of v.cues) cueWords.push(...normalize(cue).split(" "));
  // Cue words are known (never "corrected") but are not correction targets: "wifi" must not become "wife".
  const corrector = buildCorrector([...words, ...vocabWords, ...cueWords], [...Object.keys(kb.vocab.acronyms), ...Object.keys(kb.vocab.synonyms ?? {}), ...kb.vocab.protected, ...kb.vocab.stopwords], [...vocabWords, ...cueWords]);
  const passagesByConcept = new Map<string, Passage[]>();
  for (const p of passages) for (const c of p.concepts) { const L = passagesByConcept.get(c) ?? []; L.push(p); passagesByConcept.set(c, L); }
  const proc = (text: string) => new Set(normalize(text).split(" ").map((t) => processTerm(t)).filter((t): t is string => !!t));
  const corpusTerms = proc(words.join(" "));
  const passageTerms = new Map(passages.map((p) => [p.id, proc(`${p.sourceTitle} ${p.heading} ${p.text} ${p.conditions.join(" ")} ${p.concepts.flatMap((c) => concepts.get(c)?.terms ?? []).join(" ")}`)]));
  const cueTerms = proc(Object.values(kb.vocab.facets).flatMap((f) => Object.values(f.values).flatMap((v) => v.cues)).join(" "));
  const termDf = new Map<string, number>();
  for (const set of passageTerms.values()) for (const t of set) termDf.set(t, (termDf.get(t) ?? 0) + 1);
  // Owner policy: an open conflict is decided by the most recent printed revision among the job aids this engine has.
  // A dated job aid beats an undated one; no date at all, or a tie for newest, leaves the conflict open (side by side).
  const conflictWinner = new Map<string, Passage>();
  if (kb.conflictPolicy === "newest-revision") for (const g of kb.conflictGroups) {
    if (g.status !== "open" || g.keepSideBySide) continue;
    const members = new Map<string, Passage>();
    for (const p of passages) if (p.conflictGroups.includes(g.id) && !members.has(p.sourceId)) members.set(p.sourceId, p);
    const ranked = [...members.values()].map((p) => ({ p, d: revisionDate(p.printedRevision) })).sort((x, y) => y.d - x.d);
    if (ranked.length >= 2 && ranked[0]!.d > 0 && ranked[0]!.d > ranked[1]!.d) conflictWinner.set(g.id, ranked[0]!.p);
  }
  return { kb, ms, aliasIndex, corrector, byId: new Map(passages.map((p) => [p.id, p])), concepts, passagesByConcept, processTerm, corpusTerms, passageTerms, cueTerms, termDf, nPassages: passages.length,
    role, roleEngines: role ? undefined : new Map(), conflictWinner };
}

/** For test questions: the role to ask as so the expected job aid can be found. The question's own role when it can see one
 *  of the titles, else the first role that can; undefined when no role can (the job aid is not in any role's folders). */
export function roleThatSees(kb: KnowledgeBase, preferred: string, titles: string[]): string | undefined {
  if (!kb.roles?.length) return preferred;
  const sees = (r: RoleDef) => kb.sources.some((s) => s.indexed && titles.includes(s.title) && (s.folders ?? [""]).some((f) => r.folders.includes(f)));
  const own = kb.roles.find((r) => r.id === preferred);
  return own && sees(own) ? own.id : kb.roles.find(sees)?.id;
}

/** The engine for the agent's role: built on first use from that role's folders only, so another role's job aids can
 *  never be retrieved, suggested or pinned. An unknown role gets the first (most limited) role. Without roles: `engine`. */
export function engineFor(engine: Engine, audience: string): Engine {
  const roles = engine.kb.roles;
  if (!roles?.length || engine.role) return engine;
  const role = roles.find((r) => r.id === audience) ?? roles[0]!;
  let e = engine.roleEngines!.get(role.id);
  if (!e) { e = createEngine(engine.kb, role); engine.roleEngines!.set(role.id, e); }
  return e;
}

const facetLabel = (kb: KnowledgeBase, f: FacetName, v: string) => kb.vocab.facets[f]?.values[v]?.label ?? v;
/** A passage fits the stated situation if, for every resolved facet, it is unscoped or includes that value (or a value it implies). */
export function fitsFacets(kb: KnowledgeBase, resolved: Partial<Record<FacetName, string>>, p: Passage): boolean {
  return (Object.entries(resolved) as [FacetName, string][]).every(([f, v]) => {
    const scope = p.facets[f];
    if (!scope || scope.length === 0) return true;
    const ok = [v, ...(kb.vocab.facets[f]?.values[v]?.implies ?? [])];
    return scope.some((s) => ok.includes(s));
  });
}
/** Distinctive words of the question: not common English, not stopwords, rare in the job aids (or typed as a code/name). */
function rareTerms(engine: Engine, a: Analysis): string[] {
  const stop = new Set(engine.kb.vocab.stopwords);
  const typedSpecial = new Set(a.rawWords.filter((w, i) => (i > 0 && /^[A-Z]/.test(w)) || /\d/.test(w) || /^[A-Z]{2,}$/.test(w)).map((w) => normalize(w)));
  const out: string[] = [];
  for (const t of a.tokens) {
    const pt = engine.processTerm(t);
    if (!pt || stop.has(t) || COMMON.has(t) || t.length < 2) continue;
    const df = engine.termDf.get(pt) ?? 0;
    if (!df) continue;
    if (/^\d+$/.test(pt)) continue; // never search on (or echo) bare numbers
    if (df / engine.nPassages < RANK.rareDf || typedSpecial.has(t)) if (!out.includes(pt)) out.push(pt);
  }
  // one rare word only counts if it was typed as a code or a name; ordinary rare words need company
  return out.length >= 2 ? out : out.filter((t) => [...typedSpecial].some((w) => engine.processTerm(w) === t));
}
/** Keep at most `n` passages per job aid so one long table can't crowd out other sources. */
const perSource = (list: Result[], n: number) => { const seen = new Map<string, number>(); return list.filter((r) => { const k = (seen.get(r.passage.sourceId) ?? 0) + 1; seen.set(r.passage.sourceId, k); return k <= n; }); };
function appliesTo(kb: KnowledgeBase, p: Passage): string {
  const parts = (Object.entries(p.facets) as [FacetName, string[]][]).filter(([, vs]) => vs.length).map(([f, vs]) => vs.map((v) => facetLabel(kb, f, v)).join(" / "));
  return parts.length ? parts.join(" · ") : "Situation not limited in the job aid";
}
function citation(kb: KnowledgeBase, p: Passage): Citation {
  return { sourceId: p.sourceId, sourceTitle: p.sourceTitle, printedRevision: p.printedRevision, slide: p.slide, unit: p.unit, sha256: p.sourceSha256, knowledgeVersion: kb.knowledgeVersion };
}
const dated = (p: Passage) => (revisionDate(p.printedRevision) ? p.printedRevision : "no revision date");
const demote = (r: Result): Result => ({ ...r, band: r.band === "Strong match" ? "Related guidance" : r.band });

/** Safety first: when the question is about a threat, self-harm, fraud, a compromised account or a privacy incident, that
 *  procedure is shown first, whatever else the question mentions ("if his coverage gets cancelled he'll hurt somebody").
 *  Topics with risk "HR-SAFETY" carry this rule; the passage comes from the topic's preferred job aid. */
export function search(all: Engine, query: string, profile: Profile): SearchResponse {
  const r = searchSafe(all, query, profile);
  const qa = all.kb.quickAnswers;
  if (qa) r.quickAnswer = quickAnswer(engineFor(all, profile.audience), r, qa);
  return r;
}

function searchSafe(all: Engine, query: string, profile: Profile): SearchResponse {
  const engine = engineFor(all, profile.audience);
  const r = searchCore(engine, query, profile);
  const { kb } = engine;
  const safety = r.concepts.map((c) => engine.concepts.get(c)!).filter((c) => c?.risk === "HR-SAFETY" && (c.prefer?.length ?? 0) > 0);
  if (!safety.length) return r;
  const words = new Set(normalize(query).split(" ").map((t) => engine.processTerm(t)).filter((t): t is string => !!t));
  const firstThree = [...(r.conflict?.results ?? []), ...r.groups.flatMap((g) => g.results), ...r.results].slice(0, 3);
  const shown = new Set(firstThree.map((x) => x.passage.id));
  const pins: Result[] = [];
  for (const c of safety) {
    const pool = (engine.passagesByConcept.get(c.id) ?? []).filter((p) => c.prefer!.includes(p.sourceTitle) && fitsFacets(kb, r.resolvedFacets, p));
    if (!pool.length) continue;
    // a safety procedure already near the top is moved to first place rather than adding another passage
    const near = firstThree.find((x) => c.prefer!.includes(x.passage.sourceTitle));
    if (near) { if (r.results.includes(near) && !pins.some((q) => q.passage.id === near.passage.id)) pins.push({ ...near, band: "Strong match" }); continue; }
    // the section of the procedure that shares the most words with the question (e.g. "Threats to Harm an Individual")
    const overlap = (p: Passage) => [...words].filter((w) => engine.passageTerms.get(p.id)!.has(w)).length;
    const best = [...pool].sort((x, y) => c.prefer!.indexOf(x.sourceTitle) - c.prefer!.indexOf(y.sourceTitle) || overlap(y) - overlap(x) || (x.id < y.id ? -1 : 1))[0]!;
    if (shown.has(best.id) || pins.some((q) => q.passage.id === best.id)) continue;
    const existing = r.results.find((x) => x.passage.id === best.id);
    pins.push({ ...(existing ?? { passage: best, score: SCALE, citation: citation(kb, best), appliesTo: appliesTo(kb, best), numericNotes: [], otherConflicts: [],
      why: { matchedTerms: [], concepts: [c.id], libScore: 0, facetFit: "fits the stated situation" } }), band: "Strong match" });
  }
  if (!pins.length) return r;
  r.results = [...pins, ...r.results.filter((x) => !pins.some((q) => q.passage.id === x.passage.id))];
  r.notes.unshift(`Safety procedure shown first: ${[...new Set(pins.map((x) => x.passage.sourceTitle))].join("; ")}.`);
  if (r.outcome === "NO_ANSWER" || r.outcome === "WEAK") r.outcome = "ANSWER";
  return r;
}

function searchCore(engine: Engine, query: string, profile: Profile): SearchResponse {
  const { kb } = engine;
  const a: Analysis = analyze(query, kb.vocab, engine.corrector);
  const base: SearchResponse = {
    query, normalized: a.corrected, corrections: a.corrections, expansions: a.expansions, concepts: a.concepts,
    resolvedFacets: {}, contradictoryFacets: [], outcome: "NO_ANSWER", notes: [...a.notes], results: [], groups: [], differentSituation: [], suggestions: [],
  };

  // ---- facet resolution: query cues first, then profile defaults (audience, season) ----
  for (const f of Object.keys(kb.vocab.facets) as FacetName[]) {
    if (f === "audience") continue; // the agent's own role comes from the profile, never from words in the question
    const cues = [...new Set(a.facetCues[f] ?? [])];
    if (f === "season" && profile.season && cues.length && !cues.includes(profile.season)) {
      // "open season plan change" asked outside Open Season: the calendar decides which guidance applies
      base.notes.push(`You mentioned ${cues.map((v) => facetLabel(kb, f, v)).join(" / ")}; showing guidance for the current period (${facetLabel(kb, f, profile.season)}). Change the season setting if that's wrong.`);
      continue;
    }
    if (cues.length === 1) base.resolvedFacets[f] = cues[0];
    else if (cues.length > 1) {
      base.contradictoryFacets.push(f);
      base.notes.push(`Your question mentions more than one ${kb.vocab.facets[f].label.toLowerCase()} (${cues.map((v) => facetLabel(kb, f, v)).join(" and ")}). Both are shown; confirm which applies.`);
    }
  }
  if (!base.resolvedFacets.audience && !base.contradictoryFacets.includes("audience") && profile.audience) base.resolvedFacets.audience = profile.audience;
  if (!base.resolvedFacets.season && !base.contradictoryFacets.includes("season") && profile.season) base.resolvedFacets.season = profile.season;
  // ambiguity notes that no longer apply once the situation is known (e.g. "retired" when the affiliation is stated)
  for (const amb of kb.vocab.ambiguityCues) if (amb.suppressIfResolved && base.resolvedFacets[amb.suppressIfResolved] && a.ambiguityIds.includes(amb.id)) base.notes = base.notes.filter((n) => n !== amb.note);

  // ---- A5 gate: no recognized in-scope concept, or no indexed passage for any recognized concept => no answer ----
  const covered = a.concepts.filter((c) => (engine.passagesByConcept.get(c) ?? []).length > 0);
  if (!covered.length) {
    // Rare-term fallback: no topic matched, but the question uses distinctive words that appear in the job aids
    // (codes like "DV35", names like "Tennessee Valley Authority"). Shown as WEAK only, never as Strong.
    // All-words fallback: every distinctive word of the question appears in the job aids (none is unknown, like "pizza"),
    // and one passage contains all of them. Shown as WEAK, never as Strong.
    const stopW = new Set(kb.vocab.stopwords);
    const words = [...new Set(a.tokens.filter((t) => t.length >= 3 && !COMMON.has(t) && !stopW.has(t) && !/^\d+$/.test(t)).map((t) => engine.processTerm(t)).filter((t): t is string => !!t))];
    // Most-words variant: at least 2 and 60% of the question's distinctive words in one passage (an unknown word like
    // "pizza" still blocks it), so plain-language questions that miss every topic still find the passage that fits.
    const known = words.filter((t) => (engine.termDf.get(t) ?? 0) > 0);
    if (words.length >= 2 && known.length === words.length) {
      const need = Math.max(2, Math.ceil(0.6 * words.length));
      const hits = engine.ms.search(words.join(" "), { combineWith: "OR", fuzzy: false, prefix: false }).filter((h) => h.terms.length >= need).slice(0, 3);
      const max = hits[0]?.score ?? 1;
      base.results = hits.map((h) => {
        const p = engine.byId.get(String(h.id))!;
        return { passage: p, band: "Possible match" as Band, score: Math.round((h.score / max) * RANK.fallbackScale * SCALE), citation: citation(kb, p), appliesTo: appliesTo(kb, p), numericNotes: [], otherConflicts: [],
          why: { matchedTerms: h.terms, concepts: [], libScore: Math.round((h.score / max) * 1000) / 1000, facetFit: "" } };
      }).filter((r) => fitsFacets(kb, base.resolvedFacets, r.passage) && !(Object.keys(r.passage.facets) as FacetName[]).some((ff) => (r.passage.facets[ff]?.length ?? 0) > 0 && !base.resolvedFacets[ff] && ff === "affiliation"));
      if (base.results.length) {
        base.outcome = "WEAK";
        base.notes.push(`No topic matched. Showing job-aid passages that contain all of: ${words.join(", ")}. Check them carefully.`);
        return base;
      }
    }
    const rare = rareTerms(engine, a);
    if (rare.length) {
      const hits = engine.ms.search(rare.join(" "), { combineWith: "OR", fuzzy: false, prefix: false });
      const need = rare.length >= 2 ? 2 : 1;
      const keep = hits.filter((h) => h.terms.length >= need).slice(0, 6);
      if (keep.length) {
        const max = keep[0]!.score;
        base.results = keep.map((h) => {
          const p = engine.byId.get(String(h.id))!;
          return { passage: p, band: "Possible match" as Band, score: Math.round((h.score / max) * RANK.fallbackScale * SCALE), citation: citation(kb, p), appliesTo: appliesTo(kb, p), numericNotes: [], otherConflicts: [],
            why: { matchedTerms: h.terms, concepts: [], libScore: Math.round((h.score / max) * 1000) / 1000, facetFit: "" } };
        }).filter((r) => fitsFacets(kb, base.resolvedFacets, r.passage));
        if (base.results.length) {
          base.outcome = "WEAK";
          base.notes.push(`No topic matched. Showing job-aid passages that contain: ${rare.join(", ")}. Check them carefully.`);
          return base;
        }
      }
    }
    base.outcome = "NO_ANSWER";
    if (a.tokens.length <= 2) base.notes.push("Add a few words about what the caller needs (for example: \"cancel dental\", \"add a newborn\", \"POA fax number\").");
    base.suggestions = kb.vocab.concepts.filter((c) => !c.autoTitle && (engine.passagesByConcept.get(c.id) ?? []).length > 0).map((c) => c.label);
    return base;
  }

  // ---- candidate retrieval (MiniSearch) + concept-guaranteed candidates ----
  const expandTerms = new Set<string>();
  for (const c of covered) for (const t of engine.concepts.get(c)!.expand) { const pt = engine.processTerm(t); if (pt) expandTerms.add(pt); }
  const qText = [...a.contentTokens, ...expandTerms].join(" ");
  // Specific words drive retrieval; everyday words ("new", "long", "add") count for little; expansions/synonyms count less than the user's own words.
  const own = new Set(a.tokens.map((t) => engine.processTerm(t)));
  const isCode = (t: string) => /^[a-z]{1,4}\d{1,4}$/.test(t);
  const hits = engine.ms.search(qText, { boostTerm: (term: string) => (isCode(term) ? RANK.termBoost.code : COMMON.has(term) ? RANK.termBoost.common : own.has(term) ? RANK.termBoost.own : RANK.termBoost.expansion) });
  const lib = new Map<string, { score: number; terms: string[] }>(hits.map((h) => [String(h.id), { score: h.score, terms: h.terms }]));
  const aliasHits = engine.aliasIndex.search(a.tokens.join(" "), { boostTerm: (term: string) => (COMMON.has(term) ? RANK.termBoost.common : 1) });
  const aliasMax = Math.max(1e-9, ...aliasHits.map((h) => h.score));
  const aliasNorm = new Map(aliasHits.map((h) => [String(h.id), h.score / aliasMax]));
  const maxLib = Math.max(1e-9, ...hits.map((h) => h.score));
  const candidates = new Set<string>([...lib.keys()]);
  for (const c of covered) for (const p of engine.passagesByConcept.get(c)!) candidates.add(p.id);
  // job aids whose agent phrasings match the question strongly are candidates too, even with no topic or word match
  const aliasTop = new Set(aliasHits.filter((h) => h.score >= 0.5 * aliasMax).slice(0, 3).map((h) => String(h.id)));
  for (const p of engine.byId.values()) if (aliasTop.has(p.sourceTitle)) candidates.add(p.id);

  // ---- transparent reranking ----
  const qTokens = new Set(a.contentTokens.map((t) => engine.processTerm(t)).filter((t): t is string => !!t));
  const demoteTexts = covered.flatMap((c) => engine.concepts.get(c)!.demoteText ?? []).map((t) => t.toLowerCase());
  const topicalPrefer = new Set(covered.flatMap((c) => engine.concepts.get(c)!.prefer ?? []));
  const specific = covered.filter((c) => !engine.concepts.get(c)!.generic && !a.weakTitles.includes(c));
  const focus = specific.length ? specific : covered; // broad topics ("enroll") only count when nothing more specific was asked
  const topical = covered.filter((c) => !c.startsWith("TITLE:"));
  const scored: Result[] = [];
  for (const id of candidates) {
    const p = engine.byId.get(id)!;
    const l = lib.get(id);
    const libNorm = l ? l.score / maxLib : 0;
    const conceptCov = focus.filter((c) => p.concepts.includes(c)).length / focus.length;
    const headTokens = new Set(normalize(`${p.sourceTitle} ${p.heading}`).split(" ").map((t) => engine.processTerm(t)));
    const headHit = [...qTokens].some((t) => headTokens.has(t)) ? 1 : 0;
    // when the affiliation is stated, a rule written for that affiliation beats one that doesn't say
    const affBonus = base.resolvedFacets.affiliation && (p.facets.affiliation?.length ?? 0) > 0 && fitsFacets(kb, { affiliation: base.resolvedFacets.affiliation }, p)
      && p.concepts.some((c) => covered.includes(c) && engine.concepts.get(c)!.ruleFacets.includes("affiliation")) ? RANK.bonus.affiliationRule : 0;
    const preferBonus = topicalPrefer.has(p.sourceTitle) ? RANK.bonus.preferredSource : 0;
    const factor = (p.rankFactor && !(p.rankUnless ?? []).some((w) => a.tokens.includes(w)) ? p.rankFactor : 1) * (demoteTexts.some((t) => p.text.toLowerCase().includes(t)) ? RANK.demoteTextFactor : 1);
    const aliasBonus = RANK.bonus.alias * (aliasNorm.get(p.sourceTitle) ?? 0);
    const roleBonus = profile.audience && (p.facets.audience ?? []).includes(profile.audience) ? RANK.bonus.ownRole : 0;
    // the role's priority folder (Senior Rep job aids for a senior rep) ranks ahead of its shared folders
    const priorityBonus = engine.role?.priority && p.folders?.includes(engine.role.priority) ? RANK.bonus.priorityFolder : 0;
    const score = Math.round((RANK.weight.lexical * libNorm + RANK.weight.topic * conceptCov + RANK.weight.heading * headHit + affBonus + preferBonus + roleBonus + priorityBonus + aliasBonus) * factor * SCALE);
    const numericNotes = a.ages.length ? p.numeric.filter((n) => n.subject === "age").map((n) => `Question mentions age ${a.ages.join(", ")}. Source states: ${n.text}.`) : [];
    // concepts may include "ALIAS": the job aid matches agent phrasings (admits it to results; never Strong on its own)
    scored.push({
      passage: p, band: "Possible match", score, citation: citation(kb, p), appliesTo: appliesTo(kb, p), numericNotes, otherConflicts: [],
      why: { matchedTerms: l?.terms ?? [], concepts: [...p.concepts.filter((c) => covered.includes(c)), ...(aliasTop.has(p.sourceTitle) ? ["ALIAS"] : [])], libScore: Math.round(libNorm * 1000) / 1000, facetFit: "" },
    });
  }
  // all topics first: when the question names two or more topics ("sponsor wants to cancel") and some job aid covers them
  // all, passages of job aids covering only some ("cancel" in an ABW payment job aid) rank below it. A topic counts when
  // any passage of the job aid has it; topics that only describe the caller (widow, retiree) are not required.
  const named = focus.filter((c) => !c.startsWith("TITLE:") && !engine.concepts.get(c)!.describesCaller);
  if (named.length >= 2 && RANK.partialTopicFactor < 1) {
    const inSource = new Map<string, Set<string>>();
    for (const p of engine.byId.values()) { const s = inSource.get(p.sourceId) ?? new Set<string>(); p.concepts.forEach((c) => s.add(c)); inSource.set(p.sourceId, s); }
    const coversAll = (r: Result) => named.every((c) => inSource.get(r.passage.sourceId)!.has(c));
    if (scored.some(coversAll)) for (const r of scored) if (!coversAll(r)) r.score = Math.round(r.score * RANK.partialTopicFactor);
  }
  scored.sort((x, y) => y.score - x.score || (x.passage.id < y.passage.id ? -1 : 1));
  const bestOf = (c: string) => Math.max(0, ...scored.filter((r) => r.passage.concepts.includes(c)).map((r) => r.score));
  const primary = [...covered].sort((x, y) => bestOf(y) - bestOf(x) || covered.indexOf(x) - covered.indexOf(y))[0]!;

  // ---- facet fit and bands ----
  const fits = (p: Passage) => fitsFacets(kb, base.resolvedFacets, p);
  for (const r of scored) r.why.facetFit = fits(r.passage) ? "fits the stated situation" : "different situation";
  const strongConcepts = new Set([primary, ...topical].filter((c) => !a.weakTitles.includes(c))); // one title word alone never makes a Strong answer
  const ownProcessed = new Set(a.tokens.map((t) => engine.processTerm(t)).filter((t): t is string => !!t));
  const overlaps = (r: Result) => r.why.matchedTerms.some((t) => ownProcessed.has(t)) || [...ownProcessed].some((t) => engine.passageTerms.get(r.passage.id)!.has(t) && !engine.cueTerms.has(t));
  const band = (r: Result): Band => (r.passage.concepts.some((c) => strongConcepts.has(c)) && r.score >= RANK.strong * SCALE && overlaps(r) ? "Strong match" : r.why.concepts.length ? "Related guidance" : "Possible match");
  for (const r of scored) r.band = band(r);

  // ---- partial coverage: domain words in the question that the passage never mentions => not a Strong match ----
  const conceptWords = new Set(covered.flatMap((c) => engine.concepts.get(c)!.terms.flatMap((t) => normalize(t).split(" ").map((x) => engine.processTerm(x) ?? ""))));
  const ownTokens = new Set(a.tokens.map((t) => engine.processTerm(t)).filter((t): t is string => !!t)); // user words only, not expansions
  const ignore = new Set([...kb.vocab.protected, ...kb.vocab.stopwords].map((w) => engine.processTerm(w) ?? w));
  // Words the question uses that the passage doesn't: corpus words the passage lacks, plus words no job aid uses at all
  // (e.g. "wifi"), which mean the job aids may not cover the question. Common English words are ignored.
  // Only distinctive words count: absent from all job aids, or used in under 3% of passages. Frequent job-aid verbs ("add") do not.
  const distinctive = (t: string) => (engine.termDf.get(t) ?? 0) / engine.nPassages < RANK.distinctiveDf;
  const domainQ = [...ownTokens].filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !engine.cueTerms.has(t) && !conceptWords.has(t) && !ignore.has(t) && !COMMON.has(t) && distinctive(t));
  const uncoveredBy = (r: Result) => domainQ.filter((t) => !engine.passageTerms.get(r.passage.id)!.has(t));
  // Safety procedures (threats, self-harm) stay Strong: extra details in the question ("the building") don't make them less applicable.
  const safety = (r: Result) => r.passage.concepts.some((c) => covered.includes(c) && engine.concepts.get(c)!.risk === "HR-SAFETY");
  for (const r of scored) if (r.band === "Strong match" && uncoveredBy(r).length && !safety(r)) r.band = "Related guidance";
  const coverageNote = (first: Result | undefined) => {
    const miss = first ? uncoveredBy(first) : [];
    if (miss.length) base.notes.push(`The top job-aid passage doesn't mention: ${miss.join(", ")}. It may not fully answer the question.`);
  };

  // ---- A1: open conflicts about a recognized topic => show both sides, resolve nothing ----
  const openGroups = new Map(kb.conflictGroups.filter((g) => g.status === "open").map((g) => [g.id, g]));
  // A conflict is on-topic only when the question covers every topic it requires AND a member applies to the agent's situation.
  const satisfied = (entry: string) => entry.split("|").some((alt) => {
    if (alt.startsWith("@")) { const [f, v] = alt.slice(1).split("="); return base.resolvedFacets[f as FacetName] === v; }
    return a.concepts.includes(alt);
  });
  const fittingSources = (gid: string) => new Set(scored.filter((r) => r.passage.conflictGroups.includes(gid) && fits(r.passage)).map((r) => r.passage.sourceId));
  const topFits = scored.filter((r) => fits(r.passage));
  const competitive = (gid: string) => topFits.slice(0, RANK.conflictTopN).some((r) => r.passage.conflictGroups.includes(gid))
    || topFits.some((r) => r.passage.conflictGroups.includes(gid) && r.score >= RANK.conflictShare * (topFits[0]?.score ?? 0));
  const onTopic = new Set([...openGroups.values()].filter((g) => (g.requires ?? [g.concept]).every(satisfied) && fittingSources(g.id).size >= 2 && competitive(g.id)).map((g) => g.id));
  // Conflicts decided by revision date: the newest job aid is answered normally; older members' passages on this point
  // are left out, and a note names what was left out (never silent). Undecided conflicts stay side by side.
  const relevant = new Set([...onTopic].filter((g) => !engine.conflictWinner.has(g)));
  const winnerOf = (g: string) => engine.conflictWinner.get(g);
  // a decided conflict counts whenever the question is about its topic, also in "different situation" results
  const decided = new Set([...openGroups.values()].filter((g) => winnerOf(g.id) && (g.requires ?? [g.concept]).every(satisfied)).map((g) => g.id));
  const older = (r: Result) => r.passage.conflictGroups.some((g) => decided.has(g) && winnerOf(g)!.sourceId !== r.passage.sourceId);
  for (const g of decided) {
    const w = winnerOf(g)!;
    if (!scored.some((r) => r.passage.conflictGroups.includes(g) && r.passage.sourceId !== w.sourceId)) continue;
    const left = [...new Set(scored.filter((r) => r.passage.conflictGroups.includes(g) && r.passage.sourceId !== w.sourceId).map((r) => `${r.passage.sourceTitle} (${dated(r.passage)})`))];
    base.notes.push(`Job aids differ on this point. Showing the most recently revised: ${w.sourceTitle} (${dated(w)}). Older wording on this point is left out from: ${left.join("; ")}.`);
  }
  { const kept = scored.filter((r) => !older(r)); scored.length = 0; scored.push(...kept); }
  for (const r of scored) r.otherConflicts = r.passage.conflictGroups.filter((g) => openGroups.has(g) && !onTopic.has(g) && !decided.has(g)).flatMap((g) => {
    const w = winnerOf(g);
    if (!w) return [`Also part of an open conflict on another topic: ${openGroups.get(g)!.note}`];
    return w.sourceId === r.passage.sourceId ? [] : [`A more recently revised job aid differs on this: ${w.sourceTitle} (${dated(w)}).`];
  });
  const inRelevantConflict = (r: Result) => r.passage.conflictGroups.some((g) => relevant.has(g));
  const nonConflict = scored.filter((r) => !inRelevantConflict(r)); // S-3: members of an on-topic open conflict appear only in its card
  const conflictHit = scored.find(inRelevantConflict);
  if (conflictHit) {
    const gid = conflictHit.passage.conflictGroups.find((g) => relevant.has(g))!;
    const g = openGroups.get(gid)!;
    base.outcome = "CONFLICT";
    base.conflict = { groupId: g.id, note: g.note, results: scored.filter((r) => r.passage.conflictGroups.includes(g.id) && fits(r.passage)).map((r) => ({ ...r, band: "Possible match" as Band })) };
    if (relevant.size > 1) base.notes.push("Other open conflicts also touch this question; their passages are withheld from the list below until the content owner decides.");
  }

  // ---- A4: the question is about a topic whose rule depends on an unresolved facet => clarify; group every alternative ----
  const relevantPool = nonConflict.filter((r) => fits(r.passage) && r.why.concepts.length);
  const facetOrder = Object.keys(kb.vocab.facets) as FacetName[];
  const ruleTopics = (ff: FacetName) => covered.filter((c) => engine.concepts.get(c)!.ruleFacets.includes(ff));
  const carriesRule = (r: Result, ff: FacetName) => r.passage.concepts.some((c) => ruleTopics(ff).includes(c));
  const needsClarify = (ff: FacetName) => {
    if (base.resolvedFacets[ff] || !ruleTopics(ff).length) return false;
    const scopedBest = relevantPool.find((r) => carriesRule(r, ff) && (r.passage.facets[ff]?.length ?? 0) > 0);
    if (!scopedBest) return false;
    if (scopedBest.score < RANK.clarifyShare * relevantPool[0]!.score && !base.contradictoryFacets.includes(ff)) { withheld.push(ff); return false; }
    const best = relevantPool[0]!;
    // The best match is about something else (no rule topic, no scope) and clearly stronger: the facet doesn't decide this
    // question. Answer it; the scoped rules are withheld from the flat list (S-1) and the agent is told to confirm.
    // Someone eligible under two affiliations asking how to enroll: the Dual Eligibility guidance is the answer. Questions
    // about dependent rules (age limit, students, ISS, divorce, survivors) still need the affiliation and keep clarifying.
    const enrolleeOnly = ruleTopics(ff).every((c) => ["TRANSITION_RETIREMENT", "PRIMARY_ELIGIBILITY", "ANNUITY"].includes(c));
    if (ff === "affiliation" && covered.includes("DUAL_ELIGIBILITY") && enrolleeOnly) { withheld.push(ff); return false; }
    // The only rule topics describe WHO the caller is (retiree, annuitant, survivor) and the question is about something
    // else they want to do ("retiree wants to drop his vision plan"): answer that; the person's rules are withheld.
    const others = specific.filter((c) => !c.startsWith("TITLE:") && !ruleTopics(ff).includes(c) && engine.concepts.get(c)!.ruleFacets.length === 0);
    if (!base.contradictoryFacets.includes(ff) && others.length && ruleTopics(ff).every((c) => engine.concepts.get(c)!.describesCaller)) { withheld.push(ff); return false; }
    if (!base.contradictoryFacets.includes(ff) && !carriesRule(best, ff) && !(best.passage.facets[ff]?.length) && best.score >= RANK.clarifySkipFactor * scopedBest.score) {
      withheld.push(ff); return false;
    }
    return true;
  };
  const withheld: FacetName[] = [];
  const f = facetOrder.find(needsClarify);
  const withheldRule = (r: Result) => withheld.some((ff) => carriesRule(r, ff) && (r.passage.facets[ff]?.length ?? 0) > 0);
  const scopedUnresolved = (r: Result) => (Object.keys(r.passage.facets) as FacetName[]).some((ff) => (r.passage.facets[ff]?.length ?? 0) > 0 && !base.resolvedFacets[ff] && (carriesRule(r, ff) || kb.vocab.concepts.some((c) => c.ruleFacets.includes(ff))));
  if (f) {
    const pool = relevantPool.filter((r) => carriesRule(r, f));
    const scoped = pool.filter((r) => (r.passage.facets[f]?.length ?? 0) > 0);
    if (base.outcome !== "CONFLICT") base.outcome = "CLARIFY";
    base.unresolvedFacet = f;
    // Group by facet value; scopes that overlap (e.g. "Federal Civilian" and "Federal Civilian / USPS") share one group.
    const clusters: { values: Set<string>; results: Result[] }[] = [];
    for (const r of scoped) {
      const vs = r.passage.facets[f]!;
      let hit = clusters.find((cl) => vs.some((v) => cl.values.has(v)));
      if (!hit) { hit = { values: new Set(), results: [] }; clusters.push(hit); }
      vs.forEach((v) => hit!.values.add(v));
      hit.results.push(demote(r)); // no single rule is "the" answer while the situation is unknown
    }
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      if ([...clusters[j]!.values].some((v) => clusters[i]!.values.has(v))) { clusters[j]!.values.forEach((v) => clusters[i]!.values.add(v)); clusters[i]!.results.push(...clusters[j]!.results); clusters.splice(j, 1); j = i; }
    }
    const order = Object.keys(kb.vocab.facets[f].values);
    const groups: Group[] = clusters.map((cl) => {
      const vals = [...cl.values].sort((x, y) => order.indexOf(x) - order.indexOf(y));
      return { facet: f, value: vals.join("+"), label: `Applies to: ${vals.map((v) => facetLabel(kb, f, v)).join(" / ")}`, results: cl.results.sort((x, y) => y.score - x.score || (x.passage.id < y.passage.id ? -1 : 1)).slice(0, 3) };
    }).sort((x, y) => order.indexOf(x.value!.split("+")[0]!) - order.indexOf(y.value!.split("+")[0]!));
    const unscoped = pool.filter((r) => !(r.passage.facets[f]?.length));
    if (unscoped.length) groups.push({ facet: f, value: "UNSPECIFIED", label: `Job aid doesn't say which ${kb.vocab.facets[f].label.toLowerCase()} it applies to`, results: unscoped.slice(0, 3).map(demote) });
    base.groups = groups;
    const scopedValues = new Set(scoped.flatMap((r) => r.passage.facets[f]!));
    base.notes.unshift(scopedValues.size > 1
      ? `The rule depends on ${kb.vocab.facets[f].label.toLowerCase()}, and your question doesn't say which applies. Confirm with the caller.`
      : `Only ${[...scopedValues].map((v) => facetLabel(kb, f, v)).join(" / ")} guidance was found for this, and your question doesn't say the ${kb.vocab.facets[f].label.toLowerCase()}. Confirm it before using this rule.`);
    const inGroups = new Set(base.groups.flatMap((g) => g.results.map((r) => r.passage.id)));
    base.results = relevantPool.filter((r) => !inGroups.has(r.passage.id) && !carriesRule(r, f)).slice(0, 3).map(demote);
    return base;
  }
  if (base.outcome === "CONFLICT") {
    base.results = perSource(relevantPool.filter((r) => !withheldRule(r) && !(scopedUnresolved(r) && covered.some((c) => r.passage.concepts.includes(c) && engine.concepts.get(c)!.ruleFacets.length))), 2).slice(0, 5).map((r) => demote(r));
    return base;
  }

  // ---- answer / weak ----
  const unresolvedRuleTopic = covered.some((c) => engine.concepts.get(c)!.ruleFacets.some((rf) => !base.resolvedFacets[rf]));
  if (unresolvedRuleTopic) base.notes.push("These job aids don't say which affiliation they apply to, and rules can differ by affiliation. Confirm before answering.");
  const rankBand = (b: Band) => (b === "Strong match" ? 0 : b === "Related guidance" ? 1 : 2);
  if (withheld.length) base.notes = base.notes.filter((n) => !n.includes("Both are shown"));
  if (withheld.length) base.notes.push(`Rules that differ by ${withheld.map((ff) => kb.vocab.facets[ff].label.toLowerCase()).join(" and ")} are not listed. Add the caller's ${withheld.map((ff) => kb.vocab.facets[ff].label.toLowerCase()).join(" and ")} to see them.`);
  // Word-match admission lane: a passage with no recognized topic, but a strong match on two or more distinctive
  // words of the question (used in < 3% of passages), is shown too, at most as Related guidance.
  const distinctiveHits = (r: Result) => r.why.matchedTerms.filter((t) => ownProcessed.has(t) && !COMMON.has(t) && (engine.termDf.get(t) ?? 0) / engine.nPassages < RANK.distinctiveDf).length;
  const admitted = nonConflict.filter((r) => !r.why.concepts.length && fits(r.passage) && !scopedUnresolved(r) && r.why.libScore >= RANK.admitLexical && distinctiveHits(r) >= RANK.admitDistinct)
    .slice(0, RANK.admitMax).map((r) => ({ ...r, band: "Related guidance" as Band }));
  base.results = perSource([...nonConflict.filter((r) => fits(r.passage) && r.why.concepts.length && !withheldRule(r)), ...admitted].sort((x, y) => y.score - x.score), 2).slice(0, 8).map((r) => (scopedUnresolved(r) ? demote(r) : r))
    .sort((x, y) => rankBand(x.band) - rankBand(y.band) || y.score - x.score || (x.passage.id < y.passage.id ? -1 : 1));
  const limited = [...new Set(base.results.filter(scopedUnresolved).map((r) => r.appliesTo))];
  if (limited.length) base.notes.push(`Some results apply only to: ${limited.join("; ")}. Check the caller's situation before using them.`);
  base.differentSituation = nonConflict.filter((r) => !fits(r.passage) && r.why.concepts.length).slice(0, 4);
  base.outcome = base.results.some((r) => r.band === "Strong match") ? "ANSWER" : base.results.length ? "WEAK" : "NO_ANSWER";
  coverageNote(base.results[0]);
  if (base.outcome === "NO_ANSWER") base.suggestions = covered.filter((c) => !c.startsWith("TITLE:")).map((c) => engine.concepts.get(c)!.label);
  return base;
}
