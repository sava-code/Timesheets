import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createDevApi } from "./devApi";
import { currentMonth, monthDays, todayKey } from "./time";

// Pick a working day of the current month that is not in the future, so the demo has data around it.
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

function cell(rowId: string, day: string) {
  const element = document.querySelector<HTMLElement>(`[data-cell="${rowId}|${day}"]`);
  if (!element) throw new Error(`cell ${rowId}|${day} not found`);
  return element;
}

describe("Timesheet grid", () => {
  beforeEach(() => {
    window.timesheets = createDevApi();
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
    await screen.findByText("INT-15");
    // SUP-1101 has no time logged: find it with a JQL search.
    await runJql(user, "key = SUP-1101");
    await screen.findByText("SUP-1101");

    const day = workingDayKey();
    const target = cell("main:SUP-1101", day);

    await user.click(target);
    await user.keyboard("1h 30m{Enter}");
    await waitFor(() => expect(cell("main:SUP-1101", day)).toHaveTextContent("1.5"));
    expect(create).toHaveBeenCalledWith("main", { issueKey: "SUP-1101", date: day, seconds: 5400 });

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
    window.timesheets = createDevApi({ canDeleteWorklogs: false });
    const user = userEvent.setup();
    const update = vi.spyOn(window.timesheets, "updateWorklog");
    render(<App />);
    await screen.findByText("INT-15");
    await runJql(user, "key = IMPL-330");
    await screen.findByText("IMPL-330");

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
    await screen.findByText("INT-15");
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
    await screen.findByText("INT-15");
    expect(document.documentElement.dataset.theme).toBe("classic");
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.selectOptions(await screen.findByLabelText("Theme"), "dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    // Leaving without saving restores the saved theme...
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    expect(document.documentElement.dataset.theme).toBe("classic");
    // ...and saving keeps the new one.
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.selectOptions(await screen.findByLabelText("Theme"), "dark");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings saved.");
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("sorts by total time and keeps the order while editing", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("INT-15");
    const order = () => [...document.querySelectorAll("tbody td.keyCol a")].map((link) => link.textContent);
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
    await screen.findByText("INT-15");
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.selectOptions(await screen.findByLabelText("Table font"), "mono");
    await user.selectOptions(screen.getByLabelText("Table font size"), "18");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings saved.");
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    await screen.findByText("INT-15");
    // Set on the timesheet container so the JQL search can line up with the Summary column.
    const sheet = document.querySelector<HTMLElement>("main.timesheet")!;
    expect(sheet.style.getPropertyValue("--grid-font-size")).toBe("18px");
    expect(sheet.style.getPropertyValue("--grid-font")).toMatch(/monospace/);
  });

  it("starts with regular text on white, applies a custom background, and resets to the theme default", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("INT-15");
    expect(screen.getByRole("columnheader", { name: "Summary" })).toBeInTheDocument();
    // White comes from the Classic theme itself, not from a stored colour, so other themes keep their own.
    expect(document.documentElement.dataset.theme).toBe("classic");
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("");

    await user.click(screen.getByRole("button", { name: /settings/i }));
    expect(screen.queryByLabelText("Table text")).not.toBeInTheDocument();
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
    await screen.findByText("INT-15");
    await user.click(screen.getByRole("radio", { name: "Support" }));
    await waitFor(() => expect(screen.queryByText("INT-15")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await screen.findByText("Settings saved.", undefined, { timeout: 50 }).catch(() => null);
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    expect(screen.getByRole("radio", { name: "Support" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("SUP-1042")).toBeInTheDocument();
    expect(screen.queryByText("INT-15")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("runs a JQL search as its own list, and clears back to the base list", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("INT-15");
    await runJql(user, "project = SUP");
    // Free list: SUP issues only, including one with no time yet; logged time stays in the cells.
    await screen.findByText("SUP-1101");
    expect(screen.queryByText("INT-15")).not.toBeInTheDocument();
    expect(screen.getByText("SUP-1042")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "false");
    await user.click(screen.getByRole("button", { name: "Clear JQL search" }));
    await screen.findByText("INT-15");
    expect(screen.queryByText("SUP-1101")).not.toBeInTheDocument();
  });

  it("runs the typed JQL when Refresh is pressed", async () => {
    const user = userEvent.setup();
    const search = vi.spyOn(window.timesheets, "searchIssues");
    render(<App />);
    await screen.findByText("INT-15");
    await user.type(screen.getByLabelText("Jira JQL search"), "key = OPS-512");
    await user.click(screen.getByRole("button", { name: /refresh/i }));
    await screen.findByText("OPS-512");
    expect(search).toHaveBeenLastCalledWith("key = OPS-512");
    expect(screen.queryByText("INT-15")).not.toBeInTheDocument();
  });

  it("uses free filters as their own list and the All filter's JQL", async () => {
    const user = userEvent.setup();
    const api = window.timesheets;
    render(<App />);
    await screen.findByText("INT-15");
    // "All support" is a free filter: it lists SUP issues even without time this month.
    await user.click(screen.getByRole("radio", { name: "All support" }));
    await screen.findByText("SUP-1101");
    expect(screen.queryByText("INT-15")).not.toBeInTheDocument();

    // All with a narrowing JQL.
    const current = await api.loadData();
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.type(await screen.findByLabelText("JQL for All"), "project = IMPL");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings saved.");
    expect((await api.loadData()).settings.allFilter).toEqual({ ...current.settings.allFilter, jql: "project = IMPL" });
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    await user.click(screen.getByRole("radio", { name: "All" }));
    await waitFor(() => expect(screen.queryByText("INT-15")).not.toBeInTheDocument());
    expect(screen.getByText("IMPL-310")).toBeInTheDocument();
    expect(screen.queryByText("IMPL-330")).not.toBeInTheDocument(); // not in the base list

    // Ticking Free makes All its own list.
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(await screen.findByLabelText("Free filter: All"));
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings saved.");
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    await screen.findByText("IMPL-330");
  });

  it("leaves absence days out of the norm and shows them in grey", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("INT-15");
    // The demo has 3 absence working days: CAL-101 (2 days) and CAL-102 (1 day).
    const workdays = monthDays(currentMonth()).filter((day) => !day.isWeekend);
    const normText = () => screen.getByText("Month norm").querySelector("strong")!.textContent;
    expect(normText()).toBe(String((workdays.length - 3) * 8));
    const vacation = workdays[6].key;
    const header = document.querySelectorAll<HTMLElement>("thead tr.dayRow th.absent");
    expect(header).toHaveLength(3);
    expect(header[0].dataset.tip).toMatch(/CAL-101 · Vacation/);
    expect(cell("main:INT-15", vacation)).toHaveClass("absent");
    // Absence days are never coloured as short days.
    expect(document.querySelectorAll("thead tr.totalsRow th.absent.under, thead tr.totalsRow th.absent.empty")).toHaveLength(0);

    // Switching absences off restores the full norm.
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(await screen.findByLabelText("Use absences"));
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings saved.");
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    await waitFor(() => expect(normText()).toBe(String(workdays.length * 8)));
    expect(document.querySelectorAll("th.absent")).toHaveLength(0);
  });

  it("shows a cell's worklogs as a hint after 1 second", async () => {
    render(<App />);
    await screen.findByText("INT-15");
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
    await screen.findByText("INT-15");
    expect(screen.getByRole("radio", { name: "All" })).toHaveClass("chip", "active");
    await user.click(screen.getByRole("radio", { name: "Support" }));
    expect(screen.getByRole("radio", { name: "Support" })).toHaveClass("active");
    expect(screen.getByRole("radio", { name: "All" })).not.toHaveClass("active");
  });

  it("shows columns as Summary, Key, Total and the issue type icon before the summary", async () => {
    render(<App />);
    await screen.findByText("INT-15");
    const headings = [...document.querySelectorAll("thead tr.dayRow th")].slice(0, 3).map((th) => th.textContent);
    expect(headings).toEqual(["Summary", "Key", "Total"]);
    const firstRow = document.querySelector("tbody tr")!;
    expect([...firstRow.children].slice(0, 2).map((td) => td.className)).toEqual(["summaryCol", "keyCol"]);
    const icon = firstRow.querySelector<HTMLImageElement>("td.summaryCol img.typeIcon")!;
    expect(icon.src).toMatch(/^data:image\/svg\+xml/);
    expect(icon.alt).toMatch(/Task|Bug|Story|Sub-task/);
  });

  it("shows Forget next to the saved password", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("INT-15");
    await user.click(screen.getByRole("button", { name: /settings/i }));
    const field = (await screen.findAllByPlaceholderText("Saved — type to replace"))[0];
    expect(within(field.closest(".secretRow") as HTMLElement).getByRole("button", { name: "Forget" })).toBeInTheDocument();
  });

  it("filters rows with a JQL filter", async () => {
    const user = userEvent.setup();
    const match = vi.spyOn(window.timesheets, "matchFilter");
    render(<App />);
    await screen.findByText("INT-15");
    await user.click(screen.getByRole("radio", { name: "Support" }));
    await waitFor(() => expect(screen.queryByText("INT-15")).not.toBeInTheDocument());
    expect(screen.getByText("SUP-1042")).toBeInTheDocument();
    expect(match).toHaveBeenCalledWith("project = SUP", expect.objectContaining({ main: expect.arrayContaining(["INT-15"]) }));
    await user.click(screen.getByRole("radio", { name: "All" }));
    expect(screen.getByText("INT-15")).toBeInTheDocument();
  });

  it("reports a broken filter JQL and falls back to All", async () => {
    const api = window.timesheets;
    const original = await api.loadData();
    await api.saveData({ ...original, settings: { ...original.settings, filters: [{ id: "bad", label: "Broken", jql: "status = !!", free: false }] } });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("INT-15");
    await user.click(screen.getByRole("radio", { name: "Broken" }));
    expect(await screen.findByText(/Filter "Broken".*Error in the JQL Query/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("INT-15")).toBeInTheDocument();
  });
});
