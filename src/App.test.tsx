import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createDevApi } from "./devApi";
import { currentMonth, monthDays, todayKey } from "./time";

// Pick a working day of the current month that is not in the future, so the demo has data around it.
/** The paper clip link of an issue row, e.g. "Open INT-15 in Demo Jira". */
const issueLink = (key: string) => new RegExp(`^Open ${key} in `);

function workingDayKey() {
  const days = monthDays(currentMonth()).filter((day) => !day.isWeekend && day.key <= todayKey());
  return (days[0] || monthDays(currentMonth()).find((day) => !day.isWeekend)!).key;
}

/** Runs a JQL in the search box above the table (Enter). */
async function runJql(user: ReturnType<typeof userEvent.setup>, jql: string) {
  const box = screen.getByLabelText("Jira JQL search");
  await user.clear(box);
  if (jql) await user.type(box, jql);
  await user.type(box, "{Enter}");
}

/** Working days of the current month up to today (or the first ones, early in the month). */
function workingDayKeys() {
  const all = monthDays(currentMonth()).filter((day) => !day.isWeekend);
  const past = all.filter((day) => day.key <= todayKey());
  return (past.length >= 3 ? past : all).map((day) => day.key);
}

/** The big value of a toolbar indicator, found by its caption (e.g. "Month" -> "152"). */
function indicatorValue(caption: string) {
  const indicator = [...document.querySelectorAll<HTMLElement>(".toolbar .indicator")].find(
    (item) => item.querySelector(".indicatorCaption")!.textContent === caption
  )!;
  return indicator.querySelector(".indicatorValue")!.textContent!.replace(/h$/, "");
}

function cell(rowId: string, day: string) {
  const element = document.querySelector<HTMLElement>(`[data-cell="${rowId}|${day}"]`);
  if (!element) throw new Error(`cell ${rowId}|${day} not found`);
  return element;
}

describe("Timesheet grid", () => {
  beforeEach(() => {
    // Most tests edit cells without the comment window; its own test turns it back on.
    window.timesheets = createDevApi({ askComment: false });
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("creates, updates and clears a worklog from the keyboard", async () => {
    const user = userEvent.setup();
    const api = window.timesheets;
    const create = vi.spyOn(api, "createWorklog");
    const update = vi.spyOn(api, "updateWorklog");
    const remove = vi.spyOn(api, "deleteWorklog");
    render(<App />);

    // INT-15 is always listed by the demo; add a fresh issue to get an empty row.
    await screen.findByLabelText(issueLink("INT-15"));
    // SUP-1101 has no time logged: find it with a JQL search.
    await runJql(user, "key = SUP-1101");
    await screen.findByLabelText(issueLink("SUP-1101"));

    const day = workingDayKey();
    const target = cell("main:SUP-1101", day);

    await user.click(target);
    await user.keyboard("1h 30m{Enter}");
    await waitFor(() => expect(cell("main:SUP-1101", day)).toHaveTextContent("1.5"));
    expect(create).toHaveBeenCalledWith("main", { issueKey: "SUP-1101", date: day, seconds: 5400, comment: "" });

    await user.dblClick(cell("main:SUP-1101", day));
    const editor = within(cell("main:SUP-1101", day)).getByRole("textbox");
    await user.clear(editor);
    await user.keyboard("2{Enter}");
    await waitFor(() => expect(cell("main:SUP-1101", day)).toHaveTextContent("2"));
    expect(update).toHaveBeenCalledWith("main", expect.objectContaining({ issueKey: "SUP-1101", seconds: 7200 }));

    await user.click(cell("main:SUP-1101", day));
    await user.keyboard("{Delete}");
    await waitFor(() => expect(cell("main:SUP-1101", day)).toHaveTextContent(""));
    expect(remove).toHaveBeenCalledTimes(1);
    // Each edit reached Jira exactly once (no double commit from Enter + blur).
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("keeps a worklog at 1 minute when Jira does not allow deleting it", async () => {
    window.timesheets = createDevApi({ canDeleteWorklogs: false, askComment: false });
    const user = userEvent.setup();
    const update = vi.spyOn(window.timesheets, "updateWorklog");
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    await runJql(user, "key = IMPL-330");
    await screen.findByLabelText(issueLink("IMPL-330"));

    const day = workingDayKey();
    await user.click(cell("main:IMPL-330", day));
    await user.keyboard("2{Enter}");
    await waitFor(() => expect(cell("main:IMPL-330", day)).toHaveTextContent("2"));

    await user.click(cell("main:IMPL-330", day));
    await user.keyboard("{Delete}");
    await waitFor(() => expect(cell("main:IMPL-330", day)).toHaveTextContent("0.0"));
    expect(update).toHaveBeenCalledWith("main", expect.objectContaining({ issueKey: "IMPL-330", seconds: 60 }));
    await user.click(screen.getByRole("button", { name: /activity/i }));
    expect(await screen.findByText(/kept at 1m/)).toBeInTheDocument();
    expect(screen.queryByText(/Delete Own Worklogs/)).not.toBeInTheDocument();
  });

  it("rejects invalid input without calling Jira", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(window.timesheets, "createWorklog");
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    const day = workingDayKey();
    await user.click(cell("main:INT-15", day));
    await user.keyboard("{Enter}");
    const editor = within(cell("main:INT-15", day)).getByRole("textbox");
    await user.clear(editor);
    await user.type(editor, "1x{Enter}");
    expect(await screen.findByText(/is not a valid time/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("starts with the original classic look and switches theme from Settings", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    expect(document.documentElement.dataset.theme).toBe("classic");
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(await screen.findByRole("tab", { name: "Appearance" }));
    await user.selectOptions(await screen.findByLabelText("Theme"), "dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    // Leaving without saving restores the saved theme...
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    expect(document.documentElement.dataset.theme).toBe("classic");
    // ...and saving keeps the new one.
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(await screen.findByRole("tab", { name: "Appearance" }));
    await user.selectOptions(await screen.findByLabelText("Theme"), "dark");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings saved.");
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("sorts by total time and keeps the order while editing", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    const order = () =>
      [...document.querySelectorAll("tbody td.linkCol a")].map((link) => link.getAttribute("aria-label")!.split(" ")[1]);
    const totals = () => [...document.querySelectorAll("tbody td.totalCol")].map((cell) => Number(cell.textContent || 0));
    const before = order();
    const sorted = totals();
    expect(sorted).toEqual([...sorted].sort((a, b) => b - a));

    // Add lots of time to the last row: it stays in place until the next refresh.
    const last = before[before.length - 1]!;
    const day = workingDayKey();
    const rowId = document.querySelector(`a[data-tip^="Open ${last} "]`)!.closest("tr")!.querySelector("[data-cell]")!.getAttribute("data-cell")!.split("|")[0];
    await user.click(cell(rowId, day));
    await user.keyboard("20{Enter}");
    await waitFor(() => expect(cell(rowId, day)).toHaveTextContent(/\d/));
    expect(order()).toEqual(before);

    await user.click(screen.getByRole("button", { name: /refresh/i }));
    // After Refresh the rows are re-sorted by total, so the edited row moves up.
    await waitFor(() => expect(order()).not.toEqual(before));
    expect(totals()).toEqual([...totals()].sort((a, b) => b - a));
    expect(order().indexOf(last)).toBeLessThan(before.length - 1);
  });

  it("applies the table font and size from Settings", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(await screen.findByRole("tab", { name: "Appearance" }));
    await user.selectOptions(await screen.findByLabelText("Table font"), "mono");
    await user.selectOptions(screen.getByLabelText("Table font size"), "18");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings saved.");
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    await screen.findByLabelText(issueLink("INT-15"));
    // Set on the timesheet container so the JQL search can line up with the Summary column.
    const sheet = document.querySelector<HTMLElement>("main.timesheet")!;
    expect(sheet.style.getPropertyValue("--grid-font-size")).toBe("18px");
    expect(sheet.style.getPropertyValue("--grid-font")).toMatch(/monospace/);
  });

  it("starts with regular text on white, applies a custom background, and resets to the theme default", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    expect(screen.getByRole("columnheader", { name: "Summary" })).toBeInTheDocument();
    // White comes from the Classic theme itself, not from a stored colour, so other themes keep their own.
    expect(document.documentElement.dataset.theme).toBe("classic");
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("");

    await user.click(screen.getByRole("button", { name: /settings/i }));
    expect(screen.queryByLabelText("Table text")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("tab", { name: "Appearance" }));
    const picker = screen.getByLabelText("Background colour", { selector: "input" }) as HTMLInputElement;
    fireEvent.input(picker, { target: { value: "#fdf6e3" } });
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#fdf6e3");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings saved.");
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#fdf6e3");

    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(await screen.findByRole("button", { name: "Reset" }));
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings saved.");
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("");
  });

  it("keeps the table, month and filter when coming back from Settings", async () => {
    const user = userEvent.setup();
    const fetch = vi.spyOn(window.timesheets, "fetchMonth");
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    await user.click(screen.getByRole("radio", { name: "Support" }));
    await waitFor(() => expect(screen.queryByLabelText(issueLink("INT-15"))).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await screen.findByText("Settings saved.", undefined, { timeout: 50 }).catch(() => null);
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    expect(screen.getByRole("radio", { name: "Support" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText(issueLink("SUP-1042"))).toBeInTheDocument();
    expect(screen.queryByLabelText(issueLink("INT-15"))).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("runs a JQL search as its own list, and clears back to the base list", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    await runJql(user, "project = SUP");
    // Free list: SUP issues only, including one with no time yet; logged time stays in the cells.
    await screen.findByLabelText(issueLink("SUP-1101"));
    expect(screen.queryByLabelText(issueLink("INT-15"))).not.toBeInTheDocument();
    expect(screen.getByLabelText(issueLink("SUP-1042"))).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "false");
    await user.click(screen.getByRole("button", { name: "Clear JQL search" }));
    await screen.findByLabelText(issueLink("INT-15"));
    expect(screen.queryByLabelText(issueLink("SUP-1101"))).not.toBeInTheDocument();
  });

  it("runs the typed JQL when Refresh is pressed", async () => {
    const user = userEvent.setup();
    const search = vi.spyOn(window.timesheets, "searchIssues");
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    await user.type(screen.getByLabelText("Jira JQL search"), "key = OPS-512");
    await user.click(screen.getByRole("button", { name: /refresh/i }));
    await screen.findByLabelText(issueLink("OPS-512"));
    expect(search).toHaveBeenLastCalledWith("key = OPS-512");
    expect(screen.queryByLabelText(issueLink("INT-15"))).not.toBeInTheDocument();
  });

  it("uses free filters as their own list and the All filter's JQL", async () => {
    const user = userEvent.setup();
    const api = window.timesheets;
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    // "All support" is a free filter: it lists SUP issues even without time this month.
    await user.click(screen.getByRole("radio", { name: "All support" }));
    await screen.findByLabelText(issueLink("SUP-1101"));
    expect(screen.queryByLabelText(issueLink("INT-15"))).not.toBeInTheDocument();

    // All with a narrowing JQL.
    const current = await api.loadData();
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(await screen.findByRole("tab", { name: "Filters" }));
    await user.type(await screen.findByLabelText("JQL for All"), "project = IMPL");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings saved.");
    expect((await api.loadData()).settings.allFilter).toEqual({ ...current.settings.allFilter, jql: "project = IMPL" });
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    await user.click(screen.getByRole("radio", { name: "All" }));
    await waitFor(() => expect(screen.queryByLabelText(issueLink("INT-15"))).not.toBeInTheDocument());
    expect(screen.getByLabelText(issueLink("IMPL-310"))).toBeInTheDocument();
    expect(screen.queryByLabelText(issueLink("IMPL-330"))).not.toBeInTheDocument(); // not in the base list

    // Ticking Free makes All its own list.
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(await screen.findByRole("tab", { name: "Filters" }));
    await user.click(await screen.findByLabelText("Free filter: All"));
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings saved.");
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    await screen.findByLabelText(issueLink("IMPL-330"));
  });

  it("leaves absence days out of the norm and shows them in grey", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    // The demo has 3 absence working days: CAL-101 (2 days) and CAL-102 (1 day).
    const workdays = monthDays(currentMonth()).filter((day) => !day.isWeekend);
    // "Target" = working days up to today, without absence days, × 8h.
    const normText = () => indicatorValue("Due");
    const pastDays = workdays.filter((day) => day.key <= todayKey());
    const absentPast = [6, 7, 14].filter((index) => workdays[index].key <= todayKey()).length;
    expect(normText()).toBe(String((pastDays.length - absentPast) * 8 || 0));
    expect(indicatorValue("Month")).toBe(String((workdays.length - 3) * 8));
    const vacation = workdays[6].key;
    const header = document.querySelectorAll<HTMLElement>("thead tr.dayRow th.absent");
    expect(header).toHaveLength(3);
    expect(header[0].dataset.tip).toMatch(/CAL-101 · Vacation/);
    expect(cell("main:INT-15", vacation)).toHaveClass("absent");
    // Absence days are never coloured as short days.
    expect(document.querySelectorAll("thead tr.totalsRow th.absent.under, thead tr.totalsRow th.absent.empty")).toHaveLength(0);

    // Switching absences off restores the full norm.
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(await screen.findByRole("tab", { name: "Absences" }));
    await user.click(await screen.findByLabelText("Use absences"));
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings saved.");
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    await waitFor(() => expect(normText()).toBe(String(pastDays.length * 8 || 0)));
    expect(indicatorValue("Month")).toBe(String(workdays.length * 8));
    expect(document.querySelectorAll("th.absent")).toHaveLength(0);
  });

  it("shows a cell's worklogs as a hint after 1 second", async () => {
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    const withTime = document.querySelector<HTMLElement>("td.cell[data-tip]")!;
    expect(withTime.getAttribute("title")).toBeNull();
    fireEvent.mouseOver(withTime);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(await screen.findByRole("tooltip", undefined, { timeout: 1000 })).toHaveTextContent(withTime.dataset.tip!.split("\n")[0]);
    fireEvent.mouseLeave(document.querySelector(".gridWrap")!);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("styles the selected filter like the Refresh button", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    expect(screen.getByRole("radio", { name: "All" })).toHaveClass("chip", "active");
    await user.click(screen.getByRole("radio", { name: "Support" }));
    expect(screen.getByRole("radio", { name: "Support" })).toHaveClass("active");
    expect(screen.getByRole("radio", { name: "All" })).not.toHaveClass("active");
  });

  it("shows columns as Link, Summary, Total and the issue type icon before the summary", async () => {
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    const headings = [...document.querySelectorAll("thead tr.dayRow th")].slice(0, 3);
    expect(headings.map((th) => th.getAttribute("aria-label") || th.textContent)).toEqual(["Link", "Summary", "Total"]);
    const firstRow = document.querySelector("tbody tr")!;
    expect([...firstRow.children].slice(0, 3).map((td) => td.className)).toEqual(["linkCol", "summaryCol", "totalCol"]);
    // No Key column: the key is in the link and in the summary hint.
    expect(firstRow.querySelector("td.linkCol a svg")).toBeInTheDocument();
    expect(firstRow.querySelector("td.summaryCol")!.getAttribute("data-tip")).toMatch(/^[A-Z]+-\d+ · /);
    const icon = firstRow.querySelector<HTMLImageElement>("td.summaryCol img.typeIcon")!;
    expect(icon.src).toMatch(/^data:image\/svg\+xml/);
    expect(icon.alt).toMatch(/Task|Bug|Story|Sub-task/);
  });

  it("reorders filters by drag and drop in Settings, with All kept first", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    const chips = () => screen.getAllByRole("radio").map((chip) => chip.textContent);
    expect(chips()).toEqual(["All", "Support", "Implementation", "SME", "All support"]);

    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(await screen.findByRole("tab", { name: "Filters" }));
    // Rows (after "All") stacked 40px apart: Support 0-40, Implementation 40-80, SME 80-120, All support 120-160.
    [...document.querySelectorAll<HTMLElement>("[data-filter-row]")].forEach((row, index) => {
      row.getBoundingClientRect = () => ({ top: index * 40, height: 40, bottom: index * 40 + 40, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON() {} });
    });
    // Drag "Support" to below "SME" (y 110 is in SME's lower half).
    fireEvent.pointerDown(screen.getByLabelText("Move Support"), { button: 0, clientY: 20 });
    fireEvent(window, new MouseEvent("pointermove", { clientY: 110 }));
    expect(document.querySelectorAll(".filterRow.dropBefore")).toHaveLength(1);
    fireEvent(window, new MouseEvent("pointerup", { clientY: 110 }));
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings saved.");
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    expect(chips()).toEqual(["All", "Implementation", "SME", "Support", "All support"]);
  });

  it("shows and edits the base JQL, which reloads the month", async () => {
    const user = userEvent.setup();
    const fetch = vi.spyOn(window.timesheets, "fetchMonth");
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(await screen.findByRole("tab", { name: "Filters" }));
    const field = (await screen.findByLabelText(/Base JQL/)) as HTMLInputElement;
    expect(field.value).toBe('worklogAuthor = currentUser() AND worklogDate >= "{monthStart}" AND worklogDate <= "{monthEnd}"');
    const month = currentMonth();
    expect(screen.getByText(new RegExp(`worklogDate >= "${month}-01"`))).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, "worklogAuthor = currentUser() AND project = SUP");
    expect(screen.getByRole("button", { name: "Reset base JQL" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings saved.");
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect((await window.timesheets.loadData()).settings.baseJql).toBe("worklogAuthor = currentUser() AND project = SUP");
  });

  it("shows Settings as tabs and checks for updates on the About tab", async () => {
    window.timesheets = createDevApi({ latestVersion: "0.9.0", askComment: false });
    const user = userEvent.setup();
    const open = vi.spyOn(window.timesheets, "openExternal");
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    await user.click(screen.getByRole("button", { name: /settings/i }));
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Jira sources",
      "Filters",
      "Absences",
      "Timesheet",
      "Allocation",
      "Appearance",
      "About & updates"
    ]);
    // Each tab shows only its own part.
    await user.click(screen.getByRole("tab", { name: "Absences" }));
    expect(screen.getByLabelText("Use absences")).toBeInTheDocument();
    expect(screen.queryByLabelText("JQL for All")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "About & updates" }));
    await user.click(screen.getByRole("button", { name: /check for updates/i }));
    expect(await screen.findByText("Version 0.9.0 is available.")).toBeInTheDocument();
    expect(screen.getByText(/Demo release notes/)).toBeInTheDocument();
    expect(screen.getByLabelText("Update available")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Download Timesheets-0.9.0-mac-universal.dmg/ }));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/github.com\/sava-code\/Timesheets\/releases\/download\//));
  });

  it("shows Due, Month, Left to post and Timeliness next to Refresh", async () => {
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    const indicators = [...document.querySelectorAll<HTMLElement>(".toolbar .indicator")];
    expect(indicators.map((item) => item.querySelector(".indicatorCaption")!.textContent)).toEqual([
      "Due",
      "Month",
      expect.stringMatching(/^(Left to post|Over target)$/),
      "Timeliness"
    ]);
    // Same size for all values; the plan values are grey.
    expect(indicators.every((item) => item.querySelector(".indicatorValue"))).toBe(true);
    expect(indicators[0]).toHaveClass("neutral");
    expect(indicators[1]).toHaveClass("neutral");
    // Timeliness: one of the scale levels, explained in the hint.
    expect(indicatorValue("Timeliness")).toMatch(/^(100|90|70|50|30|10)%$/);
    expect(indicators[3].title).toMatch(/how soon worklogs are posted/);
    expect(indicators[3].title).toMatch(/up to 3 working days: 100%/);
    expect(screen.queryByText("Logged")).not.toBeInTheDocument();
  });

  it("asks for a comment on new worklogs by default, never on changes, and can be switched off", async () => {
    window.timesheets = createDevApi();
    const user = userEvent.setup();
    const api = window.timesheets;
    const create = vi.spyOn(api, "createWorklog");
    const update = vi.spyOn(api, "updateWorklog");
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    await runJql(user, "key = SUP-1101");
    await screen.findByLabelText(issueLink("SUP-1101"));

    // New worklog: Save with a comment.
    const [first, second, third] = workingDayKeys();
    await user.click(cell("main:SUP-1101", first));
    await user.keyboard("2{Enter}");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("SUP-1101");
    await user.type(within(dialog).getByLabelText("Worklog comment"), "Investigated the export");
    await user.click(within(dialog).getByRole("button", { name: "Save worklog" }));
    await waitFor(() => expect(create).toHaveBeenLastCalledWith("main", expect.objectContaining({ seconds: 7200, comment: "Investigated the export" })));
    await waitFor(() => expect(cell("main:SUP-1101", first)).toHaveTextContent("2"));

    // Changing an existing worklog: no window.
    await user.click(cell("main:SUP-1101", first));
    await user.keyboard("3{Enter}");
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Cancel: nothing is created.
    const calls = create.mock.calls.length;
    await user.click(cell("main:SUP-1101", second));
    await user.keyboard("1{Enter}");
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(create.mock.calls.length).toBe(calls);
    expect(cell("main:SUP-1101", second)).toHaveTextContent("");

    // Switch it off: new worklogs are created right away.
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(await screen.findByRole("tab", { name: "Timesheet" }));
    const option = screen.getByLabelText("Ask for a comment on new worklogs");
    expect(option).toBeChecked();
    await user.click(option);
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings saved.");
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    await user.click(cell("main:SUP-1101", third));
    await user.keyboard("1{Enter}");
    await waitFor(() => expect(create.mock.calls.length).toBe(calls + 1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the worklogs allocation under the table and edits its categories in Settings", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    const chart = screen.getByRole("region", { name: "Worklogs allocation" });
    // Legend only: no bar and no title.
    expect(chart.querySelector(".allocationBar")).toBeNull();
    expect(chart).not.toHaveTextContent("Worklogs allocation");
    const items = within(within(chart).getByRole("list", { name: "Allocation" })).getAllByRole("listitem");
    expect(items.length).toBeGreaterThan(1);
    const percents = items.map((item) => Number(item.getAttribute("aria-label")!.match(/: ([\d.,]+)%/)![1].replace(",", ".")));
    expect(percents.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 0);
    expect(percents).toEqual([...percents].sort((a, b) => b - a));
    // Fixed colours of the default categories.
    const swatch = (name: string) => items.find((item) => item.getAttribute("aria-label")!.startsWith(`${name}:`))!.querySelector<HTMLElement>(".swatch")!.style.background;
    expect(swatch("Support")).toBe("rgb(1, 138, 128)");
    expect(swatch("SME")).toBe("rgb(1, 184, 170)");
    expect(swatch("Implementation")).toBe("rgb(33, 130, 160)");
    // Top clients: at most 5, largest first, issues without a client left out.
    const clients = within(within(chart).getByRole("list", { name: "Top clients" })).getAllByRole("listitem");
    expect(clients.length).toBeGreaterThan(0);
    expect(clients.length).toBeLessThanOrEqual(5);
    expect(chart).toHaveTextContent(`Top ${clients.length} clients`);
    expect(chart).toHaveTextContent("Northwind Bank");
    expect(chart).toHaveTextContent("Support");

    // Rename a category in Settings; the chart follows.
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(await screen.findByRole("tab", { name: "Allocation" }));
    const name = screen.getByLabelText("Category name 1");
    expect(name).toHaveValue("Support");
    await user.clear(name);
    await user.type(name, "Help desk");
    await user.click(screen.getByRole("button", { name: "Move Help desk down" }));
    expect(screen.getByLabelText("Category name 2")).toHaveValue("Help desk");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings saved.");
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Worklogs allocation" })).toHaveTextContent("Help desk"));
  });

  it("has a client field per Jira that follows the URL until changed", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(await screen.findByRole("tab", { name: "Jira sources" }));
    const url = screen.getAllByLabelText("Base URL")[0];
    const field = screen.getAllByLabelText(/Client field/)[0];
    expect(field).toHaveValue("customfield_10703");
    await user.clear(url);
    await user.type(url, "https://ows-jira.spb.example.com");
    expect(field).toHaveValue("customfield_11000");
    await user.clear(field);
    await user.type(field, "customfield_1");
    await user.type(url, "/x");
    expect(field).toHaveValue("customfield_1");
  });

  it("shows Forget next to the saved password", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(await screen.findByRole("tab", { name: "Jira sources" }));
    const field = (await screen.findAllByPlaceholderText("Saved — type to replace"))[0];
    expect(within(field.closest(".secretRow") as HTMLElement).getByRole("button", { name: "Forget" })).toBeInTheDocument();
  });

  it("filters rows with a JQL filter", async () => {
    const user = userEvent.setup();
    const match = vi.spyOn(window.timesheets, "matchFilter");
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    await user.click(screen.getByRole("radio", { name: "Support" }));
    await waitFor(() => expect(screen.queryByLabelText(issueLink("INT-15"))).not.toBeInTheDocument());
    expect(screen.getByLabelText(issueLink("SUP-1042"))).toBeInTheDocument();
    expect(match).toHaveBeenCalledWith("project = SUP", expect.objectContaining({ main: expect.arrayContaining(["INT-15"]) }));
    await user.click(screen.getByRole("radio", { name: "All" }));
    expect(screen.getByLabelText(issueLink("INT-15"))).toBeInTheDocument();
  });

  it("reports a broken filter JQL and falls back to All", async () => {
    const api = window.timesheets;
    const original = await api.loadData();
    await api.saveData({ ...original, settings: { ...original.settings, filters: [{ id: "bad", label: "Broken", jql: "status = !!", free: false }] } });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText(issueLink("INT-15"));
    await user.click(screen.getByRole("radio", { name: "Broken" }));
    expect(await screen.findByText(/Filter "Broken".*Error in the JQL Query/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText(issueLink("INT-15"))).toBeInTheDocument();
  });
});
