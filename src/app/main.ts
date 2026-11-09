// Browser UI for the M1 prototype. Reads window.KA_DATA (built by scripts/build.ts); all processing is local.
// The companion lives in a separate script and only receives state events, so search never depends on it.
import { createEngine, engineFor, search } from "../engine/search.ts";
import { normalize, scrubMemberData } from "../engine/analyze.ts";
import { responseScript, type ScriptLine } from "../engine/script.ts";
import { recentlyUpdated } from "../engine/updated.ts";
import type { FacetName, KnowledgeBase, Passage, Profile, QuickAnswer, Result, SearchResponse } from "../engine/types.ts";

declare global { interface Window { KA_DATA?: KnowledgeBase } }

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const emit = (state: string) => window.dispatchEvent(new CustomEvent("ka:state", { detail: state }));

const kb = window.KA_DATA;
const resultsEl = $<HTMLDivElement>("#results");
const statusEl = $<HTMLParagraphElement>("#status");
const viewer = $<HTMLElement>("#viewer");
const input = $<HTMLInputElement>("#q");

if (!kb) {
  statusEl.textContent = "Knowledge package not found. Rebuild with npm run build.";
  emit("error");
  throw new Error("KA_DATA missing");
}
const engine = createEngine(kb);
$<HTMLSpanElement>("#kv").textContent = `Knowledge ${kb.knowledgeVersion}`;
{
  const banner = $<HTMLDivElement>("#content-banner");
  const pending = kb.sources.some((s) => s.indexed && s.approval === "pending");
  banner.innerHTML = /synthetic/i.test(kb.program)
    ? `<strong>Synthetic content</strong>: a fictional program for testing. Nothing here is BENEFEDS or FEDVIP policy.`
    : pending
      ? `<strong>Preview</strong>: real job-aid text, not yet approved by the content owner. Verify every answer on the slide. Internal review only, not for agents.`
      : `<strong>Approved job aids</strong> · ${esc(kb.knowledgeVersion)}`;
}

const profile: Profile = { audience: "L1", season: kb.defaultSeason };
let current: SearchResponse | undefined;
let flat: Result[] = [];
let selected = -1;
/** This call's situation (affiliation, who is calling): kept until "New call", used only when rules differ by it. */
let callFacets: Partial<Record<FacetName, string>> = {};
/** Recent searches: this window only (never saved), member data removed. */
let recent: string[] = [];
const MAX_RECENT = 8;
/** Pinned job aids (source ids): a per-browser convenience; no search text. */
const PINS_KEY = "ka.pins";
let pins: string[] = [];
try { const v = JSON.parse(localStorage.getItem(PINS_KEY) ?? "[]"); if (Array.isArray(v)) pins = v.filter((x) => typeof x === "string"); } catch { /* storage may be unavailable */ }
const savePins = () => { try { localStorage.setItem(PINS_KEY, JSON.stringify(pins)); } catch { /* not saved; pins last until the window closes */ } };
const updatedPill = (printed: string) => { const u = recentlyUpdated(printed); return u ? `<span class="pill updated" title="Changed in the last 30 days">${esc(u)}</span>` : ""; };
const pinButton = (sourceId: string) => { const on = pins.includes(sourceId); return `<button type="button" class="pin" data-source="${esc(sourceId)}" aria-pressed="${on}">${on ? "★ Pinned" : "☆ Pin job aid"}</button>`; };

function highlight(text: string, terms: string[]): string {
  let html = esc(text);
  const stems = [...new Set(terms.filter((t) => t.length >= 3))].sort((a, b) => b.length - a.length);
  if (!stems.length) return html;
  const rx = new RegExp(`\\b(${stems.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[a-z']*`, "gi");
  return html.replace(rx, (m) => `<mark>${m}</mark>`);
}
const approvalPill = (a: string) => (a === "approved" ? `<span class="pill">Approved</span>` : `<span class="pill pending">Pending owner approval</span>`);
/** Render verbatim passage text: "|"-rows become a table (first row = header), "- " lines become bullets.
 *  `answer`: quick-answer text (sentences, step lines or a table row) to mark where it appears. */
function formatText(text: string, terms: string[], answer: string[] = []): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let rows: string[][] = [];
  const marked = (s: string) => {
    const a = answer.find((x) => x && s.includes(x));
    if (!a) return highlight(s, terms);
    const i = s.indexOf(a);
    return `${highlight(s.slice(0, i), terms)}<mark class="answer">${esc(a)}</mark>${highlight(s.slice(i + a.length), terms)}`;
  };
  const answerRow = (r: string[]) => answer.includes(r.filter((c) => c).join(" | "));
  const flush = () => {
    if (!rows.length) return;
    const width = Math.max(...rows.map((r) => r.length));
    const isCaption = (r: string[]) => r.filter((c) => c.trim()).length <= 1 && width > 1;
    const caption = rows.length > 1 && isCaption(rows[0]!) ? rows.shift()!.filter((c) => c.trim()).join(" ") : "";
    const [head, ...body] = rows;
    const cell = (c: string, tag: string) => `<${tag}>${c.split(" / ").map((x) => highlight(x, terms)).join("<br>")}</${tag}>`;
    out.push(`<table class="mini">${caption ? `<caption>${highlight(caption, terms)}</caption>` : ""}<thead><tr>${head!.map((c) => cell(c, "th")).join("")}</tr></thead><tbody>${body.map((r) => `<tr${answerRow(r) ? ` class="answer"` : ""}>${r.map((c) => cell(c, "td")).join("")}</tr>`).join("")}</tbody></table>`);
    rows = [];
  };
  for (const ln of lines) {
    if (ln.trim().startsWith("|")) { rows.push(ln.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim())); continue; }
    flush();
    const t = ln.trim();
    if (!t) continue;
    out.push(/^[-•]\s/.test(t) ? `<div class="li">${marked(t.replace(/^[-•]\s*/, ""))}</div>` : `<div>${marked(t)}</div>`);
  }
  flush();
  return out.join("");
}
/** The response script panel: verbatim job-aid wording only, each line cited. */
function scriptPanel(r: Result, idx: number): string {
  if (!current) return "";
  const lines = responseScript(engine, r, current, profile);
  const body = lines.map((l: ScriptLine) => l.step === "none"
    ? `<li class="s-none"><span class="s-step">${esc(l.label)}</span>${l.label === "Internal procedure"
      ? "This job aid is an internal procedure (no caller script). Follow the steps above."
      : "This job aid has no scripted wording for this. Explain the guidance above in your own words."}</li>`
    : `<li class="s-${l.step}"><span class="s-step">${esc(l.label)}</span><q>${esc(l.text)}</q><cite>${esc(l.sourceTitle ?? "")}, slide ${l.slide}</cite></li>`).join("");
  return `<div class="script" id="script${idx}" hidden>
    <p class="script-head">Response script <span class="pill pending">Job-aid wording only · pending owner approval</span>
      <button type="button" class="copy-script" data-idx="${idx}">Copy</button></p>
    <ol>${body}</ol></div>`;
}
const scriptText = (r: Result) => current ? responseScript(engine, r, current, profile).filter((l) => l.text).map((l) => `${l.label}: ${l.text}`).join("\n") : "";
const bandClass = (b: string) => (b === "Strong match" ? "strong" : b === "Related guidance" ? "related" : "");

function card(r: Result, idx: number, terms: string[], inConflict = false): string {
  const p = r.passage;
  const conds = p.conditions.length ? `<div class="conditions"><span class="cl">Condition</span>${p.conditions.map(esc).join("<br>")}</div>` : "";
  const nums = r.numericNotes.map((n) => `<p class="numeric">${esc(n)}</p>`).join("");
  const warn = [
    ...(p.advisory ? [`Flagged: ${p.advisory}`] : []),
    ...r.otherConflicts,
  ].map((w) => `<p class="advisory">${esc(w)}</p>`).join("");
  return `<article class="card" role="option" id="r${idx}" data-idx="${idx}" aria-selected="false" tabindex="-1">
    <span class="badge" aria-hidden="true">${idx + 1}</span>
    <div>
      <p class="card-title">${esc(p.sourceTitle)}</p>
      <p class="card-heading">${esc(p.heading)} · Slide ${p.slide}</p>
      <div class="card-text">${formatText(p.text, terms)}</div>${conds}${nums}${warn}
      <div class="pills">${inConflict ? `<span class="pill conflict">Unresolved conflict</span>` : `<span class="pill ${bandClass(r.band)}">${esc(r.band)}</span>`}<span class="pill">Job aid</span>${approvalPill(p.approval)}${p.transcribed ? `<span class="pill">Transcribed from image</span>` : ""}${updatedPill(p.printedRevision)}<span class="pill">${esc(p.printedRevision)}</span><span class="pill applies">Applies to: ${esc(r.appliesTo)}</span></div>
      <button type="button" class="script-btn" data-idx="${idx}" aria-expanded="false">Response script (S)</button> ${pinButton(p.sourceId)}
      ${scriptPanel(r, idx)}
      <div class="why" hidden><strong>Why this result:</strong> matched terms ${esc(r.why.matchedTerms.join(", ") || "none (concept match)")} · concepts ${esc(r.why.concepts.join(", ") || "none")} · library score ${r.why.libScore} · ${esc(r.why.facetFit)} · rank score ${(r.score / 1e6).toFixed(3)}</div>
    </div></article>`;
}

/** Quick answer: one verbatim sentence (or table row) from a top result, with its source; the fact it states is marked. */
function quickAnswerBox(qa: QuickAnswer): string {
  let text = qa.steps ? qa.steps.map((l) => `<span class="quick-step">${esc(l)}</span>`).join("") : esc(qa.text);
  if (qa.value) text = text.replace(esc(qa.value), `<strong>${esc(qa.value)}</strong>`);
  if (qa.moreSteps) text += `<span class="quick-more">${qa.moreSteps} more step${qa.moreSteps === 1 ? "" : "s"} on the slide</span>`;
  return `<section class="quick" aria-label="Quick answer">
    <p class="quick-label">Quick answer <span>· quoted from the job aid</span></p>
    <blockquote class="quick-text">${text}</blockquote>
    <p class="quick-cite">${esc(qa.sourceTitle)} · slide ${qa.slide} · ${esc(qa.printedRevision)} ${updatedPill(qa.printedRevision)} · <button type="button" class="linklike quick-open" data-passage="${esc(qa.passageId)}">Open slide</button></p>
    ${qa.hasConditions ? `<p class="quick-warn">This passage has a note or exception. Read the full passage before answering.</p>` : ""}
  </section>`;
}

function render(res: SearchResponse) {
  current = res; flat = []; selected = -1;
  const terms = [...new Set([...res.normalized.split(" "), ...res.expansions].map((t) => engine.processTerm(t) ?? "").filter(Boolean))];
  const parts: string[] = [];
  const add = (list: Result[], inConflict = false) => { const start = flat.length; flat.push(...list); return `<div class="cards" role="listbox">${list.map((r, i) => card(r, start + i, terms, inConflict)).join("")}</div>`; };
  if (res.quickAnswer) parts.push(quickAnswerBox(res.quickAnswer));
  for (const n of res.notes) parts.push(`<div class="note">${esc(n)}</div>`);

  if (res.outcome === "NO_ANSWER") {
    parts.push(`<div class="neutral"><h2>No approved guidance found for this.</h2><p>Ask your SME. The assistant only shows approved job-aid guidance and doesn't guess.</p>${res.suggestions.length ? `<p>Topics it can help with:</p><ul>${res.suggestions.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}</div>`);
  }
  if (res.outcome === "CONFLICT" && res.conflict) {
    parts.push(`<div class="critical" role="alert"><h2>Sources disagree</h2><p>${esc(res.conflict.note)}</p><p><strong>Unresolved: confirm with your SME before acting.</strong> The assistant does not pick one.</p></div>`);
    parts.push(`<div class="conflict-list">${add(res.conflict.results, true)}</div>`);
  }
  if (res.groups.length && res.unresolvedFacet) {
    const f = res.unresolvedFacet!;
    const values = Object.entries(kb!.vocab.facets[f].values);
    const chips = values.filter(([v]) => res.groups.some((g) => g.value?.split("+").includes(v)))
      .map(([v, d]) => `<button type="button" data-facet="${f}" data-value="${v}">${esc(d.label)}</button>`).join("");
    parts.push(`<div class="critical" role="alert"><h2>Rules differ by ${esc(kb!.vocab.facets[f].label.toLowerCase())}</h2><p>Confirm which applies before answering. Every applicable rule is shown below.</p><div class="facet-chips">${chips}</div></div>`);
    for (const g of res.groups) parts.push(`<div class="group"><p class="group-label">${esc(g.label)}</p>${add(g.results)}</div>`);
  }
  if (res.results.length) {
    if (res.outcome === "CLARIFY" || res.outcome === "CONFLICT") parts.push(`<p class="section-label">Related guidance</p>`);
    if (res.outcome === "WEAK") parts.push(`<div class="note">Closest guidance. It may not answer your question.</div>`);
    parts.push(add(res.results));
  }
  if (res.differentSituation.length) {
    const start = flat.length;
    flat.push(...res.differentSituation);
    parts.push(`<details class="other"><summary>Guidance for a different situation (${res.differentSituation.length})</summary><div class="cards">${res.differentSituation.map((r, i) => card(r, start + i, terms)).join("")}</div></details>`);
  }
  resultsEl.innerHTML = parts.join("");
  const fixes = res.corrections.length ? ` Showing results for <span class="fix">${esc(res.corrections.map((c) => c.to).join(", "))}</span> (you typed ${esc(res.corrections.map((c) => c.from).join(", "))}).` : "";
  const label: Record<string, string> = { ANSWER: `${res.results.length} job-aid passage${res.results.length === 1 ? "" : "s"}`, CLARIFY: "Rules differ: confirm the situation", CONFLICT: "Sources disagree", WEAK: "Closest guidance only", NO_ANSWER: "No approved guidance" };
  statusEl.innerHTML = `${esc(label[res.outcome]!)}.${fixes}`;
  emit({ ANSWER: "results", CLARIFY: "ambiguous", CONFLICT: "ambiguous", WEAK: "results", NO_ANSWER: "noresult" }[res.outcome]!);
  if (flat.length) select(0, false);
}

function run(status = "") {
  const q = input.value.trim();
  if (!q) { closeViewer(); renderHome(status); emit("ready"); return; }
  const t0 = performance.now();
  // This call's situation is applied only when the answer depends on it (rules differ, or results apply only to some
  // callers); every other search is left exactly as typed.
  let res = search(engine, q, profile);
  const applied: Partial<Record<FacetName, string>> = {};
  if (res.notes.some((n) => n.startsWith("Some results apply only to")) && Object.keys(callFacets).length) {
    Object.assign(applied, callFacets);
    res = search(engine, withFacetCues(q, applied), profile);
  }
  for (let f = res.unresolvedFacet; res.outcome === "CLARIFY" && f && callFacets[f] && !applied[f]; f = res.unresolvedFacet) {
    applied[f] = callFacets[f];
    res = search(engine, withFacetCues(q, applied), profile);
  }
  const used = (Object.entries(applied) as [FacetName, string][]).map(([f, v]) => `${kb!.vocab.facets[f].label.toLowerCase()}: ${kb!.vocab.facets[f].values[v]?.label ?? v}`);
  if (used.length) res.notes.unshift(`The answer depends on the caller. Using this call's ${used.join(", ")} (set under This call; New call clears it).`);
  res.query = q;
  render(res);
  statusEl.dataset.ms = (performance.now() - t0).toFixed(1);
}
/** A facet refines the search by adding its own cue to the query, which keeps the engine the single source of truth. */
function withFacetCues(q: string, facets: Partial<Record<FacetName, string>>): string {
  const cues = (Object.entries(facets) as [FacetName, string][]).map(([f, v]) => kb!.vocab.facets[f].values[v]?.cues[0] ?? "");
  return [q, ...cues].join(" ").trim();
}

/** "This call" row: the caller's affiliation (set here or by answering "Rules differ"), plus any other situation chosen. */
function renderCallContext() {
  const el = $<HTMLSpanElement>("#call-context");
  const aff = kb!.vocab.facets.affiliation;
  const chips = Object.entries(aff.values).map(([v, d]) => `<button type="button" class="chip-toggle" data-call="affiliation" data-value="${v}" aria-pressed="${callFacets.affiliation === v}">${esc(d.label)}</button>`);
  for (const [f, v] of Object.entries(callFacets) as [FacetName, string][]) {
    if (f !== "affiliation") chips.push(`<button type="button" class="chip-toggle" data-call="${f}" data-value="${v}" aria-pressed="true" title="Click to clear">${esc(kb!.vocab.facets[f].values[v]?.label ?? v)} ×</button>`);
  }
  el.innerHTML = chips.join("");
}

function rememberSearch(q: string) {
  const s = scrubMemberData(q).replace(/\s+/g, " ").trim();
  if (s.length < 3) return;
  const key = s.toLowerCase();
  // a longer version of a search typed a moment ago replaces it
  recent = [s, ...recent.filter((r) => r.toLowerCase() !== key && !key.startsWith(r.toLowerCase()))].slice(0, MAX_RECENT);
}

/** Empty search box: pinned job aids (only those this role can see) and this window's recent searches. */
function renderHome(status = "") {
  current = undefined; flat = []; selected = -1;
  const role = engineFor(engine, profile.audience);
  const visible = new Set([...role.byId.values()].map((p) => p.sourceId));
  const pinned = pins.map((id) => kb!.sources.find((s) => s.id === id)).filter((s) => s && visible.has(s.id));
  const parts: string[] = [];
  parts.push(`<section class="home" aria-label="Pinned job aids"><p class="section-label">Pinned job aids</p>${pinned.length
    ? `<div class="home-list">${pinned.map((s) => `<button type="button" class="home-pin" data-source="${esc(s!.id)}">${esc(s!.title)}${updatedPill(s!.printedRevision)}</button>`).join("")}</div>`
    : `<p class="home-empty">Pin the job aids you use most with <strong>☆ Pin job aid</strong> on any result. They appear here whenever the search box is empty.</p>`}</section>`);
  parts.push(`<section class="home" aria-label="Recent searches"><p class="section-label">Recent searches</p>${recent.length
    ? `<div class="home-list">${recent.map((q) => `<button type="button" class="home-recent" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>`
    : `<p class="home-empty">Your searches appear here until you close this window. They are never saved.</p>`}</section>`);
  resultsEl.innerHTML = parts.join("");
  statusEl.textContent = status;
}

function select(i: number, scroll = true) {
  if (!flat.length) return;
  selected = Math.max(0, Math.min(flat.length - 1, i));
  resultsEl.querySelectorAll(".card").forEach((el) => el.setAttribute("aria-selected", String(Number((el as HTMLElement).dataset.idx) === selected)));
  const el = document.getElementById(`r${selected}`);
  if (el && scroll) { el.closest("details")?.setAttribute("open", ""); el.scrollIntoView({ block: "nearest" }); }
}

/** Source viewer for a passage's slide. With a quick answer, its text is marked in the slide text. */
function openViewer(p: Passage, qa?: QuickAnswer) {
  if (input.value.trim()) rememberSearch(input.value);
  const answer = qa ? qa.steps ?? [qa.text] : [];
  const src = kb!.sources.find((s) => s.id === p.sourceId)!;
  const slide = src.slides.find((s) => s.n === p.slide)!;
  const units: Passage[] = kb!.passages.filter((x) => x.sourceId === p.sourceId && x.slide === p.slide);
  const terms = current ? [...new Set(current.normalized.split(" ").map((t) => engine.processTerm(t) ?? "").filter(Boolean))] : [];
  viewer.innerHTML = `<button type="button" class="close" id="close-viewer">Close (Esc)</button>
    <h2>${esc(src.title)}</h2><span class="underline" aria-hidden="true"></span>
    <p class="viewer-actions">${pinButton(src.id)} ${updatedPill(src.printedRevision)}</p>
    ${answer.length ? `<p class="answer-jump">The quick answer is highlighted in the slide text below the image. <button type="button" class="linklike" id="jump-answer">Show it</button></p>` : ""}
    <p class="stamp">Slide ${p.slide} of ${src.slides.length}: ${esc(slide.title)} · ${esc(src.printedRevision)} ·${src.approval === "approved" ? `Approved (${esc(src.approvalRecord ?? "")})` : "Pending owner approval"} · Source ${esc(src.id)} · SHA-256 ${esc(src.sha256.slice(0, 16))}… · ${esc(kb!.knowledgeVersion)}</p>
    ${src.file ? `<p class="stamp">Original file: ${esc(src.file)}</p>` : ""}
    ${src.advisory ? `<p class="advisory">Flagged: ${esc(src.advisory)}</p>` : ""}
    ${slide.image ? `<a class="zoom" href="${esc(slide.image)}" target="_blank" rel="noopener">Open slide image full size</a>
    <button type="button" class="slide-open" title="Click to view full screen"><img src="${esc(slide.image)}" alt="Slide ${p.slide} of ${esc(src.title)}"><span class="slide-hint">Click to enlarge</span></button>` : `<p class="note">${slide.transcribed ? "This text was transcribed from an image in the job aid; open the original file to verify." : `No slide image: the original is a ${esc((src.format ?? "").toUpperCase())} file. Open it to verify.`}</p>`}
    <p class="section-label">Slide text (cited passage outlined)</p>
    ${units.map((u) => `<div class="unit${u.id === p.id ? " cited" : ""}"><h3>${esc(u.heading)}</h3><div>${formatText(u.text, u.id === p.id ? terms : [], answer)}</div>${u.conditions.length ? `<div class="conditions"><span class="cl">Condition</span>${u.conditions.map(esc).join("<br>")}</div>` : ""}</div>`).join("")}`;
  viewer.hidden = false;
  document.querySelector(".layout")!.classList.add("with-viewer");
  $<HTMLButtonElement>("#close-viewer").addEventListener("click", closeViewer);
  const mark = viewer.querySelector(".answer");
  if (!mark) viewer.querySelector(".answer-jump")?.remove();
  viewer.querySelector("#jump-answer")?.addEventListener("click", () => mark?.scrollIntoView({ block: "center", behavior: "smooth" }));
  viewer.querySelector(".slide-open")?.addEventListener("click", () => openLightbox(slide.image!, `Slide ${p.slide} of ${src.title}`));
  emit("source");
}
/** Full-screen slide: fitted to the window first; click (or +/-) toggles actual size, which can be scrolled. Esc closes. */
let lightbox: HTMLDivElement | null = null;
function openLightbox(src: string, alt: string) {
  closeLightbox();
  lightbox = document.createElement("div");
  lightbox.className = "lightbox fit";
  lightbox.setAttribute("role", "dialog"); lightbox.setAttribute("aria-label", alt);
  lightbox.innerHTML = `<div class="lb-bar"><span>${esc(alt)}</span><span class="lb-help">Click the slide to zoom · Esc to close</span><button type="button" class="lb-close">Close (Esc)</button></div><div class="lb-stage"><img src="${esc(src)}" alt="${esc(alt)}"></div>`;
  document.body.appendChild(lightbox);
  lightbox.querySelector(".lb-close")!.addEventListener("click", closeLightbox);
  lightbox.querySelector(".lb-stage img")!.addEventListener("click", () => lightbox?.classList.toggle("fit"));
  (lightbox.querySelector(".lb-close") as HTMLButtonElement).focus();
}
function closeLightbox() { lightbox?.remove(); lightbox = null; }

function closeViewer() {
  viewer.hidden = true; viewer.innerHTML = "";
  document.querySelector(".layout")!.classList.remove("with-viewer");
  if (current) emit("results");
}

function toggleScript(i: number) {
  const panel = document.getElementById(`script${i}`); const btn = document.querySelector(`button.script-btn[data-idx="${i}"]`);
  if (!panel) return;
  panel.hidden = !panel.hidden; btn?.setAttribute("aria-expanded", String(!panel.hidden));
  if (!panel.hidden) select(i, false);
}

// ---------- events ----------
let timer: number | undefined;
let recentTimer: number | undefined;
const RECENT_PAUSE_MS = 2500; // a search counts as "recent" once typing pauses this long (or on Enter / opening a result)
input.addEventListener("input", () => {
  emit("typing"); window.clearTimeout(timer); timer = window.setTimeout(run, 160);
  window.clearTimeout(recentTimer); recentTimer = window.setTimeout(() => { if (input.value.trim() && flat.length) rememberSearch(input.value); }, RECENT_PAUSE_MS);
});
$<HTMLFormElement>("#search-form").addEventListener("submit", (e) => { e.preventDefault(); window.clearTimeout(timer); run(); if (input.value.trim()) rememberSearch(input.value); });
input.addEventListener("focus", () => { if (!input.value) emit("ready"); });
function togglePin(sourceId: string) {
  pins = pins.includes(sourceId) ? pins.filter((x) => x !== sourceId) : [...pins, sourceId];
  savePins();
  document.querySelectorAll<HTMLButtonElement>("button.pin").forEach((b) => { if (b.dataset.source === sourceId) b.outerHTML = pinButton(sourceId); });
}
/** Open a pinned job aid at its first slide this role can see. */
function openSource(sourceId: string) {
  const first = [...engineFor(engine, profile.audience).byId.values()].filter((p) => p.sourceId === sourceId).sort((a, b) => a.slide - b.slide || a.unit - b.unit)[0];
  if (first) openViewer(first);
}
viewer.addEventListener("click", (e) => {
  const pin = (e.target as HTMLElement).closest("button.pin") as HTMLButtonElement | null;
  if (pin) togglePin(pin.dataset.source!);
});
resultsEl.addEventListener("click", (e) => {
  const chip = (e.target as HTMLElement).closest("button[data-facet]") as HTMLButtonElement | null;
  if (chip) { callFacets[chip.dataset.facet as FacetName] = chip.dataset.value!; renderCallContext(); run(); return; }
  const pin = (e.target as HTMLElement).closest("button.pin") as HTMLButtonElement | null;
  if (pin) { togglePin(pin.dataset.source!); return; }
  const hp = (e.target as HTMLElement).closest("button.home-pin") as HTMLButtonElement | null;
  if (hp) { openSource(hp.dataset.source!); return; }
  const hr = (e.target as HTMLElement).closest("button.home-recent") as HTMLButtonElement | null;
  if (hr) { input.value = hr.dataset.q!; run(); input.focus(); return; }
  const qo = (e.target as HTMLElement).closest("button.quick-open") as HTMLButtonElement | null;
  if (qo) { const i = flat.findIndex((r) => r.passage.id === qo.dataset.passage); if (i >= 0) { select(i); openViewer(flat[i]!.passage, current?.quickAnswer); } return; }
  const copy = (e.target as HTMLElement).closest("button.copy-script") as HTMLButtonElement | null;
  if (copy) { const t = scriptText(flat[Number(copy.dataset.idx)]!); navigator.clipboard?.writeText(t).then(() => { copy.textContent = "Copied"; }, () => { copy.textContent = "Copy failed"; }); return; }
  const sb = (e.target as HTMLElement).closest("button.script-btn") as HTMLButtonElement | null;
  if (sb) { toggleScript(Number(sb.dataset.idx)); return; }
  if ((e.target as HTMLElement).closest(".script")) return; // reading or selecting script text doesn't open the viewer
  const c = (e.target as HTMLElement).closest(".card") as HTMLElement | null;
  if (c) { select(Number(c.dataset.idx)); openViewer(flat[selected]!.passage); }
});
document.querySelectorAll<HTMLButtonElement>(".profile .chip-toggle[data-facet]").forEach((b) => b.addEventListener("click", () => {
  const f = b.dataset.facet as "audience" | "season";
  profile[f] = b.dataset.value!;
  document.querySelectorAll<HTMLButtonElement>(`.profile .chip-toggle[data-facet="${f}"]`).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  run();
}));
$<HTMLSpanElement>("#call-context").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button[data-call]") as HTMLButtonElement | null;
  if (!b) return;
  const f = b.dataset.call as FacetName;
  if (callFacets[f] === b.dataset.value) delete callFacets[f]; else callFacets[f] = b.dataset.value!;
  renderCallContext(); run();
});
$<HTMLButtonElement>("#new-call").addEventListener("click", () => {
  callFacets = {}; input.value = ""; window.clearTimeout(recentTimer);
  renderCallContext(); run("New call: caller details cleared."); input.focus();
});
document.addEventListener("keydown", (e) => {
  const inField = document.activeElement === input;
  if (e.key === "/" && !inField) { e.preventDefault(); input.focus(); input.select(); return; }
  if (lightbox) {
    if (e.key === "Escape") { e.preventDefault(); closeLightbox(); }
    else if (e.key === "+" || e.key === "=") lightbox.classList.remove("fit");
    else if (e.key === "-") lightbox.classList.add("fit");
    return;
  }
  if (e.key === "Escape") { if (!viewer.hidden) closeViewer(); else { input.value = ""; run(); input.focus(); } return; }
  if (e.key === "ArrowDown") { e.preventDefault(); select(selected + 1); return; }
  if (e.key === "ArrowUp") { e.preventDefault(); select(selected - 1); return; }
  if (e.key === "Enter" && !inField && selected >= 0) { e.preventDefault(); openViewer(flat[selected]!.passage); return; }
  if (e.key === "Enter" && inField && e.altKey && selected >= 0) { e.preventDefault(); openViewer(flat[selected]!.passage); return; }
  if ((e.key === "s" || e.key === "S") && !inField && selected >= 0) { e.preventDefault(); toggleScript(selected); return; }
  if (e.key === "?" && !inField && selected >= 0) { const w = document.querySelector(`#r${selected} .why`) as HTMLElement | null; if (w) w.hidden = !w.hidden; }
});
const toggle = $<HTMLButtonElement>("#companion-toggle");
const slot = $<HTMLDivElement>("#companion");
const setCompanion = (on: boolean) => { slot.classList.toggle("off", !on); toggle.textContent = on ? "Hide ARIA" : "Show ARIA"; try { localStorage.setItem("ka.companion", on ? "on" : "off"); } catch { /* storage may be unavailable */ } };
let companionOn = true; try { companionOn = localStorage.getItem("ka.companion") !== "off"; } catch { /* ignore */ }
setCompanion(companionOn);
toggle.addEventListener("click", () => { companionOn = !companionOn; setCompanion(companionOn); });

renderCallContext();
// Optional ?q= for local testing only (never persisted).
const initial = new URLSearchParams(location.search).get("q");
if (initial) {
  input.value = initial; run();
  const qp = new URLSearchParams(location.search);
  if (qp.get("open") === "1" && flat.length) openViewer(flat[0]!.passage, current?.quickAnswer);
  if (qp.get("script") === "1" && flat.length) toggleScript(0);
} else { renderHome(); emit("idle"); }
(window as unknown as { KA_TEST?: unknown }).KA_TEST = { normalize, run: (q: string) => search(engine, q, profile) };
