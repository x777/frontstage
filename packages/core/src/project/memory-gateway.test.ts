import { describe, it, expect } from "vitest";
import { InMemoryProjectGateway, InMemoryMediaGateway } from "./memory-gateway.js";
import { writeProject, readProject } from "./project-io.js";
import type { ProjectDoc } from "../schema/serialize.js";
import { defaultTimeline } from "../timeline.js";
import { emptyMediaManifest } from "../media.js";

const emptyLog = { version: 1, entries: [] };
const doc = (): ProjectDoc => ({ timeline: defaultTimeline(), manifest: emptyMediaManifest(), generationLog: emptyLog });

describe("InMemoryMediaGateway", () => {
  it("round-trips bytes + reports presence", async () => {
    const m = new InMemoryMediaGateway();
    expect(await m.hasMedia("media/a.mp4")).toBe(false);
    await m.writeMedia("media/a.mp4", new Uint8Array([1, 2, 3]));
    expect(await m.hasMedia("media/a.mp4")).toBe(true);
    expect(Array.from(await m.readMedia("media/a.mp4"))).toEqual([1, 2, 3]);
    await expect(m.readMedia("media/missing.mp4")).rejects.toThrow(/media not found/);
  });
  it("copies bytes on write (no aliasing)", async () => {
    const m = new InMemoryMediaGateway();
    const src = new Uint8Array([9, 9]);
    await m.writeMedia("media/x", src);
    src[0] = 0;
    expect(Array.from(await m.readMedia("media/x"))).toEqual([9, 9]);
  });
  it("readMedia returns a copy (no aliasing on read)", async () => {
    const m = new InMemoryMediaGateway();
    const bytes = new Uint8Array([5, 5, 5]);
    await m.writeMedia("media/y", bytes);
    const read1 = await m.readMedia("media/y");
    read1[0] = 99;
    const read2 = await m.readMedia("media/y");
    expect(Array.from(read2)).toEqual([5, 5, 5]);
  });
});

describe("InMemoryProjectGateway", () => {
  it("pickSaveAs creates a ref, bind round-trips the bundle via the M1 ProjectStore", async () => {
    const gw = new InMemoryProjectGateway();
    const ref = await gw.pickSaveAs("My Project");
    expect(ref).not.toBeNull();
    const bound = await gw.bind(ref!);
    await writeProject(bound.store, doc());
    const read = await readProject(bound.store);
    expect(read.timeline.fps).toBe(30);
  });
  it("pickOpen is driven by the injected queue", async () => {
    const ref = { id: "p1", name: "P1" };
    const gw = new InMemoryProjectGateway({ openQueue: [ref] });
    await gw.bind(ref); // register it
    expect(await gw.pickOpen()).toEqual(ref);
    expect(await gw.pickOpen()).toBeNull();
  });
  it("recent list is most-recent-first, deduped, capped", async () => {
    const gw = new InMemoryProjectGateway();
    const a = await gw.pickSaveAs("A"); const b = await gw.pickSaveAs("B");
    await gw.addRecent(a!); await gw.addRecent(b!); await gw.addRecent(a!);
    const recent = await gw.listRecent();
    expect(recent.map((r) => r.id)).toEqual([a!.id, b!.id]);
  });
  it("recent list capped at 10, most-recent-first", async () => {
    const gw = new InMemoryProjectGateway();
    const refs = [];
    for (let i = 0; i < 12; i++) {
      refs.push(await gw.pickSaveAs(`Project ${i}`));
    }
    for (const ref of refs) {
      await gw.addRecent(ref!);
    }
    const recent = await gw.listRecent();
    expect(recent).toHaveLength(10);
    expect(recent.map((r) => r.id)).toEqual(refs.slice(2).reverse().map((r) => r!.id));
  });
  it("pickSaveAs with cancelling factory returns null and does not register entry", async () => {
    const gw = new InMemoryProjectGateway({ saveAsFactory: () => null });
    const ref = await gw.pickSaveAs("Cancelled");
    expect(ref).toBeNull();
    const recent = await gw.listRecent();
    expect(recent).toHaveLength(0);
  });
  it("removeRecent removes a project from the recent list", async () => {
    const gw = new InMemoryProjectGateway();
    const a = await gw.pickSaveAs("A");
    const b = await gw.pickSaveAs("B");
    await gw.addRecent(a!);
    await gw.addRecent(b!);
    let recent = await gw.listRecent();
    expect(recent.map((r) => r.id)).toEqual([b!.id, a!.id]);
    await gw.removeRecent(a!);
    recent = await gw.listRecent();
    expect(recent.map((r) => r.id)).toEqual([b!.id]);
  });
});
