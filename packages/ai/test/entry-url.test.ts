import { describe, expect, test } from "vitest";
import type { MediaManifestEntry } from "@frontstage/core";
import { makeEntryUrl, mimeForEntry } from "../src/generation/entry-url.js";
import type { EntryUrlDeps } from "../src/generation/entry-url.js";

function makeEntry(overrides: Partial<MediaManifestEntry> = {}): MediaManifestEntry {
  return {
    id: "e1",
    name: "clip.mp4",
    type: "video",
    source: { kind: "project", relativePath: "media/e1.mp4" },
    duration: 5,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<EntryUrlDeps> & { entryList?: MediaManifestEntry[] } = {}) {
  const { entryList = [makeEntry()], ...rest } = overrides;
  const patches: { id: string; patch: Partial<MediaManifestEntry> }[] = [];
  const uploadCalls: { bytes: Uint8Array; contentType: string; fileName: string }[] = [];

  const deps: EntryUrlDeps = {
    entries: () => entryList,
    patchEntry: (id, patch) => { patches.push({ id, patch }); },
    bytesFor: () => new Uint8Array([1, 2, 3]),
    readMedia: async () => new Uint8Array([9, 9, 9]),
    uploadFile: async (bytes, contentType, fileName) => {
      uploadCalls.push({ bytes, contentType, fileName });
      return "https://v3.fal.media/files/uploaded";
    },
    now: () => 1_000_000,
    ...rest,
  };
  return { deps, patches, uploadCalls };
}

describe("mimeForEntry", () => {
  test("maps by extension when known", () => {
    expect(mimeForEntry(makeEntry({ source: { kind: "project", relativePath: "media/a.png" }, type: "image" }))).toBe("image/png");
    expect(mimeForEntry(makeEntry({ source: { kind: "project", relativePath: "media/a.wav" }, type: "audio" }))).toBe("audio/wav");
  });

  test("falls back to type when extension is unknown", () => {
    expect(mimeForEntry(makeEntry({ source: { kind: "project", relativePath: "media/a.xyz" }, type: "video" }))).toBe("video/mp4");
  });

  test("falls back to octet-stream when neither extension nor type is known", () => {
    expect(mimeForEntry(makeEntry({ source: { kind: "project", relativePath: "media/a.xyz" }, type: "lottie" }))).toBe("application/octet-stream");
  });
});

describe("makeEntryUrl", () => {
  test("missing entry -> undefined, no side effects", async () => {
    const { deps, patches, uploadCalls } = makeDeps({ entryList: [] });
    const entryUrl = makeEntryUrl(deps);

    const result = await entryUrl("nope");

    expect(result).toBeUndefined();
    expect(patches).toHaveLength(0);
    expect(uploadCalls).toHaveLength(0);
  });

  test("fresh cache hit -> returns cachedRemoteURL without upload", async () => {
    const entry = makeEntry({ cachedRemoteURL: "https://cached", cachedRemoteURLExpiresAt: new Date(2_000_000).toISOString() });
    const { deps, uploadCalls } = makeDeps({ entryList: [entry], now: () => 1_000_000 });
    const entryUrl = makeEntryUrl(deps);

    const result = await entryUrl("e1");

    expect(result).toBe("https://cached");
    expect(uploadCalls).toHaveLength(0);
  });

  test("expired cache -> uploads again and patches fresh fields", async () => {
    const entry = makeEntry({ cachedRemoteURL: "https://stale", cachedRemoteURLExpiresAt: new Date(500_000).toISOString() });
    const { deps, patches, uploadCalls } = makeDeps({ entryList: [entry], now: () => 1_000_000 });
    const entryUrl = makeEntryUrl(deps);

    const result = await entryUrl("e1");

    expect(result).toBe("https://v3.fal.media/files/uploaded");
    expect(uploadCalls).toHaveLength(1);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.id).toBe("e1");
    expect(patches[0]!.patch.cachedRemoteURL).toBe("https://v3.fal.media/files/uploaded");
    expect(patches[0]!.patch.cachedRemoteURLExpiresAt).toBe(new Date(1_000_000 + 6 * 24 * 60 * 60 * 1000).toISOString());
  });

  test("no cache -> uses in-memory bytes (bytesFor) over the gateway fallback", async () => {
    const readMediaCalls: string[] = [];
    const { deps, uploadCalls } = makeDeps({
      bytesFor: () => new Uint8Array([1, 2, 3]),
      readMedia: async (p) => { readMediaCalls.push(p); return new Uint8Array([9]); },
    });
    const entryUrl = makeEntryUrl(deps);

    const result = await entryUrl("e1");

    expect(result).toBe("https://v3.fal.media/files/uploaded");
    expect(readMediaCalls).toHaveLength(0);
    expect(uploadCalls[0]!.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(uploadCalls[0]!.contentType).toBe("video/mp4");
    expect(uploadCalls[0]!.fileName).toBe("e1.mp4");
  });

  test("bytesFor misses -> falls back to readMedia(relativePath)", async () => {
    const readMediaCalls: string[] = [];
    const { deps, uploadCalls } = makeDeps({
      bytesFor: () => undefined,
      readMedia: async (p) => { readMediaCalls.push(p); return new Uint8Array([7, 7]); },
    });
    const entryUrl = makeEntryUrl(deps);

    const result = await entryUrl("e1");

    expect(result).toBe("https://v3.fal.media/files/uploaded");
    expect(readMediaCalls).toEqual(["media/e1.mp4"]);
    expect(uploadCalls[0]!.bytes).toEqual(new Uint8Array([7, 7]));
  });

  test("both bytesFor and readMedia miss -> undefined, no upload/patch", async () => {
    const { deps, patches, uploadCalls } = makeDeps({
      bytesFor: () => undefined,
      readMedia: async () => { throw new Error("not found"); },
    });
    const entryUrl = makeEntryUrl(deps);

    const result = await entryUrl("e1");

    expect(result).toBeUndefined();
    expect(patches).toHaveLength(0);
    expect(uploadCalls).toHaveLength(0);
  });

  test("non-project source with no in-memory bytes -> undefined (no relativePath to fall back on)", async () => {
    const entry = makeEntry({ source: { kind: "external", absolutePath: "/tmp/a.mp4" } });
    const { deps, uploadCalls } = makeDeps({ entryList: [entry], bytesFor: () => undefined });
    const entryUrl = makeEntryUrl(deps);

    const result = await entryUrl("e1");

    expect(result).toBeUndefined();
    expect(uploadCalls).toHaveLength(0);
  });
});
