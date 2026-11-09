// Build: validate content -> dist/data.js (+ data.json), slide images, bundled app.
// Default content: the real job aids (content/real). KA_CONTENT=content/synthetic builds the synthetic test fixture.
// Output works when opened directly from disk (file://) and when served over HTTPS (classic scripts, no fetch).
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildKnowledge } from "../src/build/knowledge.ts";
import type { CorpusInput, VocabInput, SourceInput } from "../src/engine/types.ts";

interface UnitFacetOverride { source: string; slide?: number; startsWith?: string; contains?: string; facets?: SourceInput["facets"]; clear?: string[]; reason?: string }
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const contentDir = resolve(ROOT, process.env.KA_CONTENT ?? join("content", "real"));

/** corpus.json (curated) or corpus.base.json (ingested) + overlay.json (known conflicts/advisories). */
export function loadContent(dir = contentDir) {
  const corpusPath = existsSync(join(dir, "corpus.json")) ? join(dir, "corpus.json") : join(dir, "corpus.base.json");
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as CorpusInput;
  corpus.conflictGroups ??= [];
  if (existsSync(join(dir, "overlay.json"))) {
    const ov = JSON.parse(readFileSync(join(dir, "overlay.json"), "utf8")) as Pick<CorpusInput, "conflictGroups" | "advisories"> & { facetOverrides?: { source: string; facets: SourceInput["facets"] }[] };
    corpus.conflictGroups = [...corpus.conflictGroups, ...(ov.conflictGroups ?? [])];
    corpus.advisories = [...(corpus.advisories ?? []), ...(ov.advisories ?? [])];
    if (existsSync(join(dir, "aliases.json"))) corpus.aliases = (JSON.parse(readFileSync(join(dir, "aliases.json"), "utf8")) as { aliases: CorpusInput["aliases"] }).aliases;
    corpus.rankAdjust = [...(corpus.rankAdjust ?? []), ...((ov as { rankAdjust?: CorpusInput["rankAdjust"] }).rankAdjust ?? [])];
    corpus.conflictPolicy = (ov as { conflictPolicy?: CorpusInput["conflictPolicy"] }).conflictPolicy;
    corpus.quickAnswers = (ov as { quickAnswers?: CorpusInput["quickAnswers"] }).quickAnswers;
    for (const fo of ov.facetOverrides ?? []) {
      const list = corpus.sources.filter((x) => x.title === fo.source); // a title can exist in two formats (.pptx and .xlsx)
      if (!list.length) throw new Error(`overlay facetOverride: unknown source "${fo.source}"`);
      for (const s of list) {
        s.facets = fo.facets; // verified per-aid correction of title-derived tags
        // The override is the verified scope for the whole job aid: unit tags for the same facets (all facets, when the
        // override is {}) no longer apply. E.g. Dual Eligibility is for everyone, whatever its first unit mentions.
        const keys = Object.keys(fo.facets);
        for (const sl of s.slides) for (const u of sl.units) if (u.facets) {
          for (const k of keys.length ? keys : Object.keys(u.facets)) delete (u.facets as Record<string, unknown>)[k];
        }
      }
    }
    // Passage-level corrections, verified against the job-aid text: set or clear facets on the units of a slide (or of the
    // whole aid) whose text starts with / contains the given text. Fails if nothing matches, so a stale entry can't hide.
    for (const uo of (ov as { unitFacetOverrides?: UnitFacetOverride[] }).unitFacetOverrides ?? []) {
      const list = corpus.sources.filter((x) => x.title === uo.source);
      if (!list.length) throw new Error(`overlay unitFacetOverride: unknown source "${uo.source}"`);
      let hits = 0;
      for (const s of list) for (const sl of s.slides) {
        if (uo.slide !== undefined && sl.n !== uo.slide) continue;
        for (const u of sl.units) {
          const t = u.text.replace(/\s+/g, " ").trim();
          if (uo.startsWith && !t.replace(/^[|\s-]+/, "").startsWith(uo.startsWith)) continue;
          if (uo.contains && !t.includes(uo.contains)) continue;
          hits++;
          const f = { ...(u.facets ?? {}) } as Record<string, unknown>;
          for (const k of uo.clear ?? []) delete f[k];
          Object.assign(f, uo.facets ?? {});
          // a cleared facet must not fall back to the aid's own tag: an empty list means "applies to all"
          for (const k of uo.clear ?? []) if (!(k in f)) f[k] = [];
          u.facets = f as SourceInput["facets"];
        }
      }
      if (!hits) throw new Error(`overlay unitFacetOverride matched nothing: ${JSON.stringify(uo)}`);
    }
  }
  if (existsSync(join(dir, "roles.json"))) corpus.roles = (JSON.parse(readFileSync(join(dir, "roles.json"), "utf8")) as { roles: CorpusInput["roles"] }).roles;
  const vocab = JSON.parse(readFileSync(join(dir, "vocab.json"), "utf8")) as VocabInput;
  return { corpus, vocab, hasImages: existsSync(join(dir, "slides")) };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function wrap(text: string, max: number): string[] {
  const out: string[] = []; let line = "";
  for (const w of text.split(" ")) { if ((line + " " + w).trim().length > max) { out.push(line.trim()); line = w; } else line += " " + w; }
  if (line.trim()) out.push(line.trim());
  return out;
}
/** Synthetic fixture only: a generated "slide image" so the viewer can be exercised without real files. */
function slideSvg(s: SourceInput, slideIdx: number): string {
  const sl = s.slides[slideIdx]!;
  let y = 196; const body: string[] = [];
  sl.units.forEach((u, i) => {
    body.push(`<g id="u${i + 1}"><text x="72" y="${y}" font-size="26" font-weight="600" fill="#1B2F66">${esc(u.heading)}</text>`); y += 38;
    for (const ln of wrap(u.text, 88)) { body.push(`<text x="72" y="${y}" font-size="22" fill="#1E2A44">${esc(ln)}</text>`); y += 32; }
    for (const c of u.conditions ?? []) for (const ln of wrap(c, 84)) { body.push(`<text x="96" y="${y}" font-size="20" font-style="italic" fill="#C8102E">${esc(ln)}</text>`); y += 30; }
    body.push(`</g>`); y += 22;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720" font-family="Segoe UI, system-ui, sans-serif">
<rect width="1280" height="720" fill="#FFFFFF"/>
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1F3B7A"/><stop offset="1" stop-color="#0D1B3E"/></linearGradient></defs>
<rect width="1280" height="118" fill="url(#g)"/><rect y="118" width="1280" height="6" fill="#C8102E"/>
<text x="72" y="52" font-size="16" letter-spacing="4" fill="#9DB6EA">SYNTHETIC JOB AID · NOT POLICY</text>
<text x="72" y="94" font-size="34" font-weight="600" fill="#FFFFFF">${esc(s.title)}</text>
<text x="72" y="164" font-size="18" fill="#56658A">${esc(sl.title)} · ${esc(s.printedRevision)}</text>
${body.join("\n")}
<text x="1208" y="700" font-size="16" text-anchor="end" fill="#56658A">Slide ${sl.n} of ${s.slides.length} · ${esc(s.id)}</text>
<text x="640" y="430" font-size="96" font-weight="900" text-anchor="middle" fill="#1B2F66" opacity="0.05" transform="rotate(-18 640 430)">SYNTHETIC</text>
</svg>`;
}

export async function runBuild(opts: { content?: string; out?: string } = {}) {
  const content = opts.content ? resolve(ROOT, opts.content) : contentDir;
  const DIST = opts.out ?? join(ROOT, "dist");
  const { corpus, vocab, hasImages } = loadContent(content);
  const kb = buildKnowledge(corpus, vocab, { imageExt: hasImages ? ".jpg" : ".svg" }); // throws ValidationError on any authority/integrity violation
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, "slides"), { recursive: true });
  // Images only for indexed sources; excluded sources ship no text and no images.
  let images = 0, missing = 0;
  for (const rec of kb.sources.filter((s) => s.indexed)) {
    const raw = corpus.sources.find((x) => x.id === rec.id)!;
    rec.slides.forEach((sl, i) => {
      if (!sl.image) return;
      if (hasImages) {
        const src = join(content, sl.image);
        if (existsSync(src)) { copyFileSync(src, join(DIST, sl.image)); images++; } else { sl.image = null; missing++; }
      } else { writeFileSync(join(DIST, sl.image), slideSvg(raw, i)); images++; }
    });
  }
  const json = JSON.stringify(kb);
  writeFileSync(join(DIST, "data.json"), json);
  writeFileSync(join(DIST, "data.js"), `/* generated by scripts/build.ts from ${JSON.stringify(corpus.program)} */\nwindow.KA_DATA=${json};\n`);
  const common = { bundle: true, format: "iife" as const, target: "es2020", minify: false, sourcemap: false, legalComments: "none" as const };
  await build({ ...common, entryPoints: [join(ROOT, "src", "app", "main.ts")], outfile: join(DIST, "app.js") });
  await build({ ...common, entryPoints: [join(ROOT, "src", "app", "companion.ts")], outfile: join(DIST, "companion.js") }); // separate file: isolation
  for (const f of ["index.html", "tokens.css", "app.css"]) copyFileSync(join(ROOT, "src", "app", f), join(DIST, f));
  const indexed = kb.sources.filter((s) => s.indexed).length;
  const excluded = kb.sources.filter((s) => !s.indexed);
  const byReason = new Map<string, number>();
  for (const s of excluded) byReason.set(s.exclusionReason!, (byReason.get(s.exclusionReason!) ?? 0) + 1);
  console.log(`built ${kb.knowledgeVersion}: ${kb.passages.length} passages from ${indexed}/${kb.sources.length} sources; ${images} slide images (${missing} sources without an image: Word/Excel); ` +
    `${kb.conflictGroups.length} open conflict groups; ${kb.warnings.length} warnings` + (excluded.length ? `; excluded: ${[...byReason].map(([r, n]) => `${n} (${r})`).join(", ")}` : ""));
  for (const r of kb.roles ?? []) console.log(`  role ${r.id}: ${kb.sources.filter((s) => s.indexed && (s.folders ?? [""]).some((f) => r.folders.includes(f))).length} job aids from ${r.folders.join(" + ")}${r.priority ? ` (first: ${r.priority})` : ""}`);
  return kb;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) runBuild().catch((e) => { console.error(e.message ?? e); process.exit(1); });
