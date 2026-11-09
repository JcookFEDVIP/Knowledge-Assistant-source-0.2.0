// Browser smoke test (dev tool): opens dist/index.html from disk (file://) in headless Edge and Chrome with ?q=...,
// reads the rendered page through the DevTools protocol on localhost, and checks the expected outcome UI.
// Also fails on any console error, CSP violation, or network request other than local files.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = join(ROOT, "dist", "index.html");
const BROWSERS = [
  ["Edge", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"],
  ["Chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"],
].filter(([, p]) => existsSync(p!)) as [string, string][];

const CASES: [string, RegExp[]][] = [
  ["Someone is calling about their 21 year old aging out, but their child is now full time", [/Rules differ by affiliation/, /Applies to: Federal Civilian/i, /Applies to: Uniformed Service/i, /could mean full-time student status/, /Pending owner approval/i]],
  ["USM dependent age", [/Dependent Eligibility Age 21 or 23/, /until age 21/, /Strong match/i]],
  ["daughter calling to pay her mothers bill", [/Sources disagree/, /Unresolved: confirm with your SME/]],
  ["what is the dress code for the holiday party", [/No approved guidance found for this/]],
  ["how do i do a cold tranfser", [/Cold Transfer/, /Strong match/i, /you typed tranfser/]],
  ["USM dependent age&open=1", [/Click to enlarge/, /Slide \d+ of/]],
  ["caller wants to cancel because he retired&script=1", [/Response script/, /May I place you on a brief hold/, /Is there anything else I may assist you with\?/]],
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cdp(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map<number, (v: unknown) => void>(); const events: { method: string; params: any }[] = [];
  ws.onmessage = (m) => { const msg = JSON.parse(String(m.data)); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)!(msg.result); pending.delete(msg.id); } else if (msg.method) events.push(msg); };
  const send = (method: string, params: object = {}) => new Promise<any>((res, rej) => {
    const i = ++id; const t = setTimeout(() => { pending.delete(i); rej(new Error(`${method} timed out (page hung?)`)); }, 10000);
    pending.set(i, (v) => { clearTimeout(t); res(v); }); ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { send, events, close: () => ws.close() };
}

async function runCase(exe: string, port: number, q: string) {
  const profile = mkdtempSync(join(tmpdir(), "ka-smoke-"));
  const [text, ...extra] = q.split("&"); // "question&script=1": extra test parameters pass through
  const url = `${pathToFileURL(INDEX).href}?q=${encodeURIComponent(text!)}${extra.length ? "&" + extra.join("&") : ""}`;
  const proc = spawn(exe, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  try {
    let targets: any[] = [];
    for (let i = 0; i < 40 && !targets.some((t) => t.type === "page"); i++) { await sleep(250); try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json() as any[]; } catch { /* starting */ } }
    const page = targets.find((t) => t.type === "page");
    if (!page) throw new Error("no page target");
    const c = await cdp(page.webSocketDebuggerUrl);
    await c.send("Runtime.enable"); await c.send("Log.enable"); await c.send("Network.enable");
    await c.send("Page.navigate", { url });
    for (let i = 0; i < 40; i++) { // wait for full load (all scripts, incl. the companion), up to ~8 s
      await sleep(200);
      const st = (await c.send("Runtime.evaluate", { expression: "document.readyState === 'complete' && !!document.getElementById('status')?.textContent", returnByValue: true })).result.value;
      if (st) break;
    }
    await sleep(300);
    const text = (await c.send("Runtime.evaluate", { expression: "document.body.innerText + '\\n' + (document.querySelector('.aria-companion') ? '[companion]' : '')", returnByValue: true })).result.value as string;
    const errors = c.events.filter((e) => (e.method === "Runtime.exceptionThrown") || (e.method === "Log.entryAdded" && e.params.entry.level === "error") || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error"))
      .map((e) => JSON.stringify(e.params).slice(0, 200));
    const remote = c.events.filter((e) => e.method === "Network.requestWillBeSent" && !/^(file|data|about|chrome|edge|devtools):/.test(e.params.request.url)).map((e) => e.params.request.url);
    c.close();
    return { text, errors, remote };
  } finally {
    proc.kill();
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* browser may still hold files */ }
  }
}

if (!existsSync(INDEX)) { console.error("dist/index.html missing: run npm run build"); process.exit(1); }
if (!BROWSERS.length) { console.error("No Edge/Chrome found"); process.exit(1); }
let failed = 0; let port = 9340;
for (const [name, exe] of BROWSERS) for (const [q, expects] of CASES) {
  let line: string;
  try {
    const r = await runCase(exe, port++, q);
    const missing = expects.filter((rx) => !rx.test(r.text));
    const bad = missing.length || r.errors.length || r.remote.length;
    if (bad) failed++;
    line = `${bad ? "FAIL" : "ok  "} ${name.padEnd(6)} "${q.slice(0, 58)}"` + (missing.length ? `  missing: ${missing.join(", ")}` : "") + (r.errors.length ? `  console errors: ${r.errors.join(" | ")}` : "") + (r.remote.length ? `  network: ${r.remote.join(", ")}` : "") + (r.text.includes("[companion]") ? "" : "  (companion not rendered)");
  } catch (e) { failed++; line = `FAIL ${name} "${q.slice(0, 58)}"  ${(e as Error).message}`; }
  console.log(line);
}
process.exit(failed ? 1 : 0);
