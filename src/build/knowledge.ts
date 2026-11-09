// Build-time (Node) only: validate the corpus against the source-authority rules and produce the
// KnowledgeBase the engine consumes. Hard violations throw, so nothing unvalidated is ever indexed.
import { createHash } from "node:crypto";
import { normalize, textHasPhrase } from "../engine/analyze.ts";
import { COMMON_WORDS, DO_NOT_CORRECT } from "../engine/common-words.ts";
import type { ConceptDef, CorpusInput, FacetMap, FacetName, KnowledgeBase, Passage, SourceRecord, VocabInput, SourceInput } from "../engine/types.ts";

export class ValidationError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) { super(`Knowledge validation failed:\n- ${problems.join("\n- ")}`); this.problems = problems; }
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
/** Canonical content of a source: what its hash and every citation are bound to. */
export const canonicalSource = (s: SourceInput) => JSON.stringify({ id: s.id, title: s.title, printedRevision: s.printedRevision, slides: s.slides });

const CONDITION_RX = /\b(NOTE|EXCEPTION|ONLY|UNLESS|DO NOT|DON'T|MUST NOT|IF|IMPORTANT|REMINDER|NEVER|CAUTION|WARNING)\b/i;
const overlaps = (a: string[] | undefined, b: string[] | undefined) => !a || !b || a.length === 0 || b.length === 0 || a.some((x) => b.includes(x));
const phraseIn = (hay: string, phrase: string) => {
  const p = normalize(phrase);
  if (!p) return false;
  return p.endsWith("*") ? ` ${hay}`.includes(` ${p.slice(0, -1)}`) : ` ${hay} `.includes(` ${p} `);
};

/** Creates one concept per source title (when enabled) so agents can find a job aid by (part of) its name. */
const sing = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
// Title words that describe an activity, not a topic: one of them alone never identifies a job aid ("Handling...", "Processing...").
const TITLE_VERBS = new Set(["placing", "handling", "processing", "speaking", "checking", "starting", "ending", "understanding", "locating",
  "determining", "reporting", "receiving", "editing", "cancelling", "canceling", "making", "creating", "using", "accessing", "viewing",
  "generating", "updating", "searching", "saving", "working", "advising", "approving", "denying", "submitting", "requesting", "managing",
  "resetting", "installing", "logging", "listening", "retrieving", "troubleshooting", "navigating", "customizing", "linking", "unlocking", "changing"]);
const TITLE_STOP = /^(and|the|for|with|from|vs|of|in|to|on|or|an|a|their|your|own|how|what|when|who|can|cannot|do|during|after|post|not|is)$/;

/** Creates one concept per source title (when enabled) so agents can find a job aid by (part of) its name.
 *  titleWords: the title's content words (most of them typed => the title matches). titleKeys: words that identify this
 *  job aid on their own: used by no other title, rare in the job-aid text (< 2% of passages), not ordinary English,
 *  not an activity word, and not already a curated topic term (the topic handles those). */
function titleConcepts(sources: SourceInput[], curatedTerms: Set<string>): ConceptDef[] {
  const titleDf = new Map<string, number>();
  for (const s of sources) for (const w of new Set(normalize(s.title).split(" ").map(sing))) titleDf.set(w, (titleDf.get(w) ?? 0) + 1);
  const unitDf = new Map<string, number>(); let nUnits = 0;
  for (const s of sources) for (const sl of s.slides) for (const u of sl.units) {
    nUnits++;
    for (const w of new Set(normalize(u.text).split(" ").map(sing))) unitDf.set(w, (unitDf.get(w) ?? 0) + 1);
  }
  return sources.map((s) => {
    const full = normalize(s.title);
    const bare = normalize(s.title.replace(/\([^)]*\)/g, " ").replace(/\b(job aid|l1|l2)\b/gi, " "));
    const terms = [...new Set([full, bare].filter((t) => t.split(" ").length >= 1 && t.length >= 4))];
    const titleWords = [...new Set(bare.split(" ").filter((w) => w.length >= 3 && !TITLE_STOP.test(w)))];
    const acronyms = new Set((s.title.match(/\b[A-Z]{3,}\b/g) ?? []).map((x) => x.toLowerCase()));
    const titleKeys = titleWords.filter((w) => !/^\d+$/.test(w) && (titleDf.get(sing(w)) ?? 0) === 1 && (acronyms.has(w)
      || (w.length >= 4 && !COMMON_WORDS.has(w) && !COMMON_WORDS.has(sing(w)) && !DO_NOT_CORRECT.has(w) && !DO_NOT_CORRECT.has(sing(w))
        && !TITLE_VERBS.has(w) && !curatedTerms.has(w) && !curatedTerms.has(sing(w)) && (unitDf.get(sing(w)) ?? 0) / Math.max(1, nUnits) < 0.02)));
    return { id: `TITLE:${s.id}`, label: s.title, ruleFacets: [], risk: "standard", terms, expand: [], autoTitle: true, titleWords, titleKeys };
  });
}

export function buildKnowledge(corpus: CorpusInput, vocabIn: VocabInput, opts: { imageExt?: string } = {}): KnowledgeBase {
  const imageExt = opts.imageExt ?? ".svg";
  const problems: string[] = [];
  const warnings: string[] = [];
  const vocab: VocabInput = { ...vocabIn, concepts: [...vocabIn.concepts] };
  if (vocab.autoTitleConcepts) {
    // single-word curated topic terms: a title word that is already a topic term is handled by that topic
    const curated = new Set(vocab.concepts.flatMap((c) => c.terms).map((t) => normalize(t)).filter((t) => t && !t.includes(" ")));
    vocab.concepts.push(...titleConcepts(corpus.sources, curated));
  }
  const ids = new Set<string>();
  const owners = new Set(corpus.owners.map((o) => o.id));
  const conceptIds = new Set(vocab.concepts.map((c) => c.id));
  const byId = new Map(corpus.sources.map((s) => [s.id, s]));
  const byTitle = new Map(corpus.sources.map((s) => [s.title, s]));
  const groups = new Map(corpus.conflictGroups.map((g) => [g.id, g]));
  const advisories = new Map((corpus.advisories ?? []).map((a) => [a.source, a.note]));
  for (const a of corpus.advisories ?? []) if (!byTitle.has(a.source)) problems.push(`advisory refers to unknown source "${a.source}"`);
  const autoConcepts = vocab.concepts.filter((c) => !c.autoTitle && ((c.passageTerms?.length ?? 0) > 0 || (c.titleMatch?.length ?? 0) > 0));

  const sources: SourceRecord[] = [];
  const passages: Passage[] = [];
  for (const s of corpus.sources) {
    // V-1 identity
    if (!s.id || ids.has(s.id)) problems.push(`V-1 duplicate or missing source id: ${s.id}`);
    ids.add(s.id);
    if (!s.title || !s.slides?.length) problems.push(`V-1 ${s.id}: missing title or slides`);
    const hash = sha256(canonicalSource(s));
    // V-2 authority: approved (with a resolvable owner record) or pending (real content awaiting approval, labeled) and current
    let exclusionReason: string | undefined;
    if (s.lifecycle === "superseded") exclusionReason = `A2 superseded by ${s.supersededBy}`;
    else if (s.lifecycle === "retired") exclusionReason = "retired";
    else if (s.approval === "unknown") exclusionReason = "A3 approval unknown";
    else if (s.approval === "not_approved") exclusionReason = "not approved";
    else if (s.approval === "approved" && (!s.approvalRecord || !owners.has(s.approvalRecord))) exclusionReason = "A3 approval record missing";
    // V-3 supersession chain
    if (s.lifecycle === "superseded") {
      const tgt = s.supersededBy ? byId.get(s.supersededBy) : undefined;
      if (!tgt) problems.push(`V-3 ${s.id}: supersededBy '${s.supersededBy}' does not exist`);
      else if (tgt.lifecycle !== "current" || !["approved", "pending"].includes(tgt.approval)) problems.push(`V-3 ${s.id}: replacement ${tgt.id} is not a current source`);
    }
    const indexed = exclusionReason === undefined;
    sources.push({
      id: s.id, title: s.title, printedRevision: s.printedRevision, approval: s.approval, approvalRecord: s.approvalRecord,
      lifecycle: s.lifecycle, supersededBy: s.supersededBy, riskCategory: s.riskCategory, sha256: hash, file: s.file, format: s.format,
      advisory: advisories.get(s.title), folders: s.folders,
      slides: s.slides.map((sl) => ({ n: sl.n, title: sl.title, image: sl.transcribed ? null : `slides/${s.id}-${sl.n}${imageExt}`, transcribed: sl.transcribed })),
      indexed, exclusionReason,
    });
    if (!indexed) continue;
    const titleNorm = s.title.toLowerCase();
    for (const sl of s.slides) {
      sl.units.forEach((u, i) => {
        const pid = `${s.id}#s${sl.n}#u${i + 1}`;
        if (!u.text?.trim()) problems.push(`V-1 ${pid}: empty text`);
        // concepts: explicit (curated) or auto-tagged from vocabulary (title match / passage terms)
        let concepts = u.concepts;
        if (!concepts) {
          const hay = normalize(`${u.heading} ${u.text}`);
          concepts = autoConcepts.filter((c) => (c.titleMatch ?? []).some((t) => titleNorm.includes(t.toLowerCase())) || (c.passageTerms ?? []).some((t) => textHasPhrase(hay, t))).map((c) => c.id);
        }
        if (vocab.autoTitleConcepts) concepts = [...concepts, `TITLE:${s.id}`];
        for (const c of concepts) if (!conceptIds.has(c)) problems.push(`V-5 ${pid}: unknown concept ${c}`);
        const conds = u.conditions ?? [];
        for (const cnd of conds) if (!CONDITION_RX.test(cnd)) problems.push(`V-6 ${pid}: condition lacks a condition marker: "${cnd}"`);
        if (u.conflictGroup && !groups.has(u.conflictGroup)) problems.push(`V-4 ${pid}: unknown conflict group ${u.conflictGroup}`);
        const risk = vocab.concepts.filter((c) => concepts!.includes(c.id) && c.risk.startsWith("HR")).map((c) => c.risk)[0] ?? s.riskCategory;
        passages.push({
          id: pid, sourceId: s.id, sourceTitle: s.title, printedRevision: s.printedRevision, sourceSha256: hash,
          slide: sl.n, slideTitle: sl.title, unit: i + 1, heading: u.heading, text: u.text, conditions: conds,
          concepts, facets: { ...(corpus.roles ? withoutAudience(s.facets) : s.facets), ...(u.facets ?? {}) }, numeric: u.numeric ?? [], conflictGroups: u.conflictGroup ? [u.conflictGroup] : [],
          riskCategory: risk, approval: s.approval, advisory: advisories.get(s.title), transcribed: sl.transcribed, folders: s.folders,
        });
      });
    }
  }

  for (const ra of corpus.rankAdjust ?? []) {
    const ids = new Set(corpus.sources.filter((x) => x.title === ra.source).map((x) => x.id));
    if (!ids.size) { problems.push(`rankAdjust refers to unknown source "${ra.source}"`); continue; }
    for (const p of passages) if (ids.has(p.sourceId) && (!ra.contains || p.text.toLowerCase().includes(ra.contains.toLowerCase()))) { p.rankFactor = ra.factor; if (ra.unless) p.rankUnless = ra.unless; }
  }
  for (const a of corpus.aliases ?? []) if (!byTitle.has(a.source)) problems.push(`aliases refer to unknown source "${a.source}"`);
  for (const c of vocab.concepts) for (const t of c.prefer ?? []) if (!byTitle.has(t)) problems.push(`V-5 concept ${c.id}: preferred source "${t}" does not exist`);

  // Conflict groups declared by member snippets (real content): resolve to exact passages, or fail.
  for (const g of corpus.conflictGroups) {
    for (const c of [g.concept, ...(g.requires ?? []).flatMap((r) => r.split("|")).filter((x) => !x.startsWith("@"))]) if (!conceptIds.has(c)) problems.push(`V-4 conflict group ${g.id}: unknown concept ${c}`);
    for (const m of g.members ?? []) {
      const srcIds = new Set(corpus.sources.filter((x) => x.title === m.source).map((x) => x.id));
      if (!srcIds.size) { problems.push(`V-4 conflict group ${g.id}: unknown source "${m.source}"`); continue; }
      const hits = passages.filter((p) => srcIds.has(p.sourceId) && p.text.toLowerCase().includes(m.contains.toLowerCase()));
      if (!hits.length) { problems.push(`V-4 conflict group ${g.id}: no passage in "${m.source}" contains "${m.contains}"`); continue; }
      for (const h of hits) {
        if (!h.conflictGroups.includes(g.id)) h.conflictGroups.push(g.id);
        if (!h.concepts.includes(g.concept)) h.concepts.push(g.concept); // a conflict member is, by definition, about the conflict's topic
      }
    }
  }
  for (const g of corpus.conflictGroups) {
    const members = passages.filter((p) => p.conflictGroups.includes(g.id));
    if (g.status === "open" && new Set(members.map((m) => m.sourceId)).size < 2) problems.push(`V-4 conflict group ${g.id} needs passages from at least two current sources`);
  }

  // V-5 facet scope. Approved content must declare scope for rule-facet concepts; pending content is allowed to be unscoped
  // (the engine then shows it under "source doesn't say", never as a universal rule) and is reported as a warning.
  const conceptDefs = new Map(vocab.concepts.map((c) => [c.id, c]));
  for (const p of passages) for (const c of p.concepts) for (const f of conceptDefs.get(c)?.ruleFacets ?? []) {
    if (p.facets[f]) continue;
    if (p.approval === "approved") problems.push(`V-5 ${p.id}: concept ${c} depends on '${f}' but the passage declares no ${f} scope`);
    else warnings.push(`unscoped ${f}: ${p.id} (${c})`);
  }

  // V-4 conflict candidates among APPROVED content: same concept, different sources, overlapping scope -> must be declared or classified.
  const approved = passages.filter((p) => p.approval === "approved");
  const classified = new Set((corpus.classifications ?? []).map((c) => [c.a, c.b].sort().join("|")));
  for (let i = 0; i < approved.length; i++) for (let j = i + 1; j < approved.length; j++) {
    const a = approved[i]!, b = approved[j]!;
    if (a.sourceId === b.sourceId) continue;
    const shared = a.concepts.filter((c) => b.concepts.includes(c) && !c.startsWith("TITLE:"));
    if (!shared.length) continue;
    const fNames = new Set<FacetName>([...Object.keys(a.facets), ...Object.keys(b.facets)] as FacetName[]);
    if (![...fNames].every((f) => overlaps(a.facets[f], b.facets[f]))) continue; // disjoint scope => A4 alternatives
    if (a.conflictGroups.some((g) => b.conflictGroups.includes(g))) continue; // declared A1
    if (classified.has([a.id, b.id].sort().join("|"))) continue;
    problems.push(`V-4 unclassified conflict candidate: ${a.id} <-> ${b.id} (concept ${shared.join(",")})`);
  }
  if (problems.length) throw new ValidationError(problems);
  // Roles: each role sees only the job aids in its folders. A job aid in no role's folder is left out of the app
  // (no text, no images), after the checks above so overlay entries that name it still validate.
  let shipped = passages;
  if (corpus.roles) {
    const roleIds = new Set<string>();
    for (const r of corpus.roles) {
      if (!r.id || roleIds.has(r.id) || !r.folders?.length) problems.push(`roles: role "${r.id}" needs a unique id and at least one folder`);
      roleIds.add(r.id);
      if (r.priority && !r.folders.includes(r.priority)) problems.push(`roles: ${r.id} priority folder "${r.priority}" is not one of its folders`);
      for (const f of r.folders ?? []) if (!corpus.sources.some((s) => s.folders?.includes(f))) warnings.push(`roles: folder "${f}" (${r.id}) has no job aids`);
    }
    if (problems.length) throw new ValidationError(problems);
    const reachable = new Set(corpus.roles.flatMap((r) => r.folders));
    for (const rec of sources) if (rec.indexed && !(rec.folders ?? [""]).some((f) => reachable.has(f))) {
      rec.indexed = false;
      rec.exclusionReason = (rec.folders ?? [""]).some(Boolean) ? `folder "${rec.folders!.join(", ")}" is not used by any role` : "not in a role folder";
    }
    const kept = new Set(sources.filter((s) => s.indexed).map((s) => s.id));
    shipped = passages.filter((p) => kept.has(p.sourceId));
  }
  return {
    program: corpus.program, knowledgeVersion: corpus.knowledgeVersion, defaultSeason: corpus.defaultSeason, notice: corpus._notice,
    sources, passages: shipped, conflictGroups: corpus.conflictGroups.map(({ members: _m, ...g }) => g), vocab, warnings, roles: corpus.roles, conflictPolicy: corpus.conflictPolicy, quickAnswers: corpus.quickAnswers,
    aliases: Object.fromEntries((corpus.aliases ?? []).filter((a) => byTitle.has(a.source)).map((a) => [a.source, a.phrases.join(" | ")])),
  };
}

/** With roles, the folder decides who sees a job aid: title-based audience tags on the whole aid no longer apply.
 *  Audience tags on single passages ("Senior Reps: ...") are kept. */
const withoutAudience = (f: FacetMap): FacetMap => { const { audience: _a, ...rest } = f; return rest; };
