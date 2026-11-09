// Regression: free-form agent phrasings (narratives, slang, fragments, rambling, negation, reversed word order)
// must lead to the job-aid wording that answers them. Questions come from tester agents; expected texts are verbatim
// job-aid wording (tests/fixtures/sentences.txt). "Found" means: in the conflict, a clarify group or the top 5 results,
// or on the same slide as one of the first 3 shown passages (the viewer opens that slide).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContent } from "../scripts/build.ts";
import { buildKnowledge } from "../src/build/knowledge.ts";
import { createEngine, roleThatSees, search } from "../src/engine/search.ts";
import type { Profile, Result } from "../src/engine/types.ts";
import { ROOT } from "./helpers.ts";

const { corpus, vocab } = loadContent(join(ROOT, "content", "real"));
const kb = buildKnowledge(corpus, vocab, { imageExt: ".jpg" });
const engine = createEngine(kb);
const L1: Profile = { audience: "L1", season: "STEADY_STATE" };
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
const lines = readFileSync(join(ROOT, "tests", "fixtures", "sentences.txt"), "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));

test("free-form phrasings find the job-aid wording that answers them", () => {
  const failed: string[] = [];
  for (const l of lines) {
    const [id, style, q, ...expected] = l.split("|");
    const has = (text: string) => expected.some((e) => norm(text).includes(norm(e)));
    // Search quality, not access (tests/roles.test.ts covers access): asked as L1, then as the other roles; found by any
    // role counts, since the answering job aid may be in the Senior Rep or SME folder.
    const found = (audience: string) => {
      const r = search(engine, q!, { ...L1, audience });
      const shown: Result[] = [...(r.conflict?.results ?? []), ...r.groups.flatMap((g) => g.results), ...r.results.slice(0, 5)];
      const firstThree = [...(r.conflict?.results ?? []), ...r.groups.flatMap((g) => g.results), ...r.results].slice(0, 3);
      const onSlide = firstThree.some((x) => kb.passages.some((p) => p.sourceId === x.passage.sourceId && p.slide === x.passage.slide && has(p.text)));
      return { ok: shown.some((x) => has(x.passage.text)) || onSlide, why: `${r.outcome}: ${firstThree.map((x) => x.passage.sourceTitle).join("; ")}` };
    };
    const tries = ["L1", ...(kb.roles ?? []).map((x) => x.id).filter((x) => x !== "L1")].map(found);
    if (!tries.some((t) => t.ok)) failed.push(`${id} [${style}] ${q} -> ${tries[0]!.why}`);
  }
  assert.ok(lines.length >= 130, `${lines.length} phrasings`);
  assert.deepEqual(failed, [], `${failed.length}/${lines.length} phrasings missed`);
});

test("swarm-tested questions keep reaching the expected job aid (any role and season)", () => {
  const rows = readFileSync(join(ROOT, "tests", "fixtures", "swarm.txt"), "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  const failed: string[] = [];
  for (const l of rows) {
    const [audience, season, q, want] = l.split("|");
    const wants = want!.split("~").map((w) => { const [title, slide] = w.split("#"); return { title, slide: slide ? Number(slide) : undefined }; });
    const role = roleThatSees(kb, audience!, wants.map((w) => w.title!));
    if (!role) { failed.push(`${q} -> no role can see ${want}`); continue; }
    const r = search(engine, q!, { audience: role, season: season! });
    const first = [...(r.conflict?.results ?? []), ...r.groups.flatMap((g) => g.results), ...r.results].slice(0, 3);
    if (!first.some((x) => wants.some((w) => w.title === x.passage.sourceTitle && (w.slide === undefined || w.slide === x.passage.slide))))
      failed.push(`${q} (${audience}) -> ${r.outcome}: ${first.map((x) => `${x.passage.sourceTitle} s${x.passage.slide}`).join("; ")}`);
  }
  assert.ok(rows.length >= 50, `${rows.length} questions`);
  assert.deepEqual(failed, [], `${failed.length}/${rows.length} missed`);
});

test("member data is never echoed: SSNs, Member IDs, last four, phone numbers, birth dates", () => {
  for (const q of ["caller ssn 123-45-6789 wants to cancel dental", "member id is 12345678", "last four of ssn 6789 wants balance",
    "my number is (603) 555-1212 call me back", "dob 04/12/1961 wants to enroll", "ssn 123.45.6789 caller hung up"]) {
    const r = search(engine, q, L1);
    const echoed = JSON.stringify({ n: r.notes, q: r.normalized, c: r.corrections, e: r.expansions });
    assert.ok(!/\d{4,}|6789|1212|1961/.test(echoed), `${q} -> ${echoed}`);
    assert.ok(r.notes.some((n) => n.includes("member data")), q);
  }
});

test("safety: threats, self-harm and dropped calls route to the right procedure", () => {
  const top = (q: string) => [...r(q)].slice(0, 2).map((x) => x.passage.sourceTitle);
  const r = (q: string) => { const s = search(engine, q, L1); return [...(s.conflict?.results ?? []), ...s.groups.flatMap((g) => g.results), ...s.results]; };
  assert.ok(top("caller says he threatened to blow up the building").includes("Handling Threats and Inappropriate Behavior"));
  assert.ok(top("guy said he is going to come down there and hurt someone").includes("Handling Threats and Inappropriate Behavior"));
  assert.ok(top("guy says he's gonna end it all, he sounds serious").includes("Handling Threats and Inappropriate Behavior"));
  assert.ok(!top("call went dead on me").some((t) => /Death|Deceased/.test(t)), "a dropped call is not a death");
  const sp = r("habla espanol").slice(0, 5).map((x) => x.passage.text);
  assert.ok(sp.some((t) => t.includes("transfer to xFEDVIP Spanish")), "Spanish caller -> Spanish queue");
  assert.ok(!sp.some((t) => t.includes("language other than English or Spanish")), "not the other-language routing");
});

test("negated and idiomatic affiliation words don't set the affiliation", () => {
  assert.equal(search(engine, "caller is not federal civilian, he is army, son 22", L1).resolvedFacets.affiliation, "USM");
  assert.equal(search(engine, "usm retiree is fed up with his deductions", L1).resolvedFacets.affiliation, "USM");
  assert.equal(search(engine, "postal code for peru customer", L1).resolvedFacets.affiliation, undefined);
});

test("second swarm round: critical cases stay fixed", () => {
  const first = (q: string) => { const s = search(engine, q, L1); return [...(s.conflict?.results ?? []), ...s.groups.flatMap((g) => g.results), ...s.results]; };
  // "FEDVIP" names the program, not the caller: no affiliation, and the age limit still asks which applies
  const fv = search(engine, "how old can a kid be and stay on the fedvip plan", L1);
  assert.equal(fv.resolvedFacets.affiliation, undefined);
  assert.equal(fv.outcome, "CLARIFY");
  assert.equal(search(engine, "uniformed service member wants to cancel fedvip", L1).resolvedFacets.affiliation, "USM");
  // outside organizations are not authenticated, even if the IVR says so
  assert.equal(first("delta dental rep on the phone asking if member is still enrolled, IVR shows fully authenticated")[0]?.passage.sourceTitle, "Third Party Callers");
  // indirect self-harm language
  assert.equal(first("guy says he doesnt see the point anymore and wants to end things")[0]?.passage.sourceTitle, "Handling Threats and Inappropriate Behavior");
  // letter-prefixed member IDs are never echoed
  const id = search(engine, "member id D12345678 cancel dental", L1);
  assert.ok(!/12345678|d12345678/i.test(JSON.stringify(id.notes) + id.normalized));
  // a credit-card question is not answered with "Account Credits"
  assert.ok(!(first("customer wants to pay by credit card")[0]?.passage.text ?? "").startsWith("Account Credits"));
  // "turn on" is not "turning 21"
  assert.ok(!search(engine, "who do i call if my computer wont turn on", L1).concepts.includes("DEPENDENT_AGE_LIMIT"));
  // a USM survivor never gets the OPM-annuity survivor procedure as a Strong match
  const sv = search(engine, "husband died, she gets a survivor benefit from the navy, can she enroll", L1);
  assert.ok(!sv.results.some((r) => r.band === "Strong match" && r.passage.text.includes("Receiving an OPM Annuity")));
  // two affiliations + a dependent rule: both rules shown, nothing hidden
  assert.equal(search(engine, "hes in the army but also a federal civilian employee, which rules apply for his kid turning 21", L1).outcome, "CLARIFY");
});

test("safety first: a threat, fraud, compromised account or incident is shown first even next to another topic (holdout 10/2026)", () => {
  const first = (q: string) => { const s = search(engine, q, L1); return [...(s.conflict?.results ?? []), ...s.groups.flatMap((g) => g.results), ...s.results][0]?.passage.sourceTitle; };
  assert.equal(first("man said if his coverage gets cancelled he's going to come down there and hurt somebody"), "Handling Threats and Inappropriate Behavior");
  assert.equal(first("he got an alert someone tried to sign into his account who wasnt him"), "BENEFEDS.gov Unauthorized Login Attempt");
  assert.equal(first("caller thinks someone opened a dental plan using her late husbands identity, she doesnt want to call anyone herself"), "Reporting Suspected Fraud");
  const top3 = (q: string, audience = "L1") => { const s = search(engine, q, { ...L1, audience }); return [...(s.conflict?.results ?? []), ...s.groups.flatMap((g) => g.results), ...s.results].slice(0, 3).map((x) => x.passage.sourceTitle); };
  // Privacy incidents: owner decision 2026-11-06, the incident job aids are for Senior Reps only (Senior Rep Job Aids).
  // A senior rep gets the incident procedure first; L1 agents and SMEs never see those job aids.
  const INCIDENT = ["Incident vs Breach", "Incident Reporting Scenarios", "QA Incident Reporting"];
  const ssn = "supervisor here - how do i report that one of my agents may be sharing member SSNs";
  assert.ok(top3(ssn, "SR").some((t) => INCIDENT.includes(t)));
  for (const role of ["L1", "SME"]) assert.ok(!top3(ssn, role).some((t) => INCIDENT.includes(t)), role);
  // false triggers found by the holdout testers
  assert.equal(search(engine, "member only gets mail at a post office box", L1).resolvedFacets.affiliation, undefined);
  assert.ok(!search(engine, "she swears she had coverage last year", L1).concepts.includes("THREATS"));
});

test("a civilian question never gets a uniformed-service rule as a Strong match", () => {
  const r = search(engine, "federal civilian employee resigned, do I submit an inactivation ticket", L1);
  assert.ok(!r.results.some((x) => x.band === "Strong match" && (x.passage.facets.affiliation ?? []).includes("USM") && !(x.passage.facets.affiliation ?? []).includes("FED_CIV")));
});
