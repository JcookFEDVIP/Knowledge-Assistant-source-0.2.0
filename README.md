# Knowledge Assistant: M1 prototype (real job aids, preview)

Deterministic, local search over the FEDVIP job aids. No AI, no server, no network. Every answer is the job aid's own wording, with its slide.

**Status: preview.** The content is the real job-aid text, extracted verbatim, but **no job aid has content-owner approval yet**. Every result is labeled "Pending owner approval". Internal review only; not for agents.

## Use it

Open `dist\index.html` in Chrome or Edge (double-click it).

Try:
- `Someone is calling about their 21 year old aging out, but their child is now full time`
- `USM dependent age`
- `new baby how long do they have to add`
- `daughter wants to pay her mothers bill`
- `how do i do a cold tranfser`

Keys: `/` search · `↑` `↓` move · `Enter` open source · `?` why this result · `Esc` close or clear. Set **Your role** and **Season** at the top.

## What it does

| Situation | What you see |
|---|---|
| One rule applies | Ranked passages; **Strong match / Related guidance / Possible match** |
| Rule depends on affiliation (or another situation) the question doesn't state | Red **"Rules differ by …"** card, with every version grouped ("Applies to: Federal Civilian / USPS", "Applies to: Uniformed Service", "Job aid doesn't say") |
| Job aids contradict each other (14 verified conflicts) | Red **"Sources disagree"** card, both passages shown, nothing resolved |
| Job aid flagged (outdated dates, typos) | Yellow "Flagged" line on the result |
| Nothing in the job aids covers it | **"No approved guidance found"** |
| Question uses words the job aids never mention | Never a Strong match; a note lists the words |

## Maintain it

Setting up on a new computer? Start with **[START_HERE.md](START_HERE.md)**.


See **[MAINTAINING.md](MAINTAINING.md)**: setup, adding, updating and removing job aids, fixing questions that miss, sharing a new version, and keeping it tidy.

| Command | What it does |
|---|---|
| `npm run refresh` | Re-read the job aids (folder set in `ka.config.json`), update slide images, build, test, list what changed |
| `npm run probe -- "question"` | Try a question in the terminal |
| `npm run check` | Type check, all tests, build, and browser test (Edge and Chrome) |
| `npm run package` | Create the app zip and the source zip in `release/` |

Changes are listed in [CHANGELOG.md](CHANGELOG.md).
