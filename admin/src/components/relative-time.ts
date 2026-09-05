const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "2 hours ago" for a timestamp the editor is judging freshness by.
 *
 * An absolute time answers "when"; the workspace asks "how stale", and a
 * relative phrase answers that without arithmetic. Anything older than a
 * week reverts to a date, where the exact day starts to matter again.
 */
export function relativeTime(
  value: string | number | null | undefined,
  now: number = Date.now(),
): string {
  if (value === null || value === undefined) {
    return "—";
  }
  const at = typeof value === "number" ? value : Date.parse(value);
  if (Number.isNaN(at)) {
    return "—";
  }
  const elapsed = now - at;
  if (elapsed < 0) {
    return "just now";
  }
  if (elapsed < MINUTE) {
    return "just now";
  }
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return `${String(minutes)} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return `${String(hours)} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  if (elapsed < 7 * DAY) {
    const days = Math.floor(elapsed / DAY);
    return `${String(days)} ${days === 1 ? "day" : "days"} ago`;
  }
  return new Date(at).toLocaleDateString();
}

/** The same instant spelled out, for a tooltip beside the relative phrase. */
export function absoluteTime(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) {
    return "Unknown";
  }
  const at = typeof value === "number" ? value : Date.parse(value);
  return Number.isNaN(at) ? "Unknown" : new Date(at).toLocaleString();
}
