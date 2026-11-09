# START HERE: setting up this project from scratch

**Who this is for:** a Claude Code session, or a person, opening this project for the first time with no prior context. Follow the steps in order. Each step says how to check that it worked. Don't skip the checks. When a step needs a decision only the project owner (Jeremy) can make, stop and ask him.

---

## 0. What this project is (30-second version)

The **Knowledge Assistant** is an offline search page for BENEFEDS/FEDVIP contact-center agents. An agent types a question or describes the caller's situation. The page shows the matching **job-aid passages in their original wording**, with the slide they came from. It also offers a **response script** built only from job-aid wording. A small companion character sits in the corner.

- No AI at runtime, no server, no internet. The finished app is a folder (`dist/`); you open `dist/index.html` in Edge or Chrome.
- It's built from the **job-aid files** (PowerPoint, Word, Excel) by scripts in this project.
- **Status: preview.** Nothing is approved by the content owner yet. The app labels every result "Pending owner approval". It is **not** for agents yet.

Rules, commands and architecture: `CLAUDE.md`. Open work in priority order: `ROADMAP.md`. Human procedures: `MAINTAINING.md`.

---

## 1. What you need on the computer (Windows)

| Requirement | Version | Why | Check command (PowerShell) |
|---|---|---|---|
| **Node.js** | **22.6 or newer** (22 LTS recommended) | builds the app and runs the tests (uses `--experimental-strip-types`) | `node -v` |
| **npm** | comes with Node | installs the 4 small dependencies | `npm -v` |
| **Python** | **3.10 or newer**, standard library only, and the `python` command must work | reads the job-aid files | `python --version` |
| **Microsoft PowerPoint** (desktop) | any recent | renders slide images. **Optional:** without it, the app works but shows a note instead of slide images. | — |
| **Microsoft Edge** and/or **Google Chrome** | current | to use the app, and for the browser smoke test | — |
| **The job-aid files** | the current folder of `.pptx` / `.docx` / `.xlsx` job aids | the content | ask Jeremy where they are |

If something is missing:
- **Node.js:** install the LTS version from nodejs.org (or `winget install OpenJS.NodeJS.LTS`), then open a **new** terminal.
- **Python:** install from python.org and tick **"Add python.exe to PATH"**. If only `py` works and `python` doesn't, fix the PATH; the scripts call `python`.
- **PowerPoint:** use the organization's Office install.

> The smoke test looks for the browsers at their default locations: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` and `C:\Program Files\Google\Chrome\Application\chrome.exe`. If they're installed elsewhere, change the `BROWSERS` list in `scripts/smoke.ts`.

---

## 2. Put the project in the right place

1. Unzip `Knowledge-Assistant-source-<version>.zip` into a **local folder that is NOT synced** by Google Drive, OneDrive or Dropbox, for example:
   ```
   C:\Work\knowledge-assistant
   ```
   **Why:** sync tools corrupt `node_modules`, git data and build output. The zip in Google Drive is only the delivery copy; never work inside Drive.
2. Check that the folder contains `package.json`, `src/`, `scripts/`, `ingest/`, `content/`, `tests/`, `eval/`, `CLAUDE.md`, `ROADMAP.md`, `MAINTAINING.md` and this file.

---

## 3. Point the project at the job aids

1. Ask Jeremy where the job-aid folder is on this computer, for example `C:\Users\jeremy\Desktop\FEDVIP Job Aids`.
2. Open **`ka.config.json`** and set `jobAidsDir` to that folder. Use an absolute path with forward slashes or escaped backslashes:
   ```json
   {
     "jobAidsDir": "C:/Users/jeremy/Desktop/FEDVIP Job Aids",
     "transcriptionsDir": "content/real/transcriptions"
   }
   ```
   Leave `transcriptionsDir` as it is (it's inside the project).
3. **Check:** in PowerShell, `Test-Path "<that folder>"` returns `True`, and the folder contains `.pptx` files.

> The project already contains a **snapshot** of the job-aid content (`content/real/corpus.base.json` plus slide images). The app builds and works **before** you refresh from the job-aid folder. Step 5 confirms it.

---

## 4. Install

In a terminal inside the project folder:
```
npm ci
```
**Check:** it ends with "added N packages" and shows no errors. It creates `node_modules/`.

---

## 5. Verify the project works as delivered (before changing anything)

```
npm run build
npm test
```
**Expected:**
- `build` prints `built jobaids-preview-…: 1997 passages from 308/308 sources; 440 slide images …`.
- `test` ends with `# pass 86`, `# fail 0`, `# skipped 1`. The skipped test needs a reference folder that only exists on the original build machine; that's normal.

Then:
```
npm run score -- tests/fixtures/golden.txt --quiet
```
**Expected:** `top-3 333 (100.0%)`.

Open `dist\index.html` in Edge or Chrome and try:
- `caller wants to cancel because he retired`, then press **S** for the response script;
- `USM dependent age`, then open a result and click the slide to view it full screen.

Optional browser test (takes a few minutes):
```
npm run smoke
```
**Expected:** every line starts with `ok`. If it says "network error" or hangs, close leftover hidden browser processes (see section 9) and rerun.

**If anything in this step fails, stop.** Report the exact error to Jeremy before changing code. The delivered version passed all of these checks on 2026-11-05.

---

## 6. Refresh from the real job-aid folder (once the steps above pass)

```
npm run refresh
```
This:
1. re-reads every job aid from `jobAidsDir` (read-only);
2. re-renders slide images only for new or changed files, using PowerPoint;
3. removes images for deleted job aids;
4. builds and tests;
5. prints what was **Added / Removed / Changed** compared with the snapshot.

- If Jeremy's job-aid folder is newer than the snapshot, you'll see changes listed. Follow the hints the script prints, and see `MAINTAINING.md` §4.
- If slide rendering is blocked (no PowerPoint, or the PC doesn't allow PowerShell scripts), the app still builds. **Don't** add `-ExecutionPolicy Bypass`; tell Jeremy to ask IT.
- Without PowerPoint, run `npm run refresh -- --no-slides`.

---

## 7. Set up version control (recommended, ask Jeremy first)

There is no git history in the zip. Ask Jeremy whether to use git and where the repository should live (a local folder, or the organization's approved remote). If yes:
```
git init
git config user.name "Jeremy …"
git config user.email "…"
git add -A
git commit -m "Knowledge Assistant 0.2.0 as delivered"
```
- **Never commit or push without Jeremy's OK.** Set the identity to **his** name; don't use whatever identity happens to be configured on the machine.
- A `.gitignore` for this folder should exclude: `node_modules/`, `dist/`, `release/`, `content/real/slides/`, `*.log`. Ask Jeremy whether `content/real/corpus.base.json` (generated job-aid text) may be committed.

---

## 8. Get oriented, then start on the roadmap

1. Read `CLAUDE.md` (rules, commands, architecture), then `ROADMAP.md` (what to do next).
2. Measure the current search quality on the worklist of questions that still miss:
   ```
   npm run score -- eval/known-misses-2026-10-29.txt
   ```
3. **Ask Jeremy which roadmap item comes first.** The roadmap's top items are:
   - a double-click "Rebuild" button;
   - Docebo/SCORM delivery, which needs his decision on slide size (3200 vs 2400 px);
   - search-quality work.

---

## 9. Rules and pitfalls (read before making changes)

**Never:**
- invent or paraphrase guidance: every result and script line must be job-aid wording, with a citation;
- edit job-aid files or generated files (`content/real/corpus.base.json`, `content/real/slides/`, `dist/`, `release/`);
- add AI or cloud services to the app;
- weaken or delete the safety tests (affiliation, conflicts, safety-first, member data);
- share the app with agents or upload it to Docebo without Jeremy's approval.

**Always:**
- run `npm run check` before calling a change done;
- add a test question for every fix (`tests/fixtures/golden.txt`);
- report honest numbers: questions used for tuning overstate quality, and only fresh, unseen questions measure it.

**Pitfalls:**
- **Shell escaping.** Inline shell strings (bash heredocs, `sed`) have corrupted `\n`, `\1` and `\201C` into control characters in this project. Edit files with the editor, or write a script file.
- **Leftover hidden browsers.** If `npm run smoke` hangs or reports a network error, run this in PowerShell, then retry:
  ```powershell
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe'" | Where-Object { $_.CommandLine -match '--headless' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  ```
  This only stops the hidden test browsers, not normal browser windows.
- **Full test run** (`npm test`) takes about 1.5–2 minutes. That's normal.
- **App size.** The app is about 450 MB because slides are rendered at 3200 px for readability. `ingest/render_slides.ps1 -Width 2400` makes them smaller. To re-render everything, delete `content/real/slides/*.jpg` first, because rendering skips images that already exist.

---

## 10. Setup checklist (copy into your notes)

- [ ] Node ≥ 22.6, npm, Python ≥ 3.10 (`python` on PATH); Edge or Chrome; PowerPoint (optional)
- [ ] Project unzipped to a **non-synced** local folder
- [ ] `ka.config.json` → `jobAidsDir` set and the folder exists
- [ ] `npm ci` succeeded
- [ ] `npm run build` and `npm test` pass (86 pass, 1 skipped); golden score 100% top 3
- [ ] `dist\index.html` opens; search, response script (S) and full-screen slide work
- [ ] `npm run refresh` ran against the real job-aid folder, and the changes were reviewed
- [ ] Git set up with Jeremy's identity (if he wants it)
- [ ] Read `CLAUDE.md` and `ROADMAP.md`; asked Jeremy which roadmap item comes first
