import type { TimesheetsApi } from "./types";

export function api(): TimesheetsApi {
  return window.timesheets;
}

/** Electron prefixes errors thrown in the main process; keep only the real message. */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}
