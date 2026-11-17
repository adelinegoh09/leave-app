const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function fmtD(n: number): string {
  return String(r2(n));
}

/** Half up: under 0.5 rounds down, 0.5 or more rounds up. Matches MOM annual-leave rounding. */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

export function validIso(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function toMs(s: string): number {
  const p = s.split("-").map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]);
}

export function toIso(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export function nice(s: string): string {
  if (!validIso(s)) return s;
  const p = s.split("-").map(Number);
  return p[2] + " " + MONTHS[p[1] - 1] + " " + p[0];
}

export function monthName(m: string): string {
  const p = m.split("-").map(Number);
  return MONTHS[p[1] - 1] + " " + p[0];
}

export function completedMonths(a: string, b: string): number {
  const x = a.split("-").map(Number);
  const y = b.split("-").map(Number);
  let m = (y[0] - x[0]) * 12 + (y[1] - x[1]);
  if (y[2] < x[2]) m -= 1;
  return Math.max(0, m);
}

export function addMonths(s: string, n: number): string {
  const p = s.split("-").map(Number);
  return toIso(Date.UTC(p[0], p[1] - 1 + n, p[2]));
}

export function addDays(s: string, n: number): string {
  return toIso(toMs(s) + n * 86400000);
}

export function datesBetween(a: string, b: string): string[] {
  const out: string[] = [];
  if (!validIso(a) || !validIso(b)) return out;
  for (let t = toMs(a); t <= toMs(b) && out.length < 800; t += 86400000) out.push(toIso(t));
  return out;
}

export function asOfDate(year: number, today: string): string {
  const todayYear = Number(today.slice(0, 4));
  if (year < todayYear) return year + "-12-31";
  if (year === todayYear) return today;
  return year + "-01-01";
}

export function singaporeToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(now);
}

export function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function asDate(iso: string): Date {
  return new Date(iso + "T00:00:00.000Z");
}

const MONTH_INDEX: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/** "20 Feb 2026, 09:12" in Asia/Singapore to an ISO timestamp. */
export function parseSgStamp(s: string): string {
  const m = s.match(/(\d{1,2}) (\w{3}) (\d{4}), (\d{2}):(\d{2})/);
  if (!m || MONTH_INDEX[m[2]] === undefined) return new Date(0).toISOString();
  const utc = Date.UTC(Number(m[3]), MONTH_INDEX[m[2]], Number(m[1]), Number(m[4]) - 8, Number(m[5]));
  return new Date(utc).toISOString();
}

export function ageOn(dob: string, on: string): number {
  const d = dob.split("-").map(Number);
  const o = on.split("-").map(Number);
  let age = o[0] - d[0];
  if (o[1] < d[1] || (o[1] === d[1] && o[2] < d[2])) age -= 1;
  return age;
}
