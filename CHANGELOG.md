# Changelog

Newest first. Each release says what changed for agents (search results, the page) and for maintainers (files, commands).

## Unreleased — 2026-11-06 (preview, pending content-owner approval)

**For agents (reviewers)**
- **New name: ARIA** (Agent Resource and Information Assistant) in the page title, header and Docebo course title.
- **Roles follow the job-aid folders.** L1 agent: only `L1 Job Aids`. Senior rep: `Senior Rep Job Aids` first, then `L1 Job Aids`. SME (was "Admin / SME"): `L1 Job Aids` and `SME Job Aids`. A role never sees another folder's job aids.
- Job aids in `ADMIN Only Job Aids` are not in the app.
- **Conflicting job aids: the most recently revised one is shown** (owner decision), instead of "Sources disagree". A note names the job aid it was chosen over. If no date is printed or two share the newest date, both are still shown side by side.
- **Quick answer (trial)** above the results: the one job-aid sentence or table row that answers the question, quoted word for word with its job aid and slide; phone/fax numbers, emails, time frames and ages are marked; "how do I…" questions get the job aid's numbered steps (up to 5). Shown only when the answer is clear (not when the situation must be confirmed, not above a safety procedure). Switch: `quickAnswers` in `content/real/overlay.json`.
- **This call / New call.** The caller's affiliation (set in the "This call" row, or by answering "Rules differ by affiliation") is remembered for the rest of the call and used only when rules differ by it; a note says so. **New call** clears it and the search box.
- **Pinned job aids and recent searches** appear when the search box is empty. Pin with "☆ Pin job aid" on a result or in the viewer (pins stay in this browser; a role only sees pins from its own folders). Recent searches stay in the window until it closes, are never saved, and have member data removed.
- **Quick answer highlighted on the slide text.** "Open slide" from the quick answer marks the quoted sentence, row or steps in the viewer's slide text, with a "Show it" link.
- **Job aids about all the topics of a question rank first.** "Sponsor wants to cancel their account" no longer puts an ABW payment job aid (it only mentions "cancel") above job aids about sponsors cancelling. Setting: `RANK.partialTopicFactor` (0.8; 1 turns it off). Topics that only describe the caller (widow, retiree) don't count.
- **"Updated" flag** (green) on job aids revised or updated in the last 30 days, by the printed date. "Reviewed on" dates don't count.
- Privacy incident procedures (Incident vs Breach, Incident Reporting Scenarios, QA Incident Reporting) are for senior reps only (owner decision).
- **ARIA character** (approved for the beta): the owner's ARIA artwork replaces the old companion. She blinks, glances, listens while the agent types, nods and talks when results appear, tilts her head when a question needs a choice, and looks sympathetic when nothing is found. Header: new tagline, ARIA as the heading, search box reads "Ask a question or use keywords".

**For maintainers**
- ARIA is generated from `scripts/companion/ARIA_Expression_Rig.svg` by `scripts/companion/rig_to_companion.py` (movements in `companion.tpl`; a hidden neck extension keeps the head attached when it moves). Review page: `scripts/companion/preview.html`.
- Ingest reads subfolders and records each job aid's folders; the same file in two folders is one job aid.
- New `content/real/roles.json` (role -> folders, priority folder). New `tests/roles.test.ts`.
- Removed 8 job aids no longer in the job-aid folder, and the entries that named them (two ACED Senior Rep version conflicts are gone with the old chart).
- `npm run refresh` calls `python3` on macOS/Linux.

## 0.2.0 — 2026-10-29 (preview, pending content-owner approval)

**For agents (reviewers)**
- **Response script** on every result (press **S**). Built only from job-aid wording, step by step: hold, return, the job aid's own script lines, transfer, closing. Every line is cited.
- **Safety first.** Threats, self-harm, fraud, compromised accounts and privacy incidents show their procedure first.
- **Fewer "Rules differ by affiliation" prompts.** The prompt no longer appears when the affiliation only describes the caller and the question is about something else ("retiree wants to drop his vision").
- **Better results:**
  - All 306 job aids are covered (one test question each).
  - On new, unseen agent questions, the right job aid is in the top 3 for 70% (57% first). It was 61% (42% first) at the first independent test.
  - The ACED (L1) chart rows now keep their time frame and action.
  - Long passages are split into sections.

**For maintainers**
- `npm run refresh`: re-reads the job aids, re-renders changed slides, removes stale images, builds, tests, and reports added, removed and changed job aids.
- `npm run package`: creates the app zip and the source zip in `release/`.
- `npm run probe -- "question"`: tries a question from the terminal.
- New files:
  - `ka.config.json` (job-aid folder location);
  - `content/real/aliases.json` (agent phrasings per job aid);
  - `content/real/transcriptions/` (text of image-only slides);
  - `ingest/office_extract.py` (the project no longer depends on folders outside it).
- All ranking settings are in `RANK` (`src/engine/search.ts`). The coverage floor test stops changes that make search worse.
- `MAINTAINING.md` (procedures), `CLAUDE.md` (rules for Claude Code), `ROADMAP.md` (open work) added.
- `npm run score -- <file>`: measures top-1 and top-3 accuracy on a question file. The latest holdout misses are in `eval/known-misses-2026-10-29.txt`.
- Slide images are re-rendered at 3200 px (JPEG quality 92), and the viewer opens slides full screen with zoom.

## 0.1.0 — 2026-10-27
- First preview on the real job aids: search, affiliation handling, known conflicts, slide viewer, offline build.
