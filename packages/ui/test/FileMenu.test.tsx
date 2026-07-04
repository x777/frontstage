import { render, screen, fireEvent } from "@testing-library/react";
import type { ProjectSession } from "@palmier/core";
import { FileMenu } from "../src/editor/FileMenu.js";

function makeFakeSession(): ProjectSession {
  return {
    getState: () => ({ name: "Untitled" }),
    subscribe: () => () => {},
    isDirty: () => false,
    listRecent: async () => [],
  } as unknown as ProjectSession;
}

function openMenu() {
  fireEvent.click(screen.getByTestId("file-menu"));
}

test("no Export entries when onExport is omitted", () => {
  render(
    <FileMenu session={makeFakeSession()} confirmDiscard={async () => true} runProjectCommand={() => {}} />,
  );
  openMenu();
  expect(screen.queryByTestId("file-export-video")).not.toBeInTheDocument();
});

test("only the video export button shows when canExportXml and canExportCaptions are false", () => {
  const onExport = vi.fn();
  render(
    <FileMenu
      session={makeFakeSession()}
      confirmDiscard={async () => true}
      runProjectCommand={() => {}}
      onExport={onExport}
    />,
  );
  openMenu();
  expect(screen.getByTestId("file-export-video")).toBeInTheDocument();
  expect(screen.queryByTestId("file-export-fcpxml")).not.toBeInTheDocument();
  expect(screen.queryByTestId("file-export-xmeml")).not.toBeInTheDocument();
  expect(screen.queryByTestId("file-export-srt")).not.toBeInTheDocument();
  expect(screen.queryByTestId("file-export-vtt")).not.toBeInTheDocument();
});

test("all three format buttons show when canExportXml is true, and each invokes onExport with its kind", () => {
  const onExport = vi.fn();
  render(
    <FileMenu
      session={makeFakeSession()}
      confirmDiscard={async () => true}
      runProjectCommand={() => {}}
      onExport={onExport}
      canExportXml
    />,
  );

  openMenu();
  fireEvent.click(screen.getByTestId("file-export-video"));
  expect(onExport).toHaveBeenLastCalledWith("video");

  openMenu();
  fireEvent.click(screen.getByTestId("file-export-fcpxml"));
  expect(onExport).toHaveBeenLastCalledWith("fcpxml", { target: "resolve", version: "1.10" });

  openMenu();
  fireEvent.click(screen.getByTestId("file-export-xmeml"));
  expect(onExport).toHaveBeenLastCalledWith("xmeml");

  expect(onExport).toHaveBeenCalledTimes(3);
});

test("clicking a format button closes the menu", () => {
  render(
    <FileMenu
      session={makeFakeSession()}
      confirmDiscard={async () => true}
      runProjectCommand={() => {}}
      onExport={() => {}}
      canExportXml
    />,
  );
  openMenu();
  fireEvent.click(screen.getByTestId("file-export-fcpxml"));
  expect(screen.queryByTestId("file-export-fcpxml")).not.toBeInTheDocument();
});

test("srt/vtt caption buttons are absent when canExportCaptions is false, even with canExportXml true", () => {
  render(
    <FileMenu
      session={makeFakeSession()}
      confirmDiscard={async () => true}
      runProjectCommand={() => {}}
      onExport={() => {}}
      canExportXml
    />,
  );
  openMenu();
  expect(screen.queryByTestId("file-export-srt")).not.toBeInTheDocument();
  expect(screen.queryByTestId("file-export-vtt")).not.toBeInTheDocument();
});

test("srt/vtt caption buttons show when canExportCaptions is true, and each invokes onExport with its kind", () => {
  const onExport = vi.fn();
  render(
    <FileMenu
      session={makeFakeSession()}
      confirmDiscard={async () => true}
      runProjectCommand={() => {}}
      onExport={onExport}
      canExportCaptions
    />,
  );

  openMenu();
  expect(screen.getByTestId("file-export-video")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("file-export-srt"));
  expect(onExport).toHaveBeenLastCalledWith("srt");

  openMenu();
  fireEvent.click(screen.getByTestId("file-export-vtt"));
  expect(onExport).toHaveBeenLastCalledWith("vtt");
});

test("clicking a caption format button closes the menu", () => {
  render(
    <FileMenu
      session={makeFakeSession()}
      confirmDiscard={async () => true}
      runProjectCommand={() => {}}
      onExport={() => {}}
      canExportCaptions
    />,
  );
  openMenu();
  fireEvent.click(screen.getByTestId("file-export-srt"));
  expect(screen.queryByTestId("file-export-srt")).not.toBeInTheDocument();
});

// --- FCPXML For/Version pickers (M14C T1, Swift ExportView.swift:216-249 parity) ---

test("FCPXML pickers are absent when canExportXml is false", () => {
  render(
    <FileMenu
      session={makeFakeSession()}
      confirmDiscard={async () => true}
      runProjectCommand={() => {}}
      onExport={() => {}}
    />,
  );
  openMenu();
  expect(screen.queryByTestId("fcpxml-options")).not.toBeInTheDocument();
});

test("FCPXML pickers show only alongside the FCPXML export option, with Swift's defaults", () => {
  render(
    <FileMenu
      session={makeFakeSession()}
      confirmDiscard={async () => true}
      runProjectCommand={() => {}}
      onExport={() => {}}
      canExportXml
    />,
  );
  openMenu();
  expect(screen.getByTestId("fcpxml-options")).toBeInTheDocument();
  expect((screen.getByTestId("fcpxml-target") as HTMLSelectElement).value).toBe("resolve");
  expect((screen.getByTestId("fcpxml-version") as HTMLSelectElement).value).toBe("1.10");
  expect(screen.getByTestId("fcpxml-compat-note").textContent).toBe("DaVinci Resolve 18+, Final Cut Pro 10.6+");
});

test("changing the pickers updates the compatibility note copy verbatim", () => {
  render(
    <FileMenu
      session={makeFakeSession()}
      confirmDiscard={async () => true}
      runProjectCommand={() => {}}
      onExport={() => {}}
      canExportXml
    />,
  );
  openMenu();
  fireEvent.change(screen.getByTestId("fcpxml-version"), { target: { value: "1.13" } });
  expect(screen.getByTestId("fcpxml-compat-note").textContent).toBe("DaVinci Resolve 21+, Final Cut Pro 11+");
});

test("changing the For/Version pickers and exporting passes the chosen target/version to onExport", () => {
  const onExport = vi.fn();
  render(
    <FileMenu
      session={makeFakeSession()}
      confirmDiscard={async () => true}
      runProjectCommand={() => {}}
      onExport={onExport}
      canExportXml
    />,
  );
  openMenu();
  fireEvent.change(screen.getByTestId("fcpxml-target"), { target: { value: "fcp" } });
  fireEvent.change(screen.getByTestId("fcpxml-version"), { target: { value: "1.12" } });
  fireEvent.click(screen.getByTestId("file-export-fcpxml"));
  expect(onExport).toHaveBeenLastCalledWith("fcpxml", { target: "fcp", version: "1.12" });
});

test("the XMEML export button is unaffected by the FCPXML pickers", () => {
  const onExport = vi.fn();
  render(
    <FileMenu
      session={makeFakeSession()}
      confirmDiscard={async () => true}
      runProjectCommand={() => {}}
      onExport={onExport}
      canExportXml
    />,
  );
  openMenu();
  fireEvent.change(screen.getByTestId("fcpxml-target"), { target: { value: "fcp" } });
  fireEvent.click(screen.getByTestId("file-export-xmeml"));
  expect(onExport).toHaveBeenLastCalledWith("xmeml");
});
