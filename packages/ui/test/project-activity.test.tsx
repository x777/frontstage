import { render, screen, within, fireEvent } from "@testing-library/react";
import type { GenerationLogEntry } from "@frontstage/core";
import { ProjectActivityView, ProjectActivityButton, relativeTime } from "../src/editor/ProjectActivityView.js";

const NOW = new Date("2026-01-03T00:10:00.000Z");

describe("relativeTime", () => {
  test("null createdAt renders em dash", () => {
    expect(relativeTime(null, NOW)).toBe("—");
  });

  test("under 60s renders 'just now'", () => {
    expect(relativeTime(new Date(NOW.getTime() - 59_000).toISOString(), NOW)).toBe("just now");
  });

  test("60s renders '1m ago'", () => {
    expect(relativeTime(new Date(NOW.getTime() - 60_000).toISOString(), NOW)).toBe("1m ago");
  });

  test("just under an hour renders minutes", () => {
    expect(relativeTime(new Date(NOW.getTime() - 3_599_000).toISOString(), NOW)).toBe("59m ago");
  });

  test("one hour renders '1h ago'", () => {
    expect(relativeTime(new Date(NOW.getTime() - 3_600_000).toISOString(), NOW)).toBe("1h ago");
  });

  test("just under a day renders hours", () => {
    expect(relativeTime(new Date(NOW.getTime() - 86_399_000).toISOString(), NOW)).toBe("23h ago");
  });

  test("one day renders '1d ago'", () => {
    expect(relativeTime(new Date(NOW.getTime() - 86_400_000).toISOString(), NOW)).toBe("1d ago");
  });
});

const ENTRIES: GenerationLogEntry[] = [
  { id: "a", model: "fal-ai/veo3.1/fast", costCredits: 500, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "b", model: "fal-ai/nano-banana", costCredits: 10, createdAt: "2026-01-03T00:00:00.000Z" },
  { id: "c", model: "unknown-model-id", costCredits: null, createdAt: "2026-01-02T00:00:00.000Z" },
];

describe("ProjectActivityView", () => {
  test("renders entries newest-first with per-row cost and the total", () => {
    render(<ProjectActivityView entries={ENTRIES} now={NOW} />);

    const rows = screen.getAllByTestId("activity-row");
    expect(rows).toHaveLength(3);
    // newest (b, Jan 3) -> c (Jan 2) -> oldest (a, Jan 1)
    expect(within(rows[0]!).getByText("Nano Banana")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("unknown-model-id")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Veo 3.1 Fast")).toBeInTheDocument();

    // 500 + 10 + 0(null) = 510 credits
    expect(screen.getByTestId("activity-total")).toHaveTextContent("510 credits");
  });

  test("null costCredits renders an em dash for that row", () => {
    render(<ProjectActivityView entries={ENTRIES} now={NOW} />);
    const rows = screen.getAllByTestId("activity-row");
    const nullRow = rows.find((r) => within(r).queryByText("unknown-model-id"));
    expect(within(nullRow!).getByText("—")).toBeInTheDocument();
  });

  test("falls back to the raw model id and a '?' glyph when the catalog has no match", () => {
    render(<ProjectActivityView entries={ENTRIES} now={NOW} />);
    const rows = screen.getAllByTestId("activity-row");
    const unknownRow = rows.find((r) => within(r).queryByText("unknown-model-id"))!;
    expect(within(unknownRow).getByText("?")).toBeInTheDocument();
  });

  test("empty entries renders the empty state, no total", () => {
    render(<ProjectActivityView entries={[]} now={NOW} />);
    expect(screen.getByTestId("activity-empty")).toHaveTextContent("No generations yet.");
    expect(screen.queryByTestId("activity-total")).not.toBeInTheDocument();
  });
});

describe("ProjectActivityButton", () => {
  test("title carries the formatted total", () => {
    const getGenerationLog = () => ENTRIES;
    render(<ProjectActivityButton getGenerationLog={getGenerationLog} />);
    expect(screen.getByTestId("project-activity-toggle")).toHaveAttribute(
      "title",
      "Project Activity · 510 credits (~$5.10) used",
    );
  });

  test("click opens the popover and reads the log fresh", () => {
    const getGenerationLog = vi.fn().mockReturnValue(ENTRIES);
    render(<ProjectActivityButton getGenerationLog={getGenerationLog} />);

    expect(screen.queryByTestId("project-activity")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("project-activity-toggle"));
    expect(screen.getByTestId("project-activity")).toBeInTheDocument();
    expect(getGenerationLog).toHaveBeenCalled();
  });
});
