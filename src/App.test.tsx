import { render, screen, waitFor, within } from "@testing-library/react";
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

  it("filters rows by project group", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("INT-15");
    await user.click(screen.getByRole("radio", { name: "Support" }));
    expect(screen.queryByText("INT-15")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "All" }));
    expect(screen.getByText("INT-15")).toBeInTheDocument();
  });
});
