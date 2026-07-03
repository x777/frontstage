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

test("only the video export button shows when canExportXml is false", () => {
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
  expect(onExport).toHaveBeenLastCalledWith("fcpxml");

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
