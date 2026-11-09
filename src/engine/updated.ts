// "Recently updated" flag: a job aid whose printed date says it was revised or updated in the last RECENT_DAYS days.
// "Reviewed on" dates are not changes (the job aid was checked, not edited), so they never raise the flag.
import { revisionDate } from "./search.ts";

export const RECENT_DAYS = 30;
const CHANGED = /\b(revised|updated)\b/i;

/** The date a job aid's content last changed, as a Date; undefined when only a review date (or no date) is printed. */
export function changedOn(printed: string): Date | undefined {
  if (!CHANGED.test(printed)) return undefined;
  const d = revisionDate(printed);
  if (!d) return undefined;
  return new Date(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100);
}

/** "Updated Oct 28" when the job aid changed within RECENT_DAYS of today (a date printed in the future counts as recent). */
export function recentlyUpdated(printed: string, today: Date = new Date()): string | undefined {
  const d = changedOn(printed);
  if (!d) return undefined;
  const days = (today.getTime() - d.getTime()) / 86400000;
  if (days > RECENT_DAYS) return undefined;
  return `Updated ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}
