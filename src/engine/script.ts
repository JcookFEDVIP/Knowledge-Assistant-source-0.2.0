// Response scripts: what the agent can say, built ONLY from wording that already exists in the job aids.
// Nothing is generated or paraphrased: every line is a verbatim quote from a job-aid passage, with its citation.
// Frame lines (hold, return from hold, transfer, empathy, closing) come from the hold/transfer, de-escalation and
// call-closing job aids; the answer lines are the quoted scripting of the passage the agent is looking at.
import { engineFor, type Engine } from "./search.ts";
import { normalize } from "./analyze.ts";
import type { Passage, Profile, Result, SearchResponse } from "./types.ts";

export interface ScriptLine {
  /** where this line fits in the call */
  step: "hold" | "return" | "empathy" | "answer" | "transfer" | "condolence" | "close" | "none";
  label: string;
  /** verbatim job-aid wording; empty only for step "none" (the job aid has no scripted wording) */
  text: string;
  sourceTitle?: string; slide?: number;
}

const QUOTE = /[“"]([^”"]{15,700})[”"]/g;
/** Quoted wording that is said TO the customer (not a comment example, a QA note or a third-person instruction). */
const SPOKEN = /\b(you|your|we|our|us|i|i'm|i'll|i've|i am|thank|please|sorry|unfortunately|may i|let me)\b/i;
/** Job aids whose quotes are examples for agents/QA, not things to say to a caller. */
const NOT_CALLER_FACING = /^(QA |Transfer Notes|Commenting with AutoSummary|AutoSummary FAQ|AWD |Escalation to OPM|Account Creation Training Template|BENEFEDS Open Season QA|BENEFEDS Steady State QA|BENEFEDS CXone Steady State QA)/;

/** Verbatim caller-facing script lines in a passage. */
export function scriptLines(p: Passage): string[] {
  if (NOT_CALLER_FACING.test(p.sourceTitle)) return [];
  const out: string[] = [];
  for (const m of p.text.matchAll(QUOTE)) {
    const t = m[1]!.trim();
    if (!/^[A-Z"“(]/.test(t) || !SPOKEN.test(t)) continue;
    if (/^customer\b|\[mm\/dd|^\(?caller'?s name\)?$/i.test(t)) continue; // account-comment templates, not speech
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

const FRAME: Record<string, { step: ScriptLine["step"]; label: string; source: string; startsWith: string }> = {
  hold: { step: "hold", label: "Before you research", source: "Hold and Transfer Procedures and Scripting", startsWith: "May I place you on a brief hold" },
  back: { step: "return", label: "When you come back (use the caller's name)", source: "Hold and Transfer Procedures and Scripting", startsWith: "Thank you for holding, Mrs. Jones. I was able to locate" },
  transfer: { step: "transfer", label: "If you need to transfer", source: "Hold and Transfer Procedures and Scripting", startsWith: "Unfortunately, I am unable to assist you with" },
  empathy: { step: "empathy", label: "If the caller is upset", source: "De-escalation Techniques", startsWith: "I understand you are upset" },
  condolence: { step: "condolence", label: "Closing (death reported)", source: "Call Closing Process - Inbound Calls", startsWith: "Once again, please accept my sincere condolences" },
  close1: { step: "close", label: "Closing", source: "Call Closing Process - Inbound Calls", startsWith: "Have I answered all your questions?" },
  close2: { step: "close", label: "Closing", source: "Call Closing Process - Inbound Calls", startsWith: "Is there anything else I may assist you with?" },
};
const frameCache = new WeakMap<Engine, Record<string, ScriptLine>>();
/** Locates each frame line in the job aids (verbatim). A frame line that no longer exists in the content is simply left out. */
export function frameLines(engine: Engine): Record<string, ScriptLine> {
  let f = frameCache.get(engine);
  if (f) return f;
  f = {};
  for (const [key, def] of Object.entries(FRAME)) {
    for (const p of engine.byId.values()) {
      if (p.sourceTitle !== def.source) continue;
      const hit = [...p.text.matchAll(QUOTE)].map((m) => m[1]!.trim()).find((t) => t.startsWith(def.startsWith));
      if (hit) { f[key] = { step: def.step, label: def.label, text: hit, sourceTitle: p.sourceTitle, slide: p.slide }; break; }
    }
  }
  frameCache.set(engine, f);
  return f;
}

/** Agent-side procedures (systems, scheduling, QA, admin): no caller script unless the job aid itself has one. */
const INTERNAL = /^(CXone|IEX|AWD|NICE|LEARN|Slack|Microsoft Teams|Using Microsoft Teams|Accessing|Understanding LEARN|Viewing|Resetting LEARN|Generating|Creating Automated|Downloading CSAT|Searching Agent|Updating CSAT|Checking Your MFA|MFA Setup|Logging into ServiceNow|Reset SharePoint|Update Microsoft|Update Phone or Email MFA|Vendor|Time Off|Requesting Voluntary|Guidelines for VTO|Unlocking|Scheduling Adjustment|Attendance|Approving|Break and Lunch|RTA|OS Admin|Admin Responsibilities|QA |Employee Service Center|Reporting an Incident in Employee|Changing Your Time Zone|Clearing MS Edge|System Down Checklist|Chorus|Primary .*AWD Ticket|.*AWD Ticket$)/;

const DEATH = ["DEATH_REPORT", "ENROLLEE_DEATH_CALL", "SURVIVOR"];
const UPSET = ["COMPLAINTS", "DEESCALATION", "THREATS", "SUPERVISOR_REQUEST"];
const ESCALATE = /escalate to (a|the) senior rep|transfer (the call|them|the caller) to|escalate (the call|to)/i;

/** The response script for one result: hold -> (empathy) -> return -> the job aid's own wording -> (transfer) -> close. */
export function responseScript(all: Engine, r: Result, res: SearchResponse, profile: Profile): ScriptLine[] {
  const engine = engineFor(all, profile.audience); // frame lines come only from job aids this role can see
  const f = frameLines(engine);
  const lines: ScriptLine[] = [];
  if (INTERNAL.test(r.passage.sourceTitle) && !scriptLines(r.passage).length) return [{ step: "none", label: "Internal procedure", text: "" }];
  const push = (l?: ScriptLine) => { if (l) lines.push(l); };
  push(f.hold);
  if (res.concepts.some((c) => UPSET.includes(c))) push(f.empathy);
  push(f.back);
  // the answer: quoted wording in the passage itself, else elsewhere on the same slide of the same job aid
  let answer = scriptLines(r.passage).map((t) => ({ t, p: r.passage }));
  if (!answer.length) {
    answer = [...engine.byId.values()].filter((p) => p.sourceId === r.passage.sourceId && p.slide === r.passage.slide && p.id !== r.passage.id)
      .flatMap((p) => scriptLines(p).map((t) => ({ t, p }))).slice(0, 3);
  }
  // keep the 4 lines that share the most words with the question, in the job aid's order
  const qWords = new Set(res.normalized.split(" ").map((w) => engine.processTerm(w)).filter((w): w is string => !!w && w.length > 2));
  const overlap = (t: string) => normalize(t).split(" ").filter((w) => qWords.has(engine.processTerm(w) ?? "")).length;
  if (answer.length > 4) {
    const keep = new Set([...answer.keys()].sort((x, y) => overlap(answer[y]!.t) - overlap(answer[x]!.t) || x - y).slice(0, 4));
    answer = answer.filter((_, i) => keep.has(i));
  }
  if (answer.length) for (const { t, p } of answer) lines.push({ step: "answer", label: "Answer (job-aid wording)", text: t, sourceTitle: p.sourceTitle, slide: p.slide });
  else lines.push({ step: "none", label: "Answer", text: "" });
  if (profile.audience === "L1" && ESCALATE.test(r.passage.text)) push(f.transfer);
  if (res.concepts.some((c) => DEATH.includes(c))) push(f.condolence);
  push(f.close1); push(f.close2);
  return lines;
}
