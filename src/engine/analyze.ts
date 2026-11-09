// Query analysis: normalization, filler stripping, acronym expansion, typo correction,
// concept / facet / ambiguity recognition. Deterministic; no randomness, no network.
import type { FacetName, VocabInput } from "./types.ts";
import { COMMON_WORDS, DO_NOT_CORRECT } from "./common-words.ts";

const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17",
  eighteen: "18", nineteen: "19", twenty: "20", thirty: "30", forty: "40", fifty: "50", sixty: "60",
};
const TENS = new Set(["20", "30", "40", "50", "60"]);
/** Contractions typed without an apostrophe, and "she's/he's" forms (the 's is dropped). */
const CONTRACTIONS: Record<string, string> = {
  cant: "can't", dont: "don't", didnt: "didn't", wont: "won't", isnt: "isn't", doesnt: "doesn't", wasnt: "wasn't",
  arent: "aren't", werent: "weren't", havent: "haven't", hasnt: "hasn't", couldnt: "couldn't", shouldnt: "shouldn't",
  wouldnt: "wouldn't", shes: "she", hes: "he", theyre: "they", im: "i", ive: "i", youre: "you", thats: "that",
};

/** Lowercase, Unicode-normalize, unify punctuation and number forms. Negation words are preserved. */
export function normalize(raw: string): string {
  let s = raw.normalize("NFKC").toLowerCase().replace(/[​-‍﻿]/g, "");
  s = s.replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-");
  s = s.replace(/\b(\d+)\s*(?:yo|y\/o|yrs?|-?years?-?old)\b/g, "$1 year old");
  s = s.replace(/\b3rd[\s-]*part(y|ies)\b/g, "third part$1");
  s = s.replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1");
  s = s.replace(/\bs\s*\+\s*1\b/g, " self plus one ").replace(/\bs\s*\/\s*f\b/g, " self and family ").replace(/\bs\s*\/\s*o\b/g, " self only ");
  s = s.replace(/(\w)-(\w)/g, "$1 $2"); // full-time -> full time, 3rd-party -> 3rd party
  s = s.replace(/[^a-z0-9'@.\s]/g, " ").replace(/(?<![a-z0-9])\.|\.(?![a-z0-9])/g, " ");
  // number words -> digits, incl. "twenty one" -> "21"
  const words = s.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!.replace(/'s$/, "").replace(/^'+|'+$/g, "");
    if (!w) continue;
    words[i] = CONTRACTIONS[w] ?? w;
    const n = NUMBER_WORDS[words[i]!];
    if (n !== undefined) {
      const next = words[i + 1] ? NUMBER_WORDS[words[i + 1]!] : undefined;
      if (TENS.has(n) && next !== undefined && Number(next) < 10) { out.push(String(Number(n) + Number(next))); i++; continue; }
      out.push(n); continue;
    }
    out.push(words[i]!);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export function stripFillers(s: string, fillers: string[]): string {
  let t = ` ${s} `;
  for (const f of [...fillers].sort((a, b) => b.length - a.length)) t = t.split(` ${f} `).join(" ");
  return t.replace(/\s+/g, " ").trim();
}

/** Restricted Damerau-Levenshtein distance with an early-exit bound. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v; rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length]![b.length]!;
}

export interface Corrector { dict: Set<string>; vocabWords: Set<string>; byLen: Map<number, string[]>; protectedTerms: Set<string>; freq: Map<string, number>; known: (w: string) => boolean }

/**
 * `words`: every word in the indexed corpus + vocabulary. `vocabWords`: words from curated domain vocabulary
 * (concept terms, facet cues, labels). Domain words win ties, and 4-letter tokens may only be corrected to a
 * domain word, so ordinary short words ("says", "need") are never rewritten into corpus words ("days", "needs").
 */
export function buildCorrector(words: Iterable<string>, protectedTerms: Iterable<string>, vocabWords: Iterable<string> = []): Corrector {
  const dict = new Set<string>(); const byLen = new Map<number, string[]>(); const freq = new Map<string, number>();
  for (const w of words) {
    if (!/^[a-z][a-z']+$/.test(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
    if (dict.has(w)) continue;
    dict.add(w);
    const L = byLen.get(w.length) ?? []; L.push(w); byLen.set(w.length, L);
  }
  for (const L of byLen.values()) L.sort();
  const vw = new Set([...vocabWords].filter((w) => dict.has(w)));
  // A word is known if it is ordinary English/Spanish, curated vocabulary, or used at least twice in the job aids.
  const known = (w: string) => COMMON_WORDS.has(w) || DO_NOT_CORRECT.has(w) || vw.has(w) || (freq.get(w) ?? 0) >= 2;
  return { dict, vocabWords: vw, byLen, protectedTerms: new Set(protectedTerms), freq, known };
}

/** Correct one token if it is unknown. Never corrects tokens under 4 letters, numbers, or protected/acronym terms. */
const fold = (w: string) => w.replace(/ph/g, "f").replace(/ck/g, "k").replace(/(.)\1+/g, "$1");
export function correctToken(tok: string, c: Corrector): string {
  if (tok.length < 4 || /\d/.test(tok) || c.known(tok) || c.protectedTerms.has(tok)) return tok;
  // an inflection of a known word is not a typo ("russian", "lagging", "billed")
  for (const suf of ["s", "es", "n", "an", "ian", "ing", "ed", "er", "ers", "ly", "y"]) {
    if (tok.endsWith(suf)) { const b = tok.slice(0, -suf.length); if (b.length >= 3 && (c.known(b) || c.known(b + "e") || (b.length > 3 && b.at(-1) === b.at(-2) && c.known(b.slice(0, -1))))) return tok; }
  }
  const max = tok.length >= 9 ? 2 : 1;
  const domainOnly = true; // corrections only land on curated domain words (job-aid titles, topic terms)
  let best: string | undefined; let bestKey: [number, number, number] | undefined;
  for (let L = tok.length - max; L <= tok.length + max; L++) {
    for (const w of c.byLen.get(L) ?? []) {
      const isVocab = c.vocabWords.has(w);
      if (domainOnly && !isVocab) continue;
      if (w[0] !== tok[0] && !(w[0] === tok[1] && w[1] === tok[0])) continue; // typos rarely change the first letter ("dress" is not "press")
      // spelled by sound or with doubled letters ("softfone", "calller"): same word once folded
      const dd = fold(tok) === fold(w) ? 0 : editDistance(tok, w, max);
      if (dd > max) continue;
      // lower distance, then domain vocabulary, then corpus frequency, then alphabetical (deterministic)
      const key: [number, number, number] = [dd, isVocab ? 0 : 1, -(c.freq.get(w) ?? 0)];
      if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && (key[2] < bestKey[2] || (key[2] === bestKey[2] && w < best!)))))) { best = w; bestKey = key; }
    }
  }
  return best ?? tok;
}

const NEGATORS = new Set(["no", "not", "without", "never", "isn't", "aren't", "don't", "doesn't", "didn't", "wasn't", "weren't", "non", "nor"]);
/** Words that may sit inside a phrase without breaking it ("add his wife" matches "add wife"). */
const GAP_WORDS = new Set(["a", "an", "the", "his", "her", "my", "their", "him", "them", "our", "your", "this", "that", "its", "some"]);
const BREAK = "|";

/** Word forms that count as the same word: plural, -ing, -ed, -es, -ies, doubled consonants ("cancelling" = "cancel"). */
const formCache = new Map<string, string[]>();
export function wordForms(w: string): string[] {
  let f = formCache.get(w);
  if (f) return f;
  const out = new Set([w]);
  if (w.length >= 4 && /^[a-z']+$/.test(w)) {
    const roots: string[] = [];
    if (w.endsWith("ies")) roots.push(w.slice(0, -3) + "y");
    if (w.endsWith("es")) roots.push(w.slice(0, -2));
    if (w.endsWith("s") && !w.endsWith("ss")) roots.push(w.slice(0, -1));
    if (w.endsWith("ing")) roots.push(w.slice(0, -3));
    if (w.endsWith("ed")) roots.push(w.slice(0, -2));
    for (const r of roots) {
      if (r.length < 4) continue;
      out.add(r); out.add(r + "e");
      if (r.at(-1) === r.at(-2)) out.add(r.slice(0, -1));
    }
  }
  f = [...out]; formCache.set(w, f);
  return f;
}
const sameWord = (q: string, t: string) => q === t || (q.length >= 4 && t.length >= 4 && wordForms(q).some((x) => wordForms(t).includes(x)));

const phraseCache = new Map<string, { words: string[]; star: boolean }>();
function phraseOf(term: string): { words: string[]; star: boolean } {
  let ph = phraseCache.get(term);
  if (!ph) {
    const star = term.trim().endsWith("*");
    ph = { words: normalize(term.replace(/\*\s*$/, "")).split(" ").filter(Boolean), star };
    phraseCache.set(term, ph);
  }
  return ph;
}

/** Find a phrase in a word list: same word forms, up to 2 article/pronoun words between phrase words, and not
 *  negated (a negation word just before it, possibly across an article: "not a federal civilian"). Returns the
 *  matched word positions, or null. `used` positions (already consumed by a longer cue) never match. */
/** Shared phrase matcher for the build (tagging job-aid passages with topics) and the query side: same word forms,
 *  same small gaps. Passages are tagged without negation ("not eligible" text is still about eligibility). */
export function textHasPhrase(normalizedText: string, term: string): boolean {
  return findPhrase(normalizedText.split(" "), term, undefined, undefined, false) !== null;
}
function findPhrase(words: string[], term: string, used?: Set<number>, negated?: number[], honorNegation = true): number[] | null {
  const { words: pw, star } = phraseOf(term);
  if (!pw.length) return null;
  const eq = (i: number, k: number) => {
    const w = words[i]!;
    if (w === BREAK || used?.has(i)) return false;
    if (star && k === pw.length - 1) return w.startsWith(pw[k]!);
    return sameWord(w, pw[k]!);
  };
  for (let i = 0; i < words.length; i++) {
    if (!eq(i, 0)) continue;
    const pos = [i]; let ok = true;
    for (let k = 1; k < pw.length && ok; k++) {
      ok = false;
      for (let j = pos.at(-1)! + 1, gaps = 0; j < words.length && gaps <= 2; j++) {
        if (eq(j, k)) { pos.push(j); ok = true; break; }
        if (!GAP_WORDS.has(words[j]!)) break;
        gaps++;
      }
    }
    if (!ok) continue;
    let b = i - 1;
    while (b >= 0 && i - b <= 3 && GAP_WORDS.has(words[b]!)) b--;
    if (honorNegation && b >= 0 && NEGATORS.has(words[b]!)) { negated?.push(...pos); continue; }
    return pos;
  }
  return null;
}
/** Replace blocked phrases with a break so they can't match ("dead air" is not a death, "fed up" is not a federal employee). */
function blockOut(words: string[], blocks: string[]): string[] {
  if (!blocks.length) return words;
  const out = [...words];
  for (const b of [...blocks].sort((x, y) => y.length - x.length)) { // longest first: "survivor notification letter" before "notification letter"
    const bw = normalize(b).split(" ");
    for (let i = 0; i + bw.length <= out.length; i++) if (bw.every((x, k) => out[i + k] === x)) for (let k = 0; k < bw.length; k++) out[i + k] = BREAK;
  }
  return out;
}
/** Cue phrases, longest first; each matched cue consumes its words, so "missed open season" can't also count as "open season". */
function matchCues(hays: string[][], cues: { cue: string; value: string }[]): string[] {
  const out: string[] = [];
  const sorted = [...cues].sort((a, b) => phraseOf(b.cue).words.length - phraseOf(a.cue).words.length || b.cue.length - a.cue.length);
  for (const words of hays) {
    const used = new Set<number>();
    for (const { cue, value } of sorted) {
      // a negated cue ("not federal civilian") also consumes its words, so a shorter cue inside it ("civilian") can't match
      const negated: number[] = [];
      const pos = findPhrase(words, cue, used, negated);
      negated.forEach((x) => used.add(x));
      if (pos) { if (!out.includes(value)) out.push(value); pos.forEach((x) => used.add(x)); }
    }
  }
  return out;
}
const CHILD_WORDS = /\b(kid|kids|son|daughter|child|children|dependent|dependents|grandson|granddaughter|grandkid|grandchild|stepson|stepdaughter|stepchild|stepkid|student|teen|teenager)\b/;
/** Member data must never be analyzed or echoed: SSNs, IDs, phone numbers, birth dates, and digits after "SSN", "last four", "member id"... */
const PII_RX: RegExp[] = [
  /\b(?:last\s*(?:4|four)(?:\s*digits)?(?:\s*of)?(?:\s*(?:the|her|his|their|my))?(?:\s*(?:ssn|social(?:\s*security)?(?:\s*number)?))?|ssn|social\s*security(?:\s*(?:number|no))?|member\s*(?:id|number|no|#)|mid|dob|date\s*of\s*birth|birth\s*date|routing(?:\s*number)?|account\s*(?:number|no|#)|acct)\s*(?:#|no\.?|number)?\s*(?:is|was|=|:)?\s*[a-z]{0,3}\d[\d\s./-]{2,}\d/gi,
  /\b[a-z]{1,3}\d{5,}\b/gi, // letter-prefixed IDs ("BF1234567"); short codes like DV35 or R01 are not touched
  /\b\d{3}[-\s.]?\d{2}[-\s.]?\d{4}\b/g,
  /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
  /\b\d{1,2}[/-]\d{1,2}[/-](?:19|20)\d{2}\b/g,
  /\b\d{6,}\b/g,
];
const SPANISH = new Set(["hola", "quiero", "necesito", "puedo", "habla", "hablo", "espanol", "español", "ingles", "inglés", "por", "favor", "gracias", "senor", "senora", "señor", "señora", "cancelar", "pagar", "cuenta", "seguro", "ayuda", "usted", "mi", "mis", "el", "la", "los", "las", "una", "uno", "que", "para", "con", "como", "esta", "estoy", "tengo", "quiere", "llamo", "llamar", "si", "pero", "porque", "dentista", "visión", "plan", "de"]);

export interface Analysis {
  normalized: string; corrected: string; tokens: string[]; contentTokens: string[];
  corrections: { from: string; to: string }[]; expansions: string[]; concepts: string[];
  facetCues: Partial<Record<FacetName, string[]>>; ages: number[]; notes: string[]; ambiguityIds: string[];
  /** words as the user typed them, for rare-term fallback (case kept) */
  rawWords: string[];
  /** title concepts matched by one identifying word only: they point at a job aid but never make a Strong answer */
  weakTitles: string[];
}

/** The question with member data (SSNs, Member IDs, phone numbers, birth dates) removed. */
export function scrubMemberData(query: string): string {
  let scrubbed = query;
  for (const rx of PII_RX) scrubbed = scrubbed.replace(rx, (m) => /^[a-z]{1,3}\d+$/i.test(m) ? " " : m.replace(/\d/g, "").replace(/[\s./()+-]+$/, " ") + " ");
  return scrubbed;
}

export function analyze(query: string, vocab: VocabInput, corrector: Corrector): Analysis {
  const notes: string[] = [];
  // Never analyze (or echo back) member data: SSNs, Member IDs, phone numbers, birth dates.
  const scrubbed = scrubMemberData(query);
  if (scrubbed !== query) notes.push("Numbers that look like member data (SSN, Member ID, phone number or birth date) were ignored. Don't type member data into search.");
  const normalized = normalize(scrubbed);
  const body = stripFillers(normalized, vocab.fillers);
  const corrections: { from: string; to: string }[] = [];
  const tokens = body.split(" ").filter(Boolean).map((t) => {
    const fixed = correctToken(t, corrector);
    if (fixed !== t) corrections.push({ from: t, to: fixed });
    return fixed;
  });
  const corrected = tokens.join(" ");
  // Words for retrieval: the user's words plus acronym expansions and synonyms.
  const expandedAcr = tokens.flatMap((t) => [t, ...(vocab.acronyms[t] ? vocab.acronyms[t]!.split(" ") : []), ...(vocab.synonyms?.[t] ?? [])]);
  const matchText = expandedAcr.join(" ");
  // Haystacks for phrase matching, kept separate so expansions never split a phrase the user typed:
  // the words as typed; acronyms replaced by their meaning ("poa fax" -> "power of attorney fax"); synonyms alone.
  const plain = tokens;
  const substituted = tokens.flatMap((t) => (vocab.acronyms[t] ? vocab.acronyms[t]!.split(" ") : [t]));
  // for one-word topic terms: an acronym stands for its expansion's first word only ("bar" -> belated, not "request")
  const headWords = tokens.flatMap((t) => (vocab.acronyms[t] ? [vocab.acronyms[t]!.split(" ")[0]!, BREAK] : [t]));
  const synonymWords = tokens.flatMap((t) => (vocab.synonyms?.[t] ? [BREAK, ...vocab.synonyms[t]!, BREAK] : [BREAK]));
  const hays = [plain, substituted, synonymWords];

  const ambiguityIds: string[] = [];
  for (const amb of vocab.ambiguityCues) {
    const re = new RegExp(`(?:^| )${amb.pattern}(?: (\\w+))?`, "g");
    let m: RegExpExecArray | null; let fired = false;
    while ((m = re.exec(corrected))) if (!amb.unlessFollowedBy.includes(m[1] ?? "")) fired = true;
    if (fired) { notes.push(amb.note); ambiguityIds.push(amb.id); }
  }
  // Concepts come only from curated terms ("full time" on its own is deliberately not a term of any concept).
  const concepts: string[] = [];
  const weakTitles: string[] = [];
  // Title words are matched against the words the agent typed only: acronym expansions ("fedvip" -> "...dental and
  // vision...") and synonyms must never make a job-aid title match.
  const typed = (w: string) => tokens.some((t) => sameWord(t, w));
  for (const c of vocab.concepts) {
    const hs = hays.map((h) => blockOut(h, c.blockPhrases ?? [])); // e.g. "dead air" is not a death
    // Topic terms: negation does not remove the topic ("not eligible" is still about eligibility) unless the topic opts in.
    // A one-word term matches the typed words or a curated synonym, never a word inside an acronym's expansion
    // ("qle" -> "qualifying life event" must not trigger "qualify").
    const hit = c.terms.some((term) => {
      const single = !phraseOf(term).words.slice(1).length;
      return (single ? [hs[0]!, hs[2]!, blockOut(headWords, c.blockPhrases ?? [])] : hs).some((h) => findPhrase(h, term, undefined, undefined, !!c.negatable));
    });
    if (hit) { concepts.push(c.id); continue; }
    // Two-signal rule: one word or phrase from EACH group, all within `window` words of each other
    // ("son ... calling", "enrolled ... yesterday ... cancel"). Matched on the words as typed.
    if (c.allOf?.length) {
      const w = blockOut(plain, c.blockPhrases ?? []);
      const firsts = c.allOf.map((g) => g.map((t) => findPhrase(w, t, undefined, undefined, false)).filter((x): x is number[] => !!x).map((x) => x[0]!));
      if (firsts.every((f) => f.length)) {
        const all = firsts.map((f) => Math.min(...f)); const span = Math.max(...all) - Math.min(...all);
        if (span <= (c.window ?? 8)) { concepts.push(c.id); continue; }
      }
    }
    if (c.autoTitle) {
      // a job aid's title: at least 2 of its words and 60% of them; or one word that identifies only this job aid
      // (a "weak" title match: it can point at the job aid but never makes a Strong answer on its own)
      const hit = (c.titleWords ?? []).filter(typed).length;
      if (hit >= 2 && hit / (c.titleWords?.length || 1) >= 0.6) concepts.push(c.id);
      else if ((c.titleKeys ?? []).some(typed)) { concepts.push(c.id); weakTitles.push(c.id); }
    }
  }
  const ages = [...corrected.matchAll(/\b(\d{1,2}) year old\b|\b(?:age|turning|turns|turned|turn|is|be|will be|isn't|is not|not|until|almost|nearly|over|under) (\d{1,2})\b|\b(?:son|daughter|kid|child|dependent|grandson|granddaughter|stepson|stepdaughter) (\d{1,2})\b/g)].map((m) => Number(m[1] ?? m[2] ?? m[3]));
  // Word sense: a topic whose word means something else next to another topic ("hold an ACH payment") is dropped.
  for (const c of vocab.concepts) {
    if (!c.suppressWith?.length || !concepts.includes(c.id)) continue;
    if (c.suppressWith.some((x) => concepts.includes(x)) && !(c.unlessTerms ?? []).some((t) => findPhrase(plain, t))) concepts.splice(concepts.indexOf(c.id), 1);
  }
  // An age only signals the dependent age limit when it is near the limits (16-30): "her 10 year old" is not about aging out.
  const nearLimit = ages.some((n) => n >= 16 && n <= 30);
  const childAge = nearLimit && CHILD_WORDS.test(` ${matchText} `);
  if (!concepts.includes("DEPENDENT_AGE_LIMIT") && vocab.concepts.some((c) => c.id === "DEPENDENT_AGE_LIMIT")
      && (childAge || (nearLimit && /\b(year old|turning|turns|turned)\b/.test(corrected)))) concepts.push("DEPENDENT_AGE_LIMIT");
  // Spanish words: the caller likely needs a Spanish-speaking agent
  if (tokens.filter((t) => SPANISH.has(t)).length >= 2 && vocab.concepts.some((c) => c.id === "LANGUAGE") && !concepts.includes("LANGUAGE")) concepts.push("LANGUAGE");

  const facetCues: Partial<Record<FacetName, string[]>> = {};
  for (const [fname, def] of Object.entries(vocab.facets) as [FacetName, (typeof vocab.facets)[FacetName]][]) {
    const cueHays = [plain] /* cues only from the words typed: "fedvip" expands to "federal employees..." but says nothing about the caller */.map((h) => blockOut(h, vocab.cueBlockPhrases ?? []));
    const vals = matchCues(cueHays, Object.entries(def.values).flatMap(([val, v]) => v.cues.map((cue) => ({ cue, value: val }))));
    if (vals.length) facetCues[fname] = vals;
  }
  // Two different affiliations named (e.g. a retired soldier now working as a federal civilian): dual eligibility
  const aff = facetCues.affiliation ?? [];
  if (aff.includes("USM") && aff.some((v) => v !== "USM") && vocab.concepts.some((c) => c.id === "DUAL_ELIGIBILITY") && !concepts.includes("DUAL_ELIGIBILITY")) concepts.push("DUAL_ELIGIBILITY");
  const stop = new Set(vocab.stopwords);
  const contentTokens = expandedAcr.filter((t) => !stop.has(t));
  const expansions = [...new Set(expandedAcr.filter((t) => !tokens.includes(t)))];
  const rawWords = scrubbed.split(/[^A-Za-z0-9'.-]+/).filter(Boolean);
  return { normalized, corrected, tokens, contentTokens, corrections, expansions, concepts, facetCues, ages, notes, ambiguityIds, rawWords, weakTitles };
}
