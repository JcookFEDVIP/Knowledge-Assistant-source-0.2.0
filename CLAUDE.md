# Knowledge Assistant: instructions for Claude Code

Offline, deterministic search over the BENEFEDS/FEDVIP job aids for contact-center agents, with a small companion character. TypeScript, MiniSearch and esbuild. There is **no AI at runtime**, no server and no network. Open `dist/index.html` in Edge or Chrome. Status: **preview**. All content is pending content-owner approval. Not for agents yet.

**New to this project or this computer? Do `START_HERE.md` first** (setup and verification). Then read `ROADMAP.md` for open work, and `MAINTAINING.md` for human procedures.

## Rules (non-negotiable)
1. **Never invent content.** Every result and every response-script line must be the job aid's own wording, cited to job aid and slide. If a job aid has no answer or script, say so. Never generate or paraphrase guidance.
2. **Never edit job-aid files** or the generated files: `content/real/corpus.base.json`, `content/real/slides/`, `dist/`, `release/`. Change the source and rebuild. If job-aid wording is wrong, the content owner fixes the file.
3. **No runtime AI, cloud search, embeddings or external APIs** in the app.
4. **Safety behaviour is protected by tests. Never weaken or delete those tests:**
   - affiliation rules (Federal Civilian vs Uniformed Service) are never shown as universal;
   - known conflicts are shown side by side and never resolved silently;
   - threats, self-harm, fraud, compromised accounts and privacy incidents show their procedure first;
   - member data (SSN, Member ID, phone number, birth date) is never echoed.
5. **Every change must pass `npm run check`** (type check, tests, build, browser test).
6. **Don't deploy or share** the app with agents, or upload it to the LMS, without the owner's go-ahead.

## Commands
| Command | Purpose |
|---|---|
| `npm install` | first time only |
| `npm run refresh` | re-read the job aids (folder in `ka.config.json`), update slides, build, test, report added/removed/changed |
| `npm run build` | build `dist/` from `content/real` |
| `npm test` | all tests (~90 s; one is skipped off the original machine) |
| `npm run check` | type check, tests, build, browser smoke test |
| `npm run probe -- "question"` | show what a question returns: topics, situation, ranked passages |
| `npm run score -- <file>` | top-1 and top-3 accuracy on a question file (`role\|season\|question\|Expected Title`) |
| `npm run package` | build the app zip and the source zip in `release/` |

Set a role or season for probe: in PowerShell, run `$env:KA_ROLE="SR"; npm run probe -- "…"` (values L1, SR or SME; KA_SEASON: STEADY_STATE or OPEN_SEASON).

**Roles are folders.** `content/real/roles.json` maps each role to job-aid subfolders (L1: `L1 Job Aids`; SR: `Senior Rep Job Aids` first, then `L1 Job Aids`; SME: `L1 Job Aids` + `SME Job Aids`). `engineFor()` in `search.ts` builds one index per role from its folders only; nothing outside them can reach that role. Job aids in no role's folder are not shipped. Whole-aid audience tags from titles/overlay are ignored when roles exist; passage-level audience tags are kept. `tests/roles.test.ts` guards this. Fixture questions are asked as a role that can see the expected job aid (`roleThatSees()`).

## Where things are
- `ingest/ingest_real.py` (+ `office_extract.py`): job-aid files → `content/real/corpus.base.json`. Passages are text blocks or table rows. It also handles grid charts (ACED L1), splits long passages and tags affiliation, role and season.
- `src/engine/analyze.ts`: the question side: normalize, member-data scrub, spelling correction (`DO_NOT_CORRECT` in `common-words.ts`), phrase matching (word forms, small gaps, negation for situation cues), topics, situation cues, ages.
- `src/engine/search.ts`: retrieval and ranking (all weights are in **`RANK`**), affiliation prompt, conflicts, safety-first pinning, fallbacks.
- `src/engine/script.ts`: response scripts (verbatim quoted lines from the job aids).
- `src/build/knowledge.ts`: validation; the build fails on a bad reference.
- `src/app/`: the page (`main.ts`, CSS, companion character).
- **Tuning data:**
  - `content/real/vocab.json`: topics (`terms`, `passageTerms`, `titleMatch`, `prefer`, `blockPhrases`, `generic`, `negatable`, `describesCaller`, `suppressWith`, `allOf` two-signal rules, `demoteText`), situation cues, synonyms, acronyms, fillers;
  - `content/real/overlay.json`: conflict groups, advisories, `facetOverrides`, `unitFacetOverrides`, `rankAdjust`;
  - `content/real/aliases.json`: agent phrasings per job aid, used as search keys only and never shown.
- **Tests:** `tests/*.test.ts`. Fixtures are in `tests/fixtures/`:
  - `golden.txt`: questions that must keep working;
  - `coverage.txt`: one question per job aid, with a ratchet floor in `coverage.test.ts`;
  - `sentences.txt` and `swarm.txt`.
- **`eval/`:** worklists and holdout results. They are not tests.

## How to improve search without making a mess
- **Measure first and last:** `npm run score -- tests/fixtures/golden.txt eval/known-misses-2026-10-29.txt`.
- **Fix with the smallest lever:** aliases → topic terms or `prefer` → overlay tag fix → engine change.
- **Never use a single generic word as a topic term.** Single words like "privacy", "swear", "turning" or "identity" trigger unrelated questions, and safety topics pin to the top, so a false trigger becomes a confident wrong answer. Use phrases.
- **After a fix:** add the question to `tests/fixtures/golden.txt`. If coverage improved, raise the floor in `tests/coverage.test.ts`.
- **Report honest numbers.** Questions you tuned on (golden, coverage, aliases) overstate quality. Only a fresh holdout of new questions measures real accuracy (see ROADMAP.md).

## Gotchas learned the hard way
- **Shell escapes.** Bash heredocs and `sed` mangled `\n`, `\1` and `\201C` several times, which put control characters into source. Write files with the editor or a Python script file, not inline shell strings. If a regex suddenly breaks, look for control characters.
- **Smoke test fails with "network error" or hangs.** Leftover headless Edge/Chrome processes are the cause. Stop the processes whose command line contains `--headless`, then rerun.
- **Don't keep the project in OneDrive or Google Drive** while working on it. Sync corrupts `node_modules`, git and builds. Work in a local folder such as `C:\Work\knowledge-assistant`.
- **PowerShell execution policy.** Slide rendering runs `ingest/render_slides.ps1`, which needs PowerPoint and permission to run scripts. Don't add `-ExecutionPolicy Bypass`; ask IT if it's blocked.
- **Slides are 3200 px (~445 MB total).** `render_slides.ps1 -Width 2400` makes them smaller. To re-render everything, delete `content/real/slides/*.jpg` first, because rendering skips images that already exist.
- **Duplicate titles** (the pptx and xlsx contact lists) share a title. Overlay entries match by title and text.
