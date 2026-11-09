// The companion is decorative and isolated; the app makes no network calls and stores no search text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./helpers.ts";

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

test("engine and app code never import the companion", () => {
  for (const f of readdirSync(join(ROOT, "src", "engine"))) assert.ok(!/companion/.test(read(`src/engine/${f}`)), f);
  assert.ok(!/from\s+["'].*companion/.test(read("src/app/main.ts")));
});

test("no network APIs or external URLs in runtime code; CSP blocks connections", () => {
  for (const f of ["src/app/main.ts", "src/app/companion.ts", ...readdirSync(join(ROOT, "src", "engine")).map((x) => `src/engine/${x}`)]) {
    const s = read(f);
    assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource)\s*\(/.test(s), `${f}: no network calls`);
    assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(s), `${f}: no external URLs`);
  }
  assert.match(read("src/app/index.html"), /connect-src 'none'/);
});

test("no search text is persisted: the only storage key is the companion preference", () => {
  const s = read("src/app/main.ts");
  const keys = [...s.matchAll(/localStorage\.(?:setItem|getItem)\(\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(keys)], ["ka.companion"]);
  assert.ok(!/sessionStorage|indexedDB|document\.cookie/.test(s));
});
