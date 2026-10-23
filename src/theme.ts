import type { Theme } from "./types";

const darkQuery = () => window.matchMedia?.("(prefers-color-scheme: dark)");
let unsubscribe: (() => void) | null = null;

/**
 * Sets data-theme on <html>: "classic", "light" or "dark".
 * "system" follows the OS light/dark setting and keeps following it while the app runs.
 */
export function applyTheme(theme: Theme) {
  unsubscribe?.();
  unsubscribe = null;

  if (theme === "classic") {
    document.documentElement.dataset.theme = "classic";
    return;
  }

  const set = () => {
    const dark = theme === "dark" || (theme === "system" && Boolean(darkQuery()?.matches));
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  };
  set();

  const query = darkQuery();
  if (theme === "system" && query?.addEventListener) {
    query.addEventListener("change", set);
    unsubscribe = () => query.removeEventListener("change", set);
  }
}
