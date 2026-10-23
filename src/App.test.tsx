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
    await user.type(screen.getByLabelText("Issue key"), "NEW-1");
    await user.click(screen.getByRole("button", { name: /add/i }));
    await screen.findByText("NEW-1");

    const day = workingDayKey();
    const target = cell("main:NEW-1", day);

    await user.click(target);
    await user.keyboard("1h 30m{Enter}");
    await waitFor(() => expect(cell("main:NEW-1", day)).toHaveTextContent("1.5"));
    expect(create).toHaveBeenCalledWith("main", { issueKey: "NEW-1", date: day, seconds: 5400 });

    await user.dblClick(cell("main:NEW-1", day));
    const editor = within(cell("main:NEW-1", day)).getByRole("textbox");
    await user.clear(editor);
    await user.keyboard("2{Enter}");
    await waitFor(() => expect(cell("main:NEW-1", day)).toHaveTextContent("2"));
    expect(update).toHaveBeenCalledWith("main", expect.objectContaining({ issueKey: "NEW-1", seconds: 7200 }));

    await user.click(cell("main:NEW-1", day));
    await user.keyboard("{Delete}");
    await waitFor(() => expect(cell("main:NEW-1", day)).toHaveTextContent(""));
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
    await user.type(screen.getByLabelText("Issue key"), "NEW-2");
    await user.click(screen.getByRole("button", { name: /add/i }));
    await screen.findByText("NEW-2");

    const day = workingDayKey();
    await user.click(cell("main:NEW-2", day));
    await user.keyboard("2{Enter}");
    await waitFor(() => expect(cell("main:NEW-2", day)).toHaveTextContent("2"));

    await user.click(cell("main:NEW-2", day));
    await user.keyboard("{Delete}");
    await waitFor(() => expect(cell("main:NEW-2", day)).toHaveTextContent("0.0"));
    expect(update).toHaveBeenCalledWith("main", expect.objectContaining({ issueKey: "NEW-2", seconds: 60 }));
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
    const rowId = document.querySelector(`a[title^="Open ${last} "]`)!.closest("tr")!.querySelector("[data-cell]")!.getAttribute("data-cell")!.split("|")[0];
    await user.click(cell(rowId, day));
    await user.keyboard("20{Enter}");
    await waitFor(() => expect(cell(rowId, day)).toHaveTextContent(/\d/));
    expect(order()).toEqual(before);

    await user.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(order()[0]).toBe(last));
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
    const grid = document.querySelector<HTMLElement>(".gridWrap")!;
    expect(grid.style.getPropertyValue("--grid-font-size")).toBe("18px");
    expect(grid.style.getPropertyValue("--grid-font")).toMatch(/monospace/);
  });

  it("starts with regular text on white, applies bold and a custom background, and resets to the theme default", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("INT-15");
    expect(screen.getByRole("columnheader", { name: "Summary" })).toBeInTheDocument();
    const grid = () => document.querySelector<HTMLElement>(".gridWrap")!;
    expect(grid().style.getPropertyValue("--grid-weight")).toBe("400");
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#ffffff");

    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.selectOptions(await screen.findByLabelText("Table text"), "bold");
    const picker = screen.getByLabelText("Background colour", { selector: "input" }) as HTMLInputElement;
    fireEvent.input(picker, { target: { value: "#fdf6e3" } });
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#fdf6e3");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings saved.");
    await user.click(screen.getByRole("button", { name: /timesheet/i }));
    await screen.findByText("INT-15");
    expect(grid().style.getPropertyValue("--grid-weight")).toBe("700");
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#fdf6e3");

    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(await screen.findByRole("button", { name: "Reset" }));
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings saved.");
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("");
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
    await api.saveData({ ...original, settings: { ...original.settings, filters: [{ id: "bad", label: "Broken", jql: "status = !!" }] } });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("INT-15");
    await user.click(screen.getByRole("radio", { name: "Broken" }));
    expect(await screen.findByText(/Filter "Broken".*Error in the JQL Query/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("INT-15")).toBeInTheDocument();
  });
});
