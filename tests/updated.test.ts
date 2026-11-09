// "Updated" flag (src/engine/updated.ts) and recent searches: a job aid is flagged only when its printed date says it was
// revised or updated in the last 30 days; recent searches never keep member data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadContent } from "../scripts/build.ts";
import { scrubMemberData } from "../src/engine/analyze.ts";
import { changedOn, recentlyUpdated } from "../src/engine/updated.ts";
import { ROOT } from "./helpers.ts";

const today = new Date(2026, 10, 9); // Nov 9, 2026

test("revised or updated within 30 days is flagged with its date", () => {
  assert.equal(recentlyUpdated("Revised on 10/28/26", today), "Updated Oct 28");
  assert.equal(recentlyUpdated("Last Updated on 11/02/2026", today), "Updated Nov 2");
  assert.equal(recentlyUpdated("Updated 10.14.26", today), "Updated Oct 14");
});

test("older changes, review dates and undated job aids are not flagged", () => {
  assert.equal(recentlyUpdated("Revised on 03/10/26", today), undefined);
  assert.equal(recentlyUpdated("Reviewed on 10/26/26", today), undefined);
  assert.equal(recentlyUpdated("(no revision date printed)", today), undefined);
  assert.equal(changedOn("Reviewed 09/15/26"), undefined);
});

test("every printed revision in the real job aids parses (no flag from a misread date)", () => {
  const { corpus } = loadContent(join(ROOT, "content", "real"));
  for (const s of corpus.sources) {
    const d = changedOn(s.printedRevision);
    if (d) assert.ok(d.getFullYear() >= 2015 && d.getFullYear() <= 2030 && !Number.isNaN(d.getTime()), `${s.title}: ${s.printedRevision}`);
  }
});

test("recent searches are kept without member data", () => {
  for (const [q, gone] of [["ssn 123-45-6789 cancel dental", "6789"], ["member id BF1234567 poa fax", "1234567"], ["caller 555-123-4567 wants id card", "4567"], ["dob 04/12/1961 dependent age", "1961"]] as const) {
    assert.ok(!scrubMemberData(q).includes(gone), q);
  }
  assert.equal(scrubMemberData("dv35 vision plan"), "dv35 vision plan");
});
