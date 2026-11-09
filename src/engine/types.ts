// Shared types for the engine. Pure data; no DOM, no Node APIs.

export type FacetName = "affiliation" | "callerRole" | "audience" | "season";
export type FacetMap = Partial<Record<FacetName, string[]>>;

/** approved = owner record exists; pending = real content awaiting owner approval (shown, clearly labeled); others excluded. */
export type Approval = "approved" | "pending" | "unknown" | "not_approved";
export type Lifecycle = "current" | "superseded" | "retired";

export interface NumericCondition { subject: string; op: "<" | "<=" | ">" | ">=" | "="; value: number; text: string }

export interface UnitInput {
  heading: string; text: string; conditions?: string[]; concepts?: string[];
  facets?: FacetMap; numeric?: NumericCondition[]; conflictGroup?: string;
}
export interface SlideInput { n: number; title: string; units: UnitInput[]; transcribed?: boolean }
export interface SourceInput {
  id: string; title: string; printedRevision: string; approval: Approval; approvalRecord?: string;
  lifecycle: Lifecycle; supersededBy?: string; riskCategory: string; facets: FacetMap; slides: SlideInput[];
  file?: string; fileSha256?: string; format?: string;
  /** top-level subfolders of the job-aid folder that hold this file ("" = loose in the main folder) */
  folders?: string[];
}
/** A role (the agent's own role switch) and the job-aid subfolders it searches. `priority`: a folder ranked first. */
export type ConflictPolicy = "newest-revision";
/** Quick answer above the results (src/engine/answer.ts). Either part can be switched off in overlay.json. */
export interface QuickAnswerSettings { facts?: boolean; steps?: boolean; sentences?: boolean }
export interface QuickAnswer {
  kind: "fact" | "steps" | "sentence"; fact?: "phone" | "email" | "time" | "age" | "count";
  /** steps: the numbered lines, verbatim; moreSteps: how many further steps are on the slide */
  steps?: string[]; moreSteps?: number;
  /** verbatim sentence or table row from the passage; `value` is the fact inside it */
  text: string; value?: string;
  passageId: string; sourceTitle: string; slide: number; printedRevision: string;
  /** the passage carries a NOTE/EXCEPTION/IMPORTANT line: the agent is told to read it */
  hasConditions: boolean;
}
export interface RoleDef { id: string; label: string; folders: string[]; priority?: string }
export interface ConflictMember { source: string; contains: string }
export interface ConflictGroup {
  id: string; status: "open" | "resolved"; concept: string; classification?: "A1"; decidedBy?: string; note: string;
  /** the conflict applies only when EVERY entry is satisfied; an entry is "A|B" (any of these topics) and may use
   *  "@facet=VALUE" for a resolved situation, e.g. "@callerRole=THIRD_PARTY". Defaults to [concept]. */
  requires?: string[];
  members?: ConflictMember[];
  /** owner exception to conflictPolicy: always show this conflict side by side, whatever the revision dates */
  keepSideBySide?: boolean;
}
export interface Classification { a: string; b: string; classification: "A4" | "NOT_A_CONFLICT"; decidedBy: string; reason: string }
export interface Advisory { source: string; note: string }
export interface CorpusInput {
  program: string; knowledgeVersion: string; defaultSeason: string;
  owners: { id: string; role: string; date: string }[];
  sources: SourceInput[]; conflictGroups: ConflictGroup[]; classifications?: Classification[];
  advisories?: Advisory[]; skipped?: { file: string; reason: string }[]; _notice?: string;
  /** role -> job-aid folders (content/real/roles.json). When present, each role searches only its folders. */
  roles?: RoleDef[];
  /** owner decision for open conflicts: "newest-revision" shows the most recently revised job aid instead of "Sources disagree" */
  conflictPolicy?: ConflictPolicy;
  quickAnswers?: QuickAnswerSettings;
  /** ranking adjustments: passages of a source (optionally only those containing text) score x factor, unless the question uses one of `unless` */
  rankAdjust?: { source: string; contains?: string; factor: number; unless?: string[]; reason?: string }[];
  /** search aliases: how agents phrase questions this job aid answers (search keys only, never shown as guidance) */
  aliases?: { source: string; phrases: string[] }[];
}

export interface FacetDef { label: string; values: Record<string, { label: string; cues: string[]; implies?: string[] }> }
export interface ConceptDef {
  id: string; label: string; ruleFacets: FacetName[]; risk: string; terms: string[]; expand: string[];
  /** auto-tagging: passages whose text contains any of these phrases, or whose source title contains any titleMatch */
  passageTerms?: string[]; titleMatch?: string[]; autoTitle?: boolean;
  /** auto-title concepts: content words of the title; matched when most of them appear in the question */
  titleWords?: string[];
  /** auto-title concepts: title words no other job-aid title uses (one is enough to match) */
  titleKeys?: string[];
  /** job-aid titles that best answer this topic (ranked slightly higher when the topic is asked) */
  prefer?: string[];
  /** broad topic (e.g. "enroll"): ignored for topic coverage when a more specific topic is also asked */
  generic?: boolean;
  /** describes who the caller is (retiree, survivor): on its own it never makes the question an affiliation question when another topic is asked */
  describesCaller?: boolean;
  /** a negation right before a term ("no divorce") cancels this topic; by default negation never removes a topic */
  negatable?: boolean;
  /** word sense: drop this topic when any of these topics is also asked ("hold" next to a payment topic is a payment hold),
   *  unless the question also uses one of `unlessTerms` ("on hold", "caller") */
  suppressWith?: string[]; unlessTerms?: string[];
  /** two-signal rule: a term from every group within `window` words (default 8) also triggers the topic */
  allOf?: string[][]; window?: number;
  /** when this topic is asked, passages containing any of these texts rank lower (e.g. "no additional security is needed" for calls from outside organizations) */
  demoteText?: string[];
  /** phrases that must NOT trigger this concept (e.g. "dead air" for DEATH_REPORT) */
  blockPhrases?: string[];
}
export interface VocabInput {
  facets: Record<FacetName, FacetDef>; concepts: ConceptDef[]; acronyms: Record<string, string>;
  /** phrases that never count as a situation cue (e.g. "fed up", "postal code") */
  cueBlockPhrases?: string[];
  ambiguityCues: { id: string; pattern: string; unlessFollowedBy: string[]; note: string; suppressIfResolved?: FacetName }[];
  fillers: string[]; stopwords: string[]; protected: string[]; autoTitleConcepts?: boolean;
  /** word -> words the job aids use for the same thing (added to the search at lower weight) */
  synonyms?: Record<string, string[]>;
}

/** A passage as indexed: one content unit on one slide, carrying its source's identity and authority. */
export interface Passage {
  id: string; sourceId: string; sourceTitle: string; printedRevision: string; sourceSha256: string;
  slide: number; slideTitle: string; unit: number; heading: string; text: string; conditions: string[];
  concepts: string[]; facets: FacetMap; numeric: NumericCondition[]; conflictGroups: string[]; riskCategory: string;
  approval: Approval; advisory?: string; transcribed?: boolean; folders?: string[];
  /** owner/overlay ranking adjustment (e.g. 0.8 for an older duplicate version); 1 when absent */
  rankFactor?: number; rankUnless?: string[];
}
export interface SourceRecord {
  id: string; title: string; printedRevision: string; approval: Approval; approvalRecord?: string;
  lifecycle: Lifecycle; supersededBy?: string; riskCategory: string; sha256: string;
  slides: { n: number; title: string; image: string | null; transcribed?: boolean }[]; indexed: boolean; exclusionReason?: string;
  file?: string; format?: string; advisory?: string; folders?: string[];
}
export interface KnowledgeBase {
  /** job-aid title -> agent phrasings (search keys only) */
  aliases?: Record<string, string>;
  program: string; knowledgeVersion: string; defaultSeason: string; notice?: string;
  sources: SourceRecord[]; passages: Passage[]; conflictGroups: ConflictGroup[]; vocab: VocabInput;
  warnings: string[];
  roles?: RoleDef[];
  conflictPolicy?: ConflictPolicy;
  quickAnswers?: QuickAnswerSettings;
}

export interface Profile { audience: string; season: string }

export type Outcome = "ANSWER" | "CLARIFY" | "CONFLICT" | "WEAK" | "NO_ANSWER";
export type Band = "Strong match" | "Related guidance" | "Possible match";

export interface Citation { sourceId: string; sourceTitle: string; printedRevision: string; slide: number; unit: number; sha256: string; knowledgeVersion: string }
export interface Result {
  passage: Passage; band: Band; score: number; citation: Citation; appliesTo: string;
  why: { matchedTerms: string[]; concepts: string[]; libScore: number; facetFit: string };
  numericNotes: string[];
  /** open conflicts this passage belongs to that are NOT about the current question (shown as a caution) */
  otherConflicts: string[];
}
export interface Group { facet?: FacetName; value?: string; label: string; results: Result[] }
export interface SearchResponse {
  query: string; normalized: string; corrections: { from: string; to: string }[]; expansions: string[];
  concepts: string[]; resolvedFacets: Partial<Record<FacetName, string>>; contradictoryFacets: FacetName[];
  unresolvedFacet?: FacetName; outcome: Outcome; notes: string[];
  results: Result[]; groups: Group[]; conflict?: { groupId: string; note: string; results: Result[] };
  differentSituation: Result[]; suggestions: string[];
  quickAnswer?: QuickAnswer;
}
