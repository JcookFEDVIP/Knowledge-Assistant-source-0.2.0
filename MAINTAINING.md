# Maintaining the Knowledge Assistant

This guide is for the person who keeps the app current: adding, updating or removing job aids, fixing questions it can't answer, and adding features. Read sections 1–3 once. After that, use section 4 as a checklist. Open work is in `ROADMAP.md`. If you use Claude Code, it reads `CLAUDE.md` automatically.

## 1. What this is

An offline search page for agents. It shows the job aids' own wording, with the slide it came from. There's no AI, no server and no internet. Everything is in `dist/`, and you open `dist/index.html` in Edge or Chrome.

All content is **pending content-owner approval**. The app labels every result that way. It's for internal review only, not for agents yet.

## 2. One-time setup (about 15 minutes)

You need:

| Tool | Why | Check |
|---|---|---|
| **Node.js 22** or later | builds the app, runs the tests | `node -v` |
| **Python 3.10** or later | reads the job-aid files | `python --version` |
| **Microsoft PowerPoint** (desktop) | renders slide images (optional) | — |
| The **job-aid folder** (the `.pptx`/`.docx`/`.xlsx` files) | the content | — |

1. Unzip `Knowledge-Assistant-source-<version>.zip` to a folder **outside OneDrive**, for example `C:\Work\knowledge-assistant`.
2. Open **`ka.config.json`** and set `"jobAidsDir"` to the job-aid folder on your computer.
3. In a terminal in that folder, run:
   ```
   npm install
   npm run check
   ```
   `check` runs the type check, every test, the build, and a browser test in Edge and Chrome. All must pass.

## 3. How it fits together

```
job-aid files (.pptx/.docx/.xlsx)        <- the content owner's files; never edited by this project
        │  npm run refresh  (ingest/ingest_real.py, read-only)
        ▼
content/real/corpus.base.json            <- GENERATED: verbatim job-aid text. Never edit by hand.
content/real/slides/*.jpg                <- GENERATED: slide images (PowerPoint)
        +
content/real/vocab.json                  <- how agents ask: topics, words, synonyms, situation cues
content/real/overlay.json                <- known conflicts, flags, tag corrections, ranking adjustments
content/real/aliases.json                <- example agent questions per job aid (search help only)
        │  npm run build
        ▼
dist/  (index.html + data.js + slides)   <- the finished app. Never edit; rebuild it.
```

**The three rules that keep this clean:**
1. **Never edit generated files** (`corpus.base.json`, `slides/`, `dist/`). Change the source and rebuild.
2. **Never change job-aid wording here.** If a job aid is wrong, the content owner fixes the file, and you run `npm run refresh`.
3. **Every change goes through `npm run check`** before you share a build.

## 4. Common tasks

### Who sees which job aid (role folders)
The job-aid folder has one subfolder per audience. The **folder a file is in decides which roles can find it**; the role buttons on the page pick the role.

| Role (button) | Searches these folders | Ranked first |
|---|---|---|
| L1 agent | `L1 Job Aids` | — |
| Senior rep | `Senior Rep Job Aids` + `L1 Job Aids` | `Senior Rep Job Aids` |
| SME | `L1 Job Aids` + `SME Job Aids` | — |

- A role never sees a job aid outside its folders, not even as a "different situation", a conflict card or a script line.
- Files in a folder no role uses (`ADMIN Only Job Aids`), or loose in the main folder, are **left out of the app**: no text, no slide images.
- To give two roles the same job aid, put **the same file** in both folders. It counts as one job aid. Two *different* files with the same name in two folders are reported as a warning: keep one version.
- To change the folders or add a role, edit `content/real/roles.json` (folder names must match exactly), then add or rename the button in `src/app/index.html`.
- After moving files between folders, run `npm run refresh`. Slide images are kept (the file didn't change).

### Change ARIA's look (the character in the header)
ARIA is drawn from `scripts/companion/ARIA_Expression_Rig.svg`. To change her artwork, edit that file (keep the group names: `left-eye`, `right-eye`, `left-pupil`, `right-pupil`, `left-brow`, `right-brow`, `mouth`, `hair-back`, `face-and-neck`, `headset-front`), then run:
```
python3 scripts/companion/rig_to_companion.py scripts/companion/ARIA_Expression_Rig.svg scripts/companion/companion.tpl src/app/companion.ts
npm run build
```
Her movements and expressions are in `scripts/companion/companion.tpl`. Don't edit `src/app/companion.ts` by hand: it is regenerated.

### Add a new job aid, or update one
1. Put the file in the right role folder (see above). For an update, replace the old file and keep the same file name.
2. Run `npm run refresh`. It reads every job aid, re-renders slides only for new or changed files, rebuilds, runs the tests, and lists what was **Added / Removed / Changed**.
3. For each added job aid, try one question an agent would ask:
   ```
   npm run probe -- "caller wants to know how long the 24 hour rule lasts"
   ```
   If the right job aid isn't in the first 3 results, see **"A question isn't finding the right job aid"** below.
4. Add one line for the new job aid to `tests/fixtures/coverage.txt` (format: `L1|STEADY_STATE|question|Exact Job Aid Title`).

> If refresh reports that an overlay entry no longer matches, the job aid's wording changed. Open `content/real/overlay.json`, find the entry the error names, and update its `contains` text to the new wording, or remove the entry if the issue is gone.

### Remove a job aid
1. Delete the file from the job-aid folder.
2. Run `npm run refresh`. The job aid's slide images are removed automatically.
3. If the build fails, it names every entry that still mentions the removed job aid, with the file (`vocab.json` `prefer` lists, `overlay.json`, `aliases.json`). Delete those entries. Also delete its lines in `tests/fixtures/coverage.txt` and `golden.txt` (search for the title). Then run `npm run check`.

### A question isn't finding the right job aid
Try these in order, from smallest change to largest:
1. **Add agent phrasings** to `content/real/aliases.json` under that job aid's exact title. This is the safest fix: it only helps find the job aid and is never shown to agents.
2. **Add words to a topic** in `content/real/vocab.json`:
   - `terms`: phrases that mean this topic ("drop my vision" for CANCELLATION);
   - `prefer`: job aids that should rank first for the topic;
   - `blockPhrases`: phrases that must not trigger the topic ("dead air" is not a death).
3. **Correct a tag** in `content/real/overlay.json` when a job aid or passage is marked for the wrong affiliation or role (`facetOverrides`, `unitFacetOverrides`).
4. **Add the question as a test** in `tests/fixtures/golden.txt`, so it can't break again.

Always prefer a specific phrase to a single word. Single words like "privacy" or "swear" trigger on unrelated questions.

### Quick answer box (trial)
The box above the results quotes one job-aid sentence or table row (`src/engine/answer.ts`). To turn it off, set `"quickAnswers": { "facts": false, "steps": false, "sentences": false }` (or delete the line) in `content/real/overlay.json` and rebuild. `facts` covers phone/fax numbers, emails, time frames, ages and counts; `steps` gives the numbered steps for "how do I…" requests; `sentences` covers everything else. `npm run quick-eval` shows how often it appears on the test questions and prints samples to review.

### Conflicting job aids ("Job aids differ on this point")
Owner rule (`conflictPolicy` in `content/real/overlay.json`): when job aids disagree, ARIA shows the **most recently revised** one, using the printed "Revised / Reviewed / Last Updated" date, and a note names the older job aid it left out. A dated job aid beats an undated one. If none is dated, or two share the newest date, both are shown side by side ("Sources disagree").
- To keep one conflict side by side anyway (for example two language versions), add `"keepSideBySide": true` to its group in `overlay.json`.
- When a job aid is fixed so it no longer disagrees, delete its conflict group from `overlay.json`.
- Keep revision dates on job aids current: the date decides which one agents see.

### Change how results are ranked
Every weight and threshold is in **`RANK`** at the top of `src/engine/search.ts`. Change one value at a time and run `npm test`. The tests include a coverage floor (`tests/coverage.test.ts`) that fails if the change makes the library harder to search. If a change improves coverage, raise the floor.

### Add a feature
- Code: `src/engine/` (search, analysis, response scripts), `src/app/` (the page), `scripts/` (build tools).
- Add a test in `tests/` for anything that matters, especially anything safety-related.
- Run `npm run check`, add a line to `CHANGELOG.md`, and bump `"version"` in `package.json`.

## 5. Share a new version

```
npm run package
```
This runs the checks, then creates two zips in `release/`:
- **`Knowledge-Assistant-app-<version>.zip`**: the app. Unzip, then double-click `index.html`. Nothing to install. Give this to reviewers.
- **`Knowledge-Assistant-source-<version>.zip`**: everything needed to maintain it. Give this to the next maintainer.

Before each release:
- bump `"version"` in `package.json`, using 0.x.y for content changes and 0.x+1.0 for features;
- add a dated entry to `CHANGELOG.md`;
- share zips only, never loose `dist` folders, so there's one copy per version.

## 6. Keeping it tidy over time

- **Version control.** Keep the project in a git repository, or the approved equivalent. Make one change per commit with a clear message ("Add phrasings for AWD attachments", "Remove retired Workforce aid"). Commit `vocab.json`, `overlay.json`, `aliases.json`, `tests/fixtures/` and the code. Generated files (`corpus.base.json`, `slides/`, `dist/`, `release/`, `node_modules/`) are excluded by `.gitignore`.
- **Keep the project outside OneDrive.** Sync can corrupt git and build folders.
- **Prune the overlay when decisions are made.** An open conflict that has been resolved should be deleted, not left in place.
- **Don't keep copies of builds.** `release/` holds the zips; delete old ones once a newer version is shared.
- **Review the alias file quarterly.** Remove phrasings for retired job aids, and add new phrasings from real agent questions. This is the biggest single lever on search quality.
- **Run `npm run check` monthly**, even with no changes, to catch problems in the tools.

## 7. Safety rules the tests enforce (don't remove these tests)

- **Affiliation:** rules for Federal Civilian vs Uniformed Service are never shown as one universal answer.
- **Conflicts:** known conflicts between job aids are shown side by side and never silently resolved.
- **Safety procedures:** threats, self-harm, fraud, compromised accounts and privacy incidents always show their procedure first.
- **Member data:** SSNs, Member IDs, phone numbers and birth dates typed into search are ignored and never echoed back.
- **Wording:** every result and every response-script line is the job aid's own wording, with its citation.

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| `Job-aid folder not found` | Set `jobAidsDir` in `ka.config.json`. |
| Slide rendering didn't run | PowerPoint is missing, or the PC blocks PowerShell scripts. The app still works, and slides show a note. Ask IT, or run the render command refresh prints. |
| Build error naming an overlay or alias entry | That entry refers to a job aid or wording that changed or was removed. Update or delete it. |
| `npm run smoke` fails with "network error" | Leftover hidden browser windows. Close Edge/Chrome or restart, then run it again. |
| Coverage floor test fails | The last change made search worse. Undo it, or adjust it. |
