import { describe, expect, test } from "vitest";
import { GenerationService } from "../src/generation/generation-service.js";
import type { GenerationHost } from "../src/generation/generation-service.js";
import type { GenJobGateway, JobStatus } from "../src/generation/gen-gateway.js";
import type { MediaManifestEntry } from "@palmier/core";

/** Lets any pending microtask chain (submit/poll/download/finalize) drain before assertions. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makePlaceholder(id: string, opts: { outputIndex?: number; name?: string } = {}): MediaManifestEntry {
  return {
    id,
    name: opts.name ?? `asset-${id}`,
    type: "image",
    source: { kind: "project", relativePath: `media/${id}.png` },
    duration: 5,
    generationInput: {
      prompt: "a cat",
      model: "fal-ai/model",
      duration: 5,
      aspectRatio: "1:1",
      outputIndex: opts.outputIndex ?? 0,
    },
    generationStatus: "preparing",
  };
}

function makeHost(seedEntries: MediaManifestEntry[] = []) {
  const events: string[] = [];
  const store = new Map(seedEntries.map((e) => [e.id, e]));
  const host: GenerationHost = {
    addPlaceholder(entry) {
      events.push(`addPlaceholder:${entry.id}`);
      store.set(entry.id, entry);
    },
    patchEntry(id, patch) {
      const status = patch.generationStatus ? `:${patch.generationStatus}` : "";
      events.push(`patch:${id}${status}`);
      const existing = store.get(id);
      if (existing) store.set(id, { ...existing, ...patch });
    },
    finalizeGenerated(id, bytes, patch) {
      events.push(`finalize:${id}:${bytes.length}`);
      const existing = store.get(id);
      if (existing) store.set(id, { ...existing, ...patch, generationStatus: undefined });
    },
    markGenerationFailed(ids, message) {
      events.push(`failed:${ids.join(",")}:${message}`);
    },
    entries() {
      return [...store.values()];
    },
    appendGenerationLog(entry) {
      events.push(`log:${entry.id}:${entry.model}:${entry.costCredits}`);
    },
    requestCheckpoint() {
      events.push("checkpoint");
    },
    notifyComplete(assetName) {
      events.push(`notify:${assetName}`);
    },
  };
  return { host, events, store };
}

function makeGateway(opts: {
  submit?: () => Promise<{ jobId: string }>;
  statuses?: JobStatus[]; // sequence returned by jobStatus; last entry repeats once exhausted
  onStatus?: (callIndex: number) => void;
  download?: (url: string) => Promise<Uint8Array>;
}) {
  const events: string[] = [];
  let statusIndex = 0;
  const gateway: GenJobGateway = {
    async submitJob(modelEndpoint, input) {
      events.push(`submitJob:${modelEndpoint}`);
      if (opts.submit) return opts.submit();
      void input;
      return { jobId: "job-1" };
    },
    async jobStatus(modelEndpoint, jobId) {
      const seq = opts.statuses ?? [{ status: "succeeded" as const, resultUrls: [] }];
      const status = seq[Math.min(statusIndex, seq.length - 1)]!;
      opts.onStatus?.(statusIndex);
      statusIndex++;
      events.push(`jobStatus:${modelEndpoint}:${jobId}:${status.status}`);
      return status;
    },
    async downloadResult(url) {
      events.push(`download:${url}`);
      if (opts.download) return opts.download(url);
      return new Uint8Array([1, 2, 3]);
    },
    async uploadFile() {
      return "https://v3.fal.media/files/uploaded";
    },
    async hasKey() {
      return true;
    },
  };
  return { gateway, events };
}

describe("GenerationService.startJob", () => {
  test("(a) happy path: submit -> queued -> running -> succeeded -> download -> finalize + log + notify, 2 checkpoints", async () => {
    const a = makePlaceholder("a");
    const { host, events: hostEvents, store } = makeHost([a]);
    const { gateway, events: gwEvents } = makeGateway({
      statuses: [{ status: "queued" }, { status: "running" }, { status: "succeeded", resultUrls: ["https://x/a.png"] }],
    });
    const service = new GenerationService(gateway, host, { sleep: async () => {}, pollDelay: () => 0 });

    const result = await service.startJob({
      modelEndpoint: "fal-ai/model",
      input: { prompt: "a cat" },
      placeholders: [a],
      model: "fal-ai/model",
      costCredits: 5,
    });
    expect(result).toEqual({ jobId: "job-1" });
    await flush();

    expect(hostEvents).toEqual([
      "patch:a:generating",
      "checkpoint",
      "patch:a:downloading",
      "finalize:a:3",
      "log:a:fal-ai/model:5",
      "notify:asset-a",
      "checkpoint",
    ]);
    expect(gwEvents).toEqual([
      "submitJob:fal-ai/model",
      "jobStatus:fal-ai/model:job-1:queued",
      "jobStatus:fal-ai/model:job-1:running",
      "jobStatus:fal-ai/model:job-1:succeeded",
      "download:https://x/a.png",
    ]);

    const entry = store.get("a")!;
    expect(entry.generationInput?.backendJobId).toBe("job-1");
    expect(entry.generationInput?.resultURLs).toEqual(["https://x/a.png"]);
  });

  test("(b) submit error: all placeholders failed, no poll", async () => {
    const a = makePlaceholder("a");
    const b = makePlaceholder("b", { outputIndex: 1 });
    const { host, events: hostEvents } = makeHost([a, b]);
    const { gateway, events: gwEvents } = makeGateway({
      submit: async () => {
        throw new Error("network down");
      },
    });
    const service = new GenerationService(gateway, host, { sleep: async () => {}, pollDelay: () => 0 });

    const result = await service.startJob({
      modelEndpoint: "fal-ai/model",
      input: {},
      placeholders: [a, b],
      model: "fal-ai/model",
    });

    expect(result).toEqual({ error: "network down" });
    await flush();
    expect(hostEvents).toEqual(["failed:a,b:network down"]);
    expect(gwEvents).toEqual(["submitJob:fal-ai/model"]);
  });

  test("(c) job failed: batch failed + checkpoint", async () => {
    const a = makePlaceholder("a");
    const { host, events: hostEvents } = makeHost([a]);
    const { gateway } = makeGateway({
      statuses: [{ status: "running" }, { status: "failed", errorMessage: "quota exceeded" }],
    });
    const service = new GenerationService(gateway, host, { sleep: async () => {}, pollDelay: () => 0 });

    await service.startJob({ modelEndpoint: "fal-ai/model", input: {}, placeholders: [a], model: "fal-ai/model" });
    await flush();

    expect(hostEvents).toEqual(["patch:a:generating", "checkpoint", "failed:a:quota exceeded", "checkpoint"]);
  });

  test("(d) 2 placeholders, 1 resultUrl: output 0 finalized, output 1 failed", async () => {
    const a = makePlaceholder("a", { outputIndex: 0 });
    const b = makePlaceholder("b", { outputIndex: 1 });
    const { host, events: hostEvents } = makeHost([a, b]);
    const { gateway } = makeGateway({
      statuses: [{ status: "succeeded", resultUrls: ["https://x/a.png"] }],
    });
    const service = new GenerationService(gateway, host, { sleep: async () => {}, pollDelay: () => 0 });

    await service.startJob({
      modelEndpoint: "fal-ai/model",
      input: {},
      placeholders: [a, b],
      model: "fal-ai/model",
    });
    await flush();

    expect(hostEvents).toEqual([
      "patch:a:generating",
      "patch:b:generating",
      "checkpoint",
      "patch:a:downloading",
      "finalize:a:3",
      "log:a:fal-ai/model:null",
      "failed:b:No URL for placeholder",
      "notify:asset-a",
      "checkpoint",
    ]);
  });

  test("(e) download rejects then retryDownload succeeds", async () => {
    const a = makePlaceholder("a");
    const { host, events: hostEvents, store } = makeHost([a]);
    let downloadCalls = 0;
    const { gateway } = makeGateway({
      statuses: [{ status: "succeeded", resultUrls: ["https://x/a.png"] }],
      download: async () => {
        downloadCalls++;
        if (downloadCalls === 1) throw new Error("network blip");
        return new Uint8Array([9, 9]);
      },
    });
    const service = new GenerationService(gateway, host, { sleep: async () => {}, pollDelay: () => 0 });

    await service.startJob({ modelEndpoint: "fal-ai/model", input: {}, placeholders: [a], model: "fal-ai/model" });
    await flush();

    expect(hostEvents).toContain("failed:a:Download failed: network blip");
    expect(store.get("a")!.generationInput?.resultURLs).toEqual(["https://x/a.png"]);
    expect(hostEvents.some((e) => e.startsWith("finalize:a"))).toBe(false);

    const ok = await service.retryDownload("a");
    expect(ok).toBe(true);
    expect(downloadCalls).toBe(2);
    expect(hostEvents.some((e) => e.startsWith("finalize:a"))).toBe(true);
    expect(hostEvents.some((e) => e.startsWith("log:a"))).toBe(true);
  });

  test("retryDownload returns false when the entry has no stashed resultURLs", async () => {
    const a = makePlaceholder("a");
    const { host } = makeHost([a]);
    const { gateway } = makeGateway({});
    const service = new GenerationService(gateway, host);

    expect(await service.retryDownload("a")).toBe(false);
    expect(await service.retryDownload("missing")).toBe(false);
  });
});

describe("GenerationService.resumePending", () => {
  test("(f) re-enters polling for an in-flight manifest group; does not double-start an active jobId", async () => {
    const c: MediaManifestEntry = {
      id: "c",
      name: "asset-c",
      type: "image",
      source: { kind: "project", relativePath: "media/c.png" },
      duration: 5,
      generationInput: { prompt: "a dog", model: "fal-ai/model", duration: 5, aspectRatio: "1:1", outputIndex: 0, backendJobId: "job-99" },
      generationStatus: "generating",
    };
    const { host, events: hostEvents } = makeHost([c]);
    const { gateway, events: gwEvents } = makeGateway({
      statuses: [{ status: "running" }, { status: "succeeded", resultUrls: ["https://x/c.png"] }],
    });
    const service = new GenerationService(gateway, host, { sleep: async () => {}, pollDelay: () => 0 });

    service.resumePending();
    service.resumePending(); // must not start a second parallel loop for job-99
    await flush();

    expect(gwEvents).toEqual([
      "jobStatus:fal-ai/model:job-99:running",
      "jobStatus:fal-ai/model:job-99:succeeded",
      "download:https://x/c.png",
    ]);
    expect(hostEvents).toContain("finalize:c:3");
    expect(hostEvents).toContain("notify:asset-c");
  });

  test("failed-with-resultURLs entries are retried directly, without re-polling the backend", async () => {
    const d: MediaManifestEntry = {
      id: "d",
      name: "asset-d",
      type: "image",
      source: { kind: "project", relativePath: "media/d.png" },
      duration: 5,
      generationInput: {
        prompt: "a bird",
        model: "fal-ai/model",
        duration: 5,
        aspectRatio: "1:1",
        outputIndex: 0,
        backendJobId: "job-42",
        resultURLs: ["https://x/d.png"],
      },
      generationStatus: "failed: Download failed: earlier error",
    };
    const { host, events: hostEvents } = makeHost([d]);
    const { gateway, events: gwEvents } = makeGateway({});
    const service = new GenerationService(gateway, host, { sleep: async () => {}, pollDelay: () => 0 });

    service.resumePending();
    await flush();

    expect(gwEvents.some((e) => e.startsWith("jobStatus"))).toBe(false);
    expect(hostEvents).toContain("finalize:d:3");
  });
});

describe("GenerationService.dispose", () => {
  test("(g) stops the poll loop; no gateway calls happen after dispose", async () => {
    const a = makePlaceholder("a");
    const { host } = makeHost([a]);
    let service!: GenerationService;
    let statusCalls = 0;
    const { gateway, events: gwEvents } = makeGateway({
      statuses: [{ status: "running" }],
      onStatus: () => {
        statusCalls++;
        if (statusCalls === 2) service.dispose();
      },
    });
    service = new GenerationService(gateway, host, { sleep: async () => {}, pollDelay: () => 0 });

    await service.startJob({ modelEndpoint: "fal-ai/model", input: {}, placeholders: [a], model: "fal-ai/model" });
    await flush();
    const callsRightAfterDispose = gwEvents.filter((e) => e.startsWith("jobStatus")).length;
    expect(callsRightAfterDispose).toBe(2);

    await flush();
    await flush();
    const callsLater = gwEvents.filter((e) => e.startsWith("jobStatus")).length;
    expect(callsLater).toBe(2);
  });

  test("the generating stamp merges from the HOST's current entry, not the caller's stale snapshot", async () => {
    const placeholder = makePlaceholder("p1");
    const { host, store } = makeHost([placeholder]);
    // A concurrent host-side write lands during the submit await; it must survive the stamp.
    const gateway: GenJobGateway = {
      async submitJob() {
        const cur = store.get("p1")!;
        store.set("p1", { ...cur, generationInput: { ...cur.generationInput!, voice: "raced-in" } });
        return { jobId: "job-1" };
      },
      async jobStatus() {
        return { status: "running" };
      },
      async downloadResult() {
        return new Uint8Array();
      },
      async uploadFile() {
        return "https://v3.fal.media/files/uploaded";
      },
      async hasKey() {
        return true;
      },
    };
    const svc = new GenerationService(gateway, host, { sleep: async () => {}, pollDelay: () => 0 });
    await svc.startJob({ modelEndpoint: "fal-ai/model", input: {}, placeholders: [placeholder], model: "m" });
    svc.dispose();
    await flush();
    const stamped = store.get("p1")!;
    expect(stamped.generationInput?.backendJobId).toBe("job-1");
    expect(stamped.generationInput?.voice).toBe("raced-in");
  });

  test("notifyComplete is NOT called when zero placeholders finalize", async () => {
    const placeholder = makePlaceholder("p1");
    const { host, events } = makeHost([placeholder]);
    const { gateway } = makeGateway({
      statuses: [{ status: "succeeded", resultUrls: ["https://x/f.png"] }],
      download: async () => {
        throw new Error("net down");
      },
    });
    const svc = new GenerationService(gateway, host, { sleep: async () => {}, pollDelay: () => 0 });
    await svc.startJob({ modelEndpoint: "fal-ai/model", input: {}, placeholders: [placeholder], model: "m" });
    await flush();
    await flush();
    expect(events.some((e) => e.startsWith("failed:p1"))).toBe(true);
    expect(events.some((e) => e.startsWith("notify:"))).toBe(false);
  });

  test("resumePending skips an in-flight group whose model endpoint is empty", async () => {
    const stuck = makePlaceholder("p1");
    stuck.generationStatus = "generating";
    stuck.generationInput = { ...stuck.generationInput!, model: "", backendJobId: "job-x" };
    const { host } = makeHost([stuck]);
    const { gateway, events: gwEvents } = makeGateway({ statuses: [{ status: "running" }] });
    const svc = new GenerationService(gateway, host, { sleep: async () => {}, pollDelay: () => 0 });
    svc.resumePending();
    await flush();
    await flush();
    expect(gwEvents.filter((e) => e.startsWith("jobStatus"))).toHaveLength(0);
    svc.dispose();
  });
});
