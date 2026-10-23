import type { Theme } from "./types";

const darkQuery = () => window.matchMedia?.("(prefers-color-scheme: dark)");
let unsubscribe: (() => void) | null = null;

/**
 * Sets data-theme on <html>: "classic", "light" or "dark".
 * "system" follows the OS light/dark setting and keeps following it while the app runs.
 */
export function applyTheme(theme: Theme, background = "") {
  unsubscribe?.();
  unsubscribe = null;

  // A custom background replaces the theme's window and table background.
  const root = document.documentElement.style;
  if (/^#[0-9a-f]{6}$/i.test(background)) root.setProperty("--bg", background);
  else root.removeProperty("--bg");

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

/** The window/table background a theme uses when no custom colour is set (shown in the colour picker). */
export function themeBackground(theme: Theme): string {
  if (theme === "dark") return "#14171c";
  if (theme === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "#14171c";
  return "#f4f5f7";
}
