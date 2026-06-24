import { renderHook, act } from "@testing-library/react";
import { useExportCommand } from "../src/editor/use-export-command.js";
import type { ExportGateway, ExportTarget } from "../src/editor/export-gateway.js";
import type { Timeline } from "@palmier/core";
import type { MediaByteSource } from "@palmier/engine";

const fakeTimeline = {} as Timeline;
const fakeMedia = {} as MediaByteSource;

function makeGateway(overrides: Partial<ExportGateway> = {}): ExportGateway {
  return {
    pickTarget: vi.fn().mockResolvedValue({ label: "out.mp4" } satisfies ExportTarget),
    run: vi.fn().mockImplementation(async (_tl, _media, _target, onProgress) => {
      onProgress(1, 3);
      onProgress(2, 3);
      onProgress(3, 3);
    }),
    ...overrides,
  };
}

function makeRunProjectCommand() {
  return vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => {
    await fn();
  });
}

test("canExport is false when no gateway", () => {
  const { result } = renderHook(() =>
    useExportCommand({
      getTimeline: () => fakeTimeline,
      media: fakeMedia,
      suggestedName: () => "Untitled",
      runProjectCommand: makeRunProjectCommand(),
    })
  );
  expect(result.current.canExport).toBe(false);
});

test("canExport is true when gateway provided", () => {
  const { result } = renderHook(() =>
    useExportCommand({
      exportGateway: makeGateway(),
      getTimeline: () => fakeTimeline,
      media: fakeMedia,
      suggestedName: () => "Untitled",
      runProjectCommand: makeRunProjectCommand(),
    })
  );
  expect(result.current.canExport).toBe(true);
});

test("exportProject calls pickTarget with suggested name and progresses state", async () => {
  const gateway = makeGateway();
  const runProjectCommand = makeRunProjectCommand();
  const { result } = renderHook(() =>
    useExportCommand({
      exportGateway: gateway,
      getTimeline: () => fakeTimeline,
      media: fakeMedia,
      suggestedName: () => "My Project",
      runProjectCommand,
    })
  );

  expect(result.current.exportState).toBeNull();

  await act(async () => {
    result.current.exportProject();
  });

  expect(gateway.pickTarget).toHaveBeenCalledWith("My Project");
  expect(gateway.run).toHaveBeenCalledTimes(1);
  // After completion, state should be null
  expect(result.current.exportState).toBeNull();
});

test("exportProject is a no-op when no gateway", async () => {
  const runProjectCommand = makeRunProjectCommand();
  const { result } = renderHook(() =>
    useExportCommand({
      getTimeline: () => fakeTimeline,
      media: fakeMedia,
      suggestedName: () => "Untitled",
      runProjectCommand,
    })
  );

  await act(async () => {
    result.current.exportProject();
  });

  expect(runProjectCommand).not.toHaveBeenCalled();
});

test("cancel (pickTarget returns null) keeps exportState null, run never called", async () => {
  const gateway = makeGateway({
    pickTarget: vi.fn().mockResolvedValue(null),
  });
  const runProjectCommand = makeRunProjectCommand();
  const { result } = renderHook(() =>
    useExportCommand({
      exportGateway: gateway,
      getTimeline: () => fakeTimeline,
      media: fakeMedia,
      suggestedName: () => "Untitled",
      runProjectCommand,
    })
  );

  await act(async () => {
    result.current.exportProject();
  });

  expect(gateway.run).not.toHaveBeenCalled();
  expect(result.current.exportState).toBeNull();
});

test("re-entrancy: calling exportProject while running is a no-op", async () => {
  let resolveRun!: () => void;
  const runPromise = new Promise<void>((res) => { resolveRun = res; });
  const gateway = makeGateway({
    run: vi.fn().mockImplementation(() => runPromise),
  });
  const runProjectCommand = makeRunProjectCommand();
  const { result } = renderHook(() =>
    useExportCommand({
      exportGateway: gateway,
      getTimeline: () => fakeTimeline,
      media: fakeMedia,
      suggestedName: () => "Untitled",
      runProjectCommand,
    })
  );

  // Start first run (don't await — let it hang)
  act(() => { result.current.exportProject(); });

  // Try to call again while first is running
  await act(async () => {
    result.current.exportProject();
  });

  // run should only have been called once
  expect(gateway.run).toHaveBeenCalledTimes(1);

  // Clean up — resolve the hanging run
  await act(async () => { resolveRun(); });
});
