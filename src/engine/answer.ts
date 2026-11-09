// Quick answer: the one job-aid sentence (or table row) that most directly answers the question, quoted verbatim from
// the top results, shown above them. Nothing is generated or reworded; the text is a slice of a passage.
//   facts:     a question asking for one fact (phone/fax number, email, time frame, age, count) gets the sentence
//              that states it, with the fact marked.
//   steps:     a "how do I…" question gets the numbered steps of the top job aid's slide, in order (up to 5).
//   sentences: other questions get the best-matching sentence of the top passages.
// Shown only when the answer is clear: an ANSWER outcome with a Strong match, no clarify groups, no conflict card, no
// safety procedure pinned first, and no warning that the top passage misses part of the question. Off unless the content
// enables it (overlay.json "quickAnswers"), so removing the feature is one setting.
import { normalize } from "./analyze.ts";
import { COMMON_WORDS } from "./common-words.ts";
import type { Engine } from "./search.ts";
import type { Passage, QuickAnswer, QuickAnswerSettings, SearchResponse } from "./types.ts";

/** What the question asks for, and how that fact looks in job-aid text. */
const INTENTS: { id: QuickAnswer["fact"]; ask: RegExp; value: RegExp }[] = [
  { id: "phone", ask: /\b(phone|fax|telephone|toll[- ]?free|tty|number (?:to|for|of)|call (?:back )?number|what number)\b/i,
    value: /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/ },
  { id: "email", ask: /\b(e-?mail)\b/i, value: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/ },
  { id: "time", ask: /\b(how long|how many (?:business |calendar )?(?:days|weeks|months|minutes|hours|years)|how soon|deadline|time ?frame|by when)\b/i,
    value: /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|fourteen|thirty|sixty|ninety)(?:\s*\(\d+\))?\s+(?:business |calendar )?(?:days?|weeks?|months?|years?|minutes?|hours?)\b/i },
  { id: "age", ask: /\b(how old|what age|age limit|aging out|age out|until what age)\b/i, value: /\b(?:age|ages|until|turns?)\s+\d{2}\b|\b\d{2}(?:st|nd|rd|th)\s+birthday\b/i },
  { id: "count", ask: /\bhow many\b/i, value: /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i },
];

/** "How do I …" questions: the answer is a procedure. */
const HOW_TO = /\b(how (?:do|can|would|should|to) (?:i|we|you|they|agents?)?|how to|steps? (?:to|for)|what are the steps|walk me through|process (?:to|for))\b/i;
/** A request phrased as a task ("change the date range for CSAT reports"), not a question ("what is…", "can they…"). */
const QUESTION_WORD = /^\s*(what|why|who|whom|whose|which|when|where|is|are|was|were|can|could|does|do|did|should|would|will|has|have|if)\b/i;
const STEP = /^\s*(\d{1,2})[.)]\s+\S/;
const MAX_STEPS = 5;
const MIN_COVER = 0.4; // share of the question's distinctive word weight a sentence must contain
const AMBIGUOUS = 0.08; // two different facts from different job aids this close: don't pick one

interface Piece { text: string; p: Passage; rank: number; first: boolean }

/** Sentences that introduce, title or lead into something rather than answer: never a quick answer. */
const NOT_AN_ANSWER = /^(\(?see\b|this (job aid|resource|guide|document|page|slide)|these (steps|instructions)|use the (steps|scripting|script|information) below|the following|refer to|click here|steps?:)/i;

/** Verbatim sentences and table rows of a passage (bullets lose only their bullet mark). */
function pieces(p: Passage, rank: number): Piece[] {
  const out: Piece[] = [];
  const lines = p.text.split("\n");
  const tableLines = lines.filter((l) => l.trim().startsWith("|")).length;
  lines.forEach((raw, idx) => {
    const line = raw.trim().replace(/^[-•]\s+/, "");
    if (!line) return;
    if (line.startsWith("|")) { // table row: its cells, as written; the header row and very long rows are not answers
      if (idx === 0 && tableLines > 1) return;
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2 && line.length <= 300) out.push({ text: cells.join(" | "), p, rank, first: !out.length });
      return;
    }
    for (const raw2 of line.split(/(?<=[.!?])\s+(?=["“(]?[A-Z])/)) {
      const t = raw2.trim();
      if (t.length < 25 || t.length > 360) continue;
      if (/^[a-z]/.test(t) || /:$/.test(t) || !/[.!?)"”]$/.test(t) || NOT_AN_ANSWER.test(t)) continue; // fragment, lead-in, heading, intro
      out.push({ text: t, p, rank, first: !out.length });
    }
  });
  return out;
}

export function quickAnswer(engine: Engine, res: SearchResponse, settings: QuickAnswerSettings): QuickAnswer | undefined {
  if (!settings.facts && !settings.sentences && !settings.steps) return undefined;
  if (res.outcome !== "ANSWER" || res.groups.length || res.conflict) return undefined;
  if (res.notes.some((n) => n.startsWith("Safety procedure shown first") || n.startsWith("The top job-aid passage doesn't mention"))) return undefined;
  const top = res.results.filter((r) => r.band === "Strong match").slice(0, 3);
  if (!top.length) return undefined;

  const stop = new Set(engine.kb.vocab.stopwords);
  const weight = (t: string) => Math.log((engine.nPassages + 1) / ((engine.termDf.get(t) ?? 0) + 1));
  const proc = (s: string) => new Set(normalize(s).split(" ").filter((w) => w.length >= 2 && !stop.has(w) && !COMMON_WORDS.has(w)).map((w) => engine.processTerm(w)).filter((w): w is string => !!w));
  const q = [...proc(res.normalized)].filter((t) => (engine.termDf.get(t) ?? 0) > 0);
  const total = q.reduce((n, t) => n + weight(t), 0);
  if (!q.length || total <= 0) return undefined;
  const intent = settings.facts ? INTENTS.find((i) => i.ask.test(res.query) || i.ask.test(res.normalized)) : undefined;
  const coverOf = (text: string) => { const w = proc(text); return q.filter((t) => w.has(t)).reduce((n, t) => n + weight(t), 0) / total; };

  // steps: the numbered lines of the top result's slide (steps are often one passage each), in the job aid's order
  const procedure = HOW_TO.test(res.query) || (!QUESTION_WORD.test(res.query) && !/\b(what|which|why|who|whom)\b/i.test(res.query) && !res.query.includes("?"));
  if (settings.steps && procedure && !(intent && intent.id !== "count")) {
    const r0 = top[0]!;
    const slide = [...engine.byId.values()].filter((p) => p.sourceId === r0.passage.sourceId && p.slide === r0.passage.slide).sort((a, b) => a.unit - b.unit);
    const lines = slide.flatMap((p) => p.text.split("\n").filter((l) => STEP.test(l)).map((l) => ({ l: l.trim(), p })));
    const fromOne = lines.findIndex((x) => Number(x.l.match(STEP)![1]) === 1);
    const steps = fromOne >= 0 ? lines.slice(fromOne) : [];
    // a real sequence (1, 2, 3 …) about the question
    const ordered = steps.length >= 2 && steps.slice(0, MAX_STEPS).every((x, i) => Number(x.l.match(STEP)![1]) === i + 1);
    if (ordered && coverOf(slide.map((p) => `${p.heading} ${p.text}`).join(" ")) >= 0.5) {
      const shown = steps.slice(0, MAX_STEPS);
      return {
        kind: "steps", text: shown.map((x) => x.l).join("\n"), steps: shown.map((x) => x.l), moreSteps: Math.max(0, steps.length - MAX_STEPS),
        // cited to the top result on that slide, so "Open slide" opens it
        passageId: r0.passage.id, sourceTitle: r0.passage.sourceTitle, slide: r0.passage.slide, printedRevision: r0.passage.printedRevision,
        hasConditions: shown.some((x) => x.p.conditions.length > 0),
      };
    }
  }

  const scored = top.flatMap((r, i) => pieces(r.passage, i)).map((pc) => {
    const words = proc(pc.text);
    const hit = q.filter((t) => words.has(t));
    const cover = hit.reduce((n, t) => n + weight(t), 0) / total;
    const value = intent ? pc.text.match(intent.value)?.[0] : undefined;
    return { ...pc, hit: hit.length, cover, value, score: cover + (value ? 0.35 : 0) + (pc.rank === 0 ? 0.1 : 0) - pc.rank * 0.05 + (pc.first ? 0.05 : 0) };
  }).sort((a, b) => b.score - a.score || a.rank - b.rank);

  const usable = scored.filter((s) => s.cover >= MIN_COVER && (s.hit >= 2 || (s.value && s.hit >= 1)));
  // a fact question uses the sentence stating the fact; without one, the best sentence (when sentences are on)
  const best = (intent && usable.find((s) => s.value)) || (settings.sentences ? usable[0] : undefined);
  if (!best) return undefined;
  if (best.value) {
    // a different fact from another job aid scoring almost as well: the answer isn't clear, show results only
    const rival = usable.find((s) => s.value && s.p.sourceId !== best.p.sourceId && normalize(s.value) !== normalize(best.value!));
    if (rival && best.score - rival.score < AMBIGUOUS) return undefined;
  }
  return {
    kind: best.value ? "fact" : "sentence", fact: best.value ? intent!.id : undefined, text: best.text, value: best.value,
    passageId: best.p.id, sourceTitle: best.p.sourceTitle, slide: best.p.slide, printedRevision: best.p.printedRevision,
    hasConditions: best.p.conditions.length > 0,
  };
}
