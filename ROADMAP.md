# Roadmap: open work (as of 2026-11-05)

This document lists what's left to do on the Knowledge Assistant, in priority order. Each item says why it matters, what's already in place, and where to start. Read `CLAUDE.md` first for the rules. All numbers below are from version 0.2.0.

## Where things stand

| Area | Status |
|---|---|
| Content | All 308 job-aid files ingested verbatim (1,997 passages); 14 open conflicts and 15 advisories flagged; everything pending owner approval |
| Search on **new, unseen** questions (holdout, 212 questions, 10/29) | right job aid in the top 3 for **70%**, first for **57%** (first holdout 10/28: 61% / 42%) |
| Search on questions used for tuning | golden 100% top 3; coverage (one question per job aid) 97% top 3. These overstate real quality. |
| Safety | affiliation, conflicts, safety-first, member data: all enforced by tests |
| Features | search, affiliation prompt, conflict cards, slide viewer with full-screen zoom (3200 px), response scripts (S), role and season switches, companion |
| Tests | 87 (type check, unit, real content, coverage floor 92% / 66%, browser smoke) |

## 1. "Rebuild" button for the maintainer (high priority)
**Goal:** keep the job aids in a desktop folder, double-click "Rebuild Knowledge Assistant", and everything refreshes from the updated files.
- **Already exists:** `npm run refresh` does all of it: reads every job aid read-only, re-renders slides only for changed files, removes stale images, builds, tests, and reports added, removed and changed job aids.
- **To do:** a double-clickable wrapper (`Rebuild Knowledge Assistant.cmd`). On first run it asks for the job-aid folder (Windows folder picker) and saves it to `ka.config.json`. It runs `npm install` if `node_modules` is missing, runs `npm run refresh`, opens `dist/index.html`, and shows the "what changed" summary in a readable window.
- **Constraints:** needs Node 22+, Python 3.10+ and PowerPoint, installed once. Don't bypass the PowerShell execution policy. If slide rendering is blocked, the app still builds and shows a note in place of the slide.
- **Rejected alternative:** scraping in the browser (pick a folder on the page, no installs). Browsers can't render PowerPoint slides, so there would be no slide images. Revisit only if installs are impossible.

## 2. Docebo / SCORM delivery (high priority, owner go-ahead needed)
- **Plan:** a launch-only SCORM package that opens the offline app inside Docebo. There's no tracking beyond launch and complete. The SCORM 2004 packager and mock LMS from earlier work are in the BENEFEDS workspace (`_scorm_manager/`); bring them over or reuse the approach.
- **Size:** the app is about 450 MB because of the 3200 px slides. Check Docebo's upload limit. `render_slides.ps1 -Width 2400` roughly halves the size and stays readable. **Decision needed:** 3200 or 2400 for Docebo.
- **Approval:** content must be approved before agents use it. The approval mechanism exists (`approval: "approved"` plus an owner record in the corpus `owners`). Today every source is `pending`, and the app labels results that way.

## 3. Search quality: "the scorer" work (ongoing)
**How to measure honestly:**
- `npm run score -- <file>` reports top-1 and top-3 accuracy and lists every miss.
- A **holdout** is a fresh set of realistic agent questions that were never used for tuning. Write them from the job aids in agents' own words, avoiding wording in `tests/fixtures/*` and `content/real/aliases.json`, and score them before changing anything. Use 150–200 questions spread across all job aids.
- **Never tune on a holdout and then report it.** After using one to fix things, it becomes training data, and the next measurement needs a new holdout.

**Current worklist:** `eval/known-misses-2026-10-29.txt` has the 69 holdout questions that missed (62 still miss today). They fall into these groups:
| Group | Example | Likely fix |
|---|---|---|
| AWD how-to wording | "hook a fax to the work item", "drag my AWD panels back" | aliases or topic terms for AWD Attachments, AWD Cards |
| Outcome named, not topic | "paid leave pending an investigation" → Administrative Leave; "the form he sent to act for his mom got rejected" → ADI Denial Letters | aliases; topic terms |
| Near-neighbour job aids | Carrier Emergency Update vs AWD Enrollment Verification; CSS Agency Name Change vs the AWD ticket | `prefer`, `rankAdjust`, or a content-owner merge |
| Agent-side tools | IEX time zone, voicemail ("overnight voice messages"), Slack ("floor support chat app") | aliases |
| No topic at all | plain-language questions that return no answer | aliases; the fallback in `search.ts` |

**Biggest single lever:** real agent questions. Once a pilot group uses the tool, collect the questions they type (without member data) and add them to `content/real/aliases.json` under the right job aid.

**Engine ideas not done yet:**
- **Near-duplicate grouping:** when two job aids cover the same thing, show the specific one first (for example, the ticket aid over the general page).
- **Split `search()` into stages**, now that settings are already in `RANK`. This makes changes safer.
- **Five job aids are still unreachable by their coverage question:**
  - 5-Day Grace Period and ACED SR v2 are hidden by the affiliation prompt;
  - ACED SR is an open conflict;
  - Call Opening Decision Tree and the Steady State QA process have wording that overlaps neighbouring job aids.

## 4. Job-aid presentation and resolution
- **Done:**
  - slides are 3200 px, JPEG quality 92, with each deck's own aspect ratio;
  - the viewer opens a slide full screen (fit or actual size, Esc to close);
  - the ACED (L1) grid chart is rebuilt row by row so every row keeps its time frame and action.
- **To do:**
  - Apply the grid rebuild (`grid_units` in `ingest/ingest_real.py`, enabled through `GRID_AIDS`) to other grid-style job aids, such as RTA Strategy for OS Admins and Premium Administration Codes. Check each one row by row before enabling it.
  - ACED (L1): rows 1–3 lack their "Want to…" label (a background shape cuts the column). Row 30 shares a text box with the footnote in the source file.
  - Docx and xlsx job aids have no slide image (5 sources). Consider rendering them to PDF or images with Word or Excel through the same read-only pattern.

## 5. Response scripts
- **Done:** the "Response script" panel (press **S**) uses verbatim job-aid lines only (hold, return, the answer lines, transfer, closing), each cited.
- **Open:**
  - Only 99 passages contain caller-facing scripting. Where a job aid has none, the panel says so. Content owners could add approved scripting to job aids, and the panel picks it up automatically.
  - The return-from-hold line uses the job aid's example name "Mrs. Jones" (labelled "use the caller's name").

## 6. Content-owner decisions (not code; the tool flags these until resolved)
- **14 open conflicts** in `content/real/overlay.json` (`conflictGroups`):
  - security pieces when a death is reported;
  - third-party ACH;
  - outbound-call security;
  - the two Senior Rep ACED versions (two groups);
  - hold check-back (2 vs 4 minutes);
  - QA scoring of comments;
  - USM ISS DEERS;
  - workforce reinstatement;
  - Spanish ABW (single vs recurring withdrawal);
  - ISS approval email;
  - PAT email;
  - ACW target (30 seconds vs 1:45);
  - where a divorce decree goes.

  When the owner decides, the job aid is fixed and the group is deleted.
- **15 advisories:**
  - outdated dates: 2025 Open Season, the March 2026 deadline, GEHA 2025;
  - misspelled ISS email;
  - "Ineligible vs Never Eligible" implying a student extension for civilians;
  - two contact-list versions with different carrier numbers;
  - Credits & Refunds giving different ACH hold days;
  - the old ACED Excel version.
- **Audience to confirm:**
  - AWD ticket aids (now visible to L1);
  - admin-titled aids;
  - CXone Softphone Changing Agent State and Unrecorded Outbound Calls (set to Senior Rep and Admin);
  - New Survivor Enrollment and Belated Enrollments (set to Senior Rep).
- **Gaps with no job aid:** card payments, legal separation, repeat callers, L1 breaks and tardiness.

## 7. Housekeeping
- **Version control:** keep the project in git, or the approved equivalent, outside OneDrive and Drive. Commit `vocab.json`, `overlay.json`, `aliases.json`, `tests/fixtures/` and the code, one change per commit. Generated files are excluded.
- **Releases:** for each release, bump `version` in `package.json`, add a `CHANGELOG.md` entry, and run `npm run package`. Share zips only.
- **Quarterly review:** check the aliases (remove retired job aids, add real agent questions) and prune resolved conflicts and advisories from the overlay.
