import type { DisplayFormat } from "./types";

export const MAX_CELL_SECONDS = 24 * 3600;

export type ParseResult = { ok: true; seconds: number } | { ok: false; error: string };

/**
 * Accepts decimal hours (1.5 or 1,5), Jira style (1h 30m, 90m, 1.5h) and h:mm (1:30).
 * Empty input or 0 means "no time". The result is rounded to whole minutes.
 */
export function parseDuration(input: string): ParseResult {
  const text = String(input ?? "").trim().toLowerCase().replace(/,/g, ".");
  if (text === "" || text === "-") {
    return { ok: true, seconds: 0 };
  }

  let hours: number | null = null;

  if (/^\d*\.?\d+$/.test(text) || /^\d+\.$/.test(text)) {
    hours = Number(text);
  } else if (/^\d{1,2}:\d{2}$/.test(text)) {
    const [h, m] = text.split(":").map(Number);
    if (m < 60) hours = h + m / 60;
  } else {
    const match = /^(?:(\d*\.?\d+)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(text);
    if (match && (match[1] !== undefined || match[2] !== undefined)) {
      hours = Number(match[1] ?? 0) + Number(match[2] ?? 0) / 60;
    }
  }

  if (hours === null || !Number.isFinite(hours)) {
    return { ok: false, error: `"${input}" is not a valid time. Use 1.5, 1h 30m, 90m or 1:30.` };
  }

  const seconds = Math.round(hours * 60) * 60;
  if (seconds > MAX_CELL_SECONDS) {
    return { ok: false, error: "A day cannot have more than 24 hours on one issue." };
  }
  if (hours > 0 && seconds === 0) {
    return { ok: false, error: "The minimum worklog is 1 minute." };
  }
  return { ok: true, seconds };
}

/**
 * Decimal hours are shown with one decimal (1.5, 0.3); `decimals: 2` gives the
 * precise value used in the cell editor so an untouched edit never rounds time.
 * Time under 3 minutes rounds to 0 but is still shown as "0.0", never blank.
 */
export function formatDuration(seconds: number, format: DisplayFormat = "decimal", decimals = 1): string {
  if (!seconds) return "";
  if (format === "jira") {
    const totalMinutes = Math.round(seconds / 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ") || "0m";
  }
  const factor = 10 ** decimals;
  const hours = Math.round((seconds / 3600) * factor) / factor;
  return hours === 0 ? (0).toFixed(decimals) : String(hours);
}

const pad = (value: number) => String(value).padStart(2, "0");

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey(): string {
  return dateKey(new Date());
}

export function currentMonth(): string {
  return todayKey().slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(year, m - 1 + delta, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function monthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export interface MonthDay {
  key: string;
  day: number;
  weekday: string;
  isWeekend: boolean;
}

export function monthDays(month: string): MonthDay[] {
  const [year, m] = month.split("-").map(Number);
  const count = new Date(year, m, 0).getDate();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(year, m - 1, index + 1);
    const dow = date.getDay();
    return {
      key: dateKey(date),
      day: index + 1,
      weekday: date.toLocaleDateString("en-GB", { weekday: "short" }).slice(0, 2),
      isWeekend: dow === 0 || dow === 6
    };
  });
}
