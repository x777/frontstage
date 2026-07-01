import { describe, it, expect } from "vitest";
import { ProjectSession } from "./project-session.js";
import type { ProjectHost } from "./project-session.js";
import { InMemoryProjectGateway } from "./memory-gateway.js";
import { writeProject } from "./project-io.js";
import type { ProjectDoc } from "../schema/serialize.js";
import { PROJECT_FILES } from "../schema/serialize.js";
import type { Timeline } from "../timeline.js";
import { defaultTimeline } from "../timeline.js";
import type { MediaManifest } from "../media.js";
import { emptyMediaManifest } from "../media.js";
import type { GenerationLog } from "../generation-log.js";
import { emptyGenerationLog } from "../generation-log.js";
import type { ProjectRef } from "./gateway.js";

class FakeHost implements ProjectHost {
  timeline: Timeline;
  manifest: MediaManifest;
  generationLog: GenerationLog;
  pending: Map<string, Uint8Array>;

  constructor(opts?: {
    timeline?: Timeline;
    manifest?: MediaManifest;
    generationLog?: GenerationLog;
    pending?: Map<string, Uint8Array>;
  }) {
    this.timeline = opts?.timeline ?? defaultTimeline();
    this.manifest = opts?.manifest ?? emptyMediaManifest();
    this.generationLog = opts?.generationLog ?? emptyGenerationLog();
    this.pending = opts?.pending ?? new Map();
  }

  getTimeline(): Timeline {
    return this.timeline;
  }

  getManifest(): MediaManifest {
    return this.manifest;
  }

  getGenerationLog(): GenerationLog {
    return this.generationLog;
  }

  loadDoc(doc: ProjectDoc): void {
    this.timeline = doc.timeline;
    this.manifest = doc.manifest;
    this.generationLog = doc.generationLog;
  }

  pendingMedia(): Map<string, Uint8Array> {
    return this.pending;
  }

  markMediaPersisted(relativePaths: string[]): void {
    for (const p of relativePaths) this.pending.delete(p);
  }
}

const alwaysProceed = async () => true;
const alwaysCancel = async () => false;

describe("ProjectSession", () => {
  it("dirty: fresh session is not dirty", () => {
    const host = new FakeHost();
    const gw = new InMemoryProjectGateway();
    const session = new ProjectSession(host, gw);
    expect(session.isDirty()).toBe(false);
  });

  it("dirty: mutating host timeline makes session dirty", () => {
    const host = new FakeHost();
    const gw = new InMemoryProjectGateway();
    const session = new ProjectSession(host, gw);
    host.timeline = { ...host.timeline, fps: 60 }; // new reference
    expect(session.isDirty()).toBe(true);
  });

  it("dirty: save clears dirty flag", async () => {
    const host = new FakeHost();
    const gw = new InMemoryProjectGateway();
    const session = new ProjectSession(host, gw);
    host.timeline = { ...host.timeline, fps: 60 };
    expect(session.isDirty()).toBe(true);
    const ok = await session.save(); // no ref → delegates to saveAs with default factory
    expect(ok).toBe(true);
    expect(session.isDirty()).toBe(false);
  });

  it("save→open round-trip with media: persists and reloads", async () => {
    const mediaPath = "media/clip.mp4";
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const manifest: MediaManifest = {
      version: 2,
      entries: [
        {
          id: "a1",
          name: "clip.mp4",
          type: "video",
          source: { kind: "project", relativePath: mediaPath },
          duration: 5,
        },
      ],
      folders: [],
    };
    const pending = new Map([[mediaPath, bytes]]);
    const host1 = new FakeHost({ manifest, pending });

    // Use one gateway for everything
    let capturedRef: ProjectRef | null = null;
    const gw2 = new InMemoryProjectGateway({
      saveAsFactory: (name) => {
        const ref: ProjectRef = { id: "saved-proj", name };
        capturedRef = ref;
        return ref;
      },
    });
    const session1b = new ProjectSession(host1, gw2);
    const ok = await session1b.saveAs();
    expect(ok).toBe(true);
    expect(capturedRef).not.toBeNull();

    // First host's pending media should be cleared
    expect(host1.pending.size).toBe(0);

    // Open from a second session + fresh host
    const host2 = new FakeHost();
    const session2 = new ProjectSession(host2, gw2);
    const opened = await session2.open(alwaysProceed, capturedRef!);
    expect(opened).toBe(true);

    // Loaded manifest matches
    expect(host2.manifest.entries).toHaveLength(1);
    expect(host2.manifest.entries[0]!.id).toBe("a1");

    // Timeline round-trips
    expect(host2.timeline.fps).toBe(host1.timeline.fps);

    // Media bytes persisted and readable through the bound gateway
    const state = session2.getState();
    expect(state.ref?.id).toBe("saved-proj");
    // Access the gateway's bound project to check media
    const bound = await gw2.bind(capturedRef!);
    const readBytes = await bound.media.readMedia(mediaPath);
    expect(Array.from(readBytes)).toEqual(Array.from(bytes));
  });

  it("new with dirty guard: cancel keeps state unchanged", async () => {
    const host = new FakeHost();
    const gw = new InMemoryProjectGateway();
    const session = new ProjectSession(host, gw);
    host.timeline = { ...host.timeline, fps: 60 }; // make dirty
    const originalTimeline = host.timeline;

    const result = await session.newProject(alwaysCancel);
    expect(result).toBe(false);
    expect(host.timeline).toBe(originalTimeline); // unchanged
  });

  it("new with dirty guard: confirm resets to default", async () => {
    const host = new FakeHost();
    const gw = new InMemoryProjectGateway();
    const session = new ProjectSession(host, gw);
    host.timeline = { ...host.timeline, fps: 60 };

    const result = await session.newProject(alwaysProceed);
    expect(result).toBe(true);
    expect(session.getState().ref).toBeNull();
    expect(host.timeline.fps).toBe(30); // defaultTimeline fps
    expect(host.timeline.tracks).toHaveLength(0);
    expect(session.isDirty()).toBe(false);
  });

  it("save with no ref delegates to saveAs and adopts the ref", async () => {
    let capturedRef: ProjectRef | null = null;
    const gw = new InMemoryProjectGateway({
      saveAsFactory: (name) => {
        const ref: ProjectRef = { id: "new-id", name };
        capturedRef = ref;
        return ref;
      },
    });
    const host = new FakeHost();
    const session = new ProjectSession(host, gw);

    const ok = await session.save();
    expect(ok).toBe(true);
    expect(session.getState().ref?.id).toBe("new-id");
    expect(capturedRef).not.toBeNull();
  });

  it("saveAs cancel: returns false, ref unchanged", async () => {
    const gw = new InMemoryProjectGateway({
      saveAsFactory: () => null,
    });
    const host = new FakeHost();
    const session = new ProjectSession(host, gw);

    const ok = await session.saveAs();
    expect(ok).toBe(false);
    expect(session.getState().ref).toBeNull();
  });

  it("save with no ref delegates to saveAs and adopts ref (via newProject)", async () => {
    const gw = new InMemoryProjectGateway();
    const host = new FakeHost();
    const session = new ProjectSession(host, gw);

    const reset = await session.newProject(alwaysProceed);
    expect(reset).toBe(true);
    expect(session.getState().ref).toBeNull();

    const ok = await session.save();
    expect(ok).toBe(true);
    expect(session.getState().ref).not.toBeNull();
    expect(session.isDirty()).toBe(false);
  });

  it("saveAs rejects with clear error when media path not pending and no bound project", async () => {
    const mediaPath = "media/orphan.mp4";
    const manifest: MediaManifest = {
      version: 2,
      entries: [
        {
          id: "c1",
          name: "orphan.mp4",
          type: "video",
          source: { kind: "project", relativePath: mediaPath },
          duration: 2,
        },
      ],
      folders: [],
    };
    // Fresh session — no bound, no pending
    const host = new FakeHost({ manifest });
    const gw = new InMemoryProjectGateway();
    const session = new ProjectSession(host, gw);

    await expect(session.saveAs()).rejects.toThrow(`saveAs: cannot source media "${mediaPath}"`);
  });

  it("saveAs copies already-persisted media from old bound", async () => {
    const mediaPath = "media/existing.mp4";
    const bytes = new Uint8Array([10, 20, 30]);
    const manifest: MediaManifest = {
      version: 2,
      entries: [
        {
          id: "b1",
          name: "existing.mp4",
          type: "video",
          source: { kind: "project", relativePath: mediaPath },
          duration: 3,
        },
      ],
      folders: [],
    };

    // First: create + save an initial project so it's on disk (in-memory)
    const initialRef: ProjectRef = { id: "initial", name: "Initial" };
    let newRef: ProjectRef | null = null;
    const gw = new InMemoryProjectGateway({
      saveAsFactory: (name) => {
        newRef = { id: "copy-proj", name };
        return newRef;
      },
    });

    // Seed the initial project's store with a valid doc
    const initBound = await gw.bind(initialRef);
    const { writeProject } = await import("./project-io.js");
    await writeProject(initBound.store, { timeline: defaultTimeline(), manifest, generationLog: emptyGenerationLog() });
    // Write the media bytes into the initial project's media gateway (already persisted, no pending)
    await initBound.media.writeMedia(mediaPath, bytes);

    // Open a session pointing at the initial project
    const host = new FakeHost();
    const session = new ProjectSession(host, gw);
    const opened = await session.open(alwaysProceed, initialRef);
    expect(opened).toBe(true);
    // No pending media (the file is already in the old bound's media gateway)
    expect(host.pending.size).toBe(0);

    // saveAs to a new ref — should copy the persisted media from old bound
    const ok = await session.saveAs();
    expect(ok).toBe(true);
    expect(newRef).not.toBeNull();

    // New project's media gateway should have the copied file
    const copyBound = await gw.bind(newRef!);
    expect(await copyBound.media.hasMedia(mediaPath)).toBe(true);
    const copiedBytes = await copyBound.media.readMedia(mediaPath);
    expect(Array.from(copiedBytes)).toEqual(Array.from(bytes));
  });

  it("subscribe fires on lifecycle changes", async () => {
    const gw = new InMemoryProjectGateway();
    const host = new FakeHost();
    const session = new ProjectSession(host, gw);
    let callCount = 0;
    const unsub = session.subscribe(() => callCount++);

    await session.newProject(alwaysProceed);
    expect(callCount).toBe(1);

    await session.save(); // saveAs since no ref
    expect(callCount).toBe(2);

    unsub();
    await session.newProject(alwaysProceed);
    expect(callCount).toBe(2); // no more calls after unsub
  });

  it("open with pickOpen queue returns false when queue empty", async () => {
    const gw = new InMemoryProjectGateway({ openQueue: [] });
    const host = new FakeHost();
    const session = new ProjectSession(host, gw);
    const result = await session.open(alwaysProceed);
    expect(result).toBe(false);
  });

  it("open via pickOpen uses queued ref", async () => {
    const ref: ProjectRef = { id: "queued-ref", name: "Queued" };
    const gw = new InMemoryProjectGateway({ openQueue: [ref] });
    // Seed the store for the ref with a valid project doc
    const bound = await gw.bind(ref);
    const { writeProject } = await import("./project-io.js");
    await writeProject(bound.store, {
      timeline: defaultTimeline(),
      manifest: emptyMediaManifest(),
      generationLog: emptyGenerationLog(),
    });

    const host = new FakeHost();
    const session = new ProjectSession(host, gw);
    const ok = await session.open(alwaysProceed); // no ref → uses queue
    expect(ok).toBe(true);
    expect(session.getState().ref?.id).toBe("queued-ref");
    expect(session.getState().name).toBe("Queued");
  });

  describe("corrupt media.json recovery", () => {
    it("open succeeds with an empty manifest when media.json is corrupt", async () => {
      const ref: ProjectRef = { id: "corrupt-proj", name: "Corrupt" };
      const gw = new InMemoryProjectGateway();
      const bound = await gw.bind(ref);
      await writeProject(bound.store, {
        timeline: defaultTimeline(),
        manifest: emptyMediaManifest(),
        generationLog: emptyGenerationLog(),
      });
      await bound.store.writeText(PROJECT_FILES.manifest, "{ this is not valid json");

      const host = new FakeHost();
      const session = new ProjectSession(host, gw);
      const opened = await session.open(alwaysProceed, ref);

      expect(opened).toBe(true);
      expect(host.manifest.entries).toEqual([]);
    });

    it("save right after opening a corrupt-manifest project preserves the original bytes", async () => {
      const ref: ProjectRef = { id: "corrupt-proj", name: "Corrupt" };
      const gw = new InMemoryProjectGateway();
      const bound = await gw.bind(ref);
      await writeProject(bound.store, {
        timeline: defaultTimeline(),
        manifest: emptyMediaManifest(),
        generationLog: emptyGenerationLog(),
      });
      const corrupt = "{ this is not valid json";
      await bound.store.writeText(PROJECT_FILES.manifest, corrupt);

      const host = new FakeHost();
      const session = new ProjectSession(host, gw);
      await session.open(alwaysProceed, ref);

      const ok = await session.save();

      expect(ok).toBe(true);
      expect(await bound.store.readText(PROJECT_FILES.manifest)).toBe(corrupt);
    });

    it("a rebuilt manifest is written and clears the load-failed flag; a later empty save is not held hostage", async () => {
      const ref: ProjectRef = { id: "corrupt-proj", name: "Corrupt" };
      const gw = new InMemoryProjectGateway();
      const bound = await gw.bind(ref);
      await writeProject(bound.store, {
        timeline: defaultTimeline(),
        manifest: emptyMediaManifest(),
        generationLog: emptyGenerationLog(),
      });
      const corrupt = "{ this is not valid json";
      await bound.store.writeText(PROJECT_FILES.manifest, corrupt);

      const host = new FakeHost();
      const session = new ProjectSession(host, gw);
      await session.open(alwaysProceed, ref);

      // Rebuild the library: the manifest is no longer empty, so save must write it for real.
      host.manifest = {
        version: 2,
        entries: [
          {
            id: "x",
            name: "x.mp4",
            type: "video",
            source: { kind: "project", relativePath: "media/x.mp4" },
            duration: 1,
          },
        ],
        folders: [],
      };
      await session.save();

      const rebuilt = await bound.store.readText(PROJECT_FILES.manifest);
      expect(rebuilt).not.toBe(corrupt);
      expect(JSON.parse(rebuilt!).entries).toHaveLength(1);

      // Empty the library and save again: the flag is clear now, so this must persist as empty
      // rather than resurrecting the rebuilt entries on a later reopen.
      host.manifest = emptyMediaManifest();
      await session.save();

      const emptied = await bound.store.readText(PROJECT_FILES.manifest);
      expect(JSON.parse(emptied!).entries).toEqual([]);
    });
  });
});
