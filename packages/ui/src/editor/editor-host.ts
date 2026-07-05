import type { EditorStore } from "@frontstage/core";
import type { MediaManifest, MediaGateway } from "@frontstage/core";
import type { ProjectHost, ProjectGateway, BoundProject } from "@frontstage/core";
import type { GenerationLogEntry } from "@frontstage/core";
import { emptyGenerationLog, resetStuckGenerations } from "@frontstage/core";

export interface EditorMediaHost {
  getManifest(): MediaManifest;
  loadManifest(m: MediaManifest, gateway: MediaGateway | null): void;
  pendingMedia(): Map<string, Uint8Array>;
  markMediaPersisted(paths: string[]): void;
  setGateway(g: MediaGateway | null): void;
}

// Wraps a ProjectGateway so bind() records the bound MediaGateway in a shared holder.
// The host's loadDoc reads the holder to pass the right gateway to loadManifest.
export interface WrappedGateway extends ProjectGateway {
  _lastMedia: MediaGateway | null;
}

export interface EditorHostResult {
  host: ProjectHost;
  wrappedGateway: WrappedGateway;
  appendGenerationLog: (entry: GenerationLogEntry) => void;
  getGenerationLog: () => GenerationLogEntry[];
}

export function createEditorHost(
  store: EditorStore,
  mediaHost: EditorMediaHost,
  gateway: ProjectGateway,
): EditorHostResult {
  let _lastMedia: MediaGateway | null = null;
  // True after bind(); consumed (reset false) on loadDoc so a new-doc loadDoc (no preceding bind) passes null.
  let _bindPending = false;
  let _genLog: GenerationLogEntry[] = [];

  const wrappedGateway: WrappedGateway = {
    get _lastMedia() {
      return _lastMedia;
    },
    async pickOpen() {
      return gateway.pickOpen();
    },
    async pickSaveAs(name) {
      return gateway.pickSaveAs(name);
    },
    async bind(ref): Promise<BoundProject> {
      const bound = await gateway.bind(ref);
      // Record only; setGateway is called in loadDoc so saveAs never repoints the live library.
      _lastMedia = bound.media;
      _bindPending = true;
      return bound;
    },
    async listRecent() {
      return gateway.listRecent();
    },
    async addRecent(ref) {
      return gateway.addRecent(ref);
    },
    async removeRecent(ref) {
      return gateway.removeRecent(ref);
    },
  };

  const host: ProjectHost = {
    getTimeline() {
      return store.getSnapshot().timeline;
    },
    getManifest() {
      return mediaHost.getManifest();
    },
    getGenerationLog() {
      return { version: 1 as const, entries: [..._genLog] };
    },
    loadDoc(doc) {
      // No preceding bind means new-doc path: clear stale gateway so empty manifest has no stale store.
      if (!_bindPending) _lastMedia = null;
      _bindPending = false;
      _genLog = doc.generationLog?.entries ? [...doc.generationLog.entries] : [];
      store.load(doc.timeline);
      // Clear stuck in-flight statuses (no resumable jobId) before entries ever reach the library.
      const manifest = { ...doc.manifest, entries: resetStuckGenerations(doc.manifest.entries) };
      mediaHost.loadManifest(manifest, _lastMedia);
      mediaHost.setGateway(_lastMedia);
    },
    pendingMedia() {
      return mediaHost.pendingMedia();
    },
    markMediaPersisted(paths) {
      mediaHost.markMediaPersisted(paths);
    },
  };

  function appendGenerationLog(entry: GenerationLogEntry): void {
    _genLog.push(entry);
  }

  // UI-facing read accessor — unwraps host.getGenerationLog()'s persist-shaped {version, entries}.
  function getGenerationLog(): GenerationLogEntry[] {
    return host.getGenerationLog().entries;
  }

  return { host, wrappedGateway, appendGenerationLog, getGenerationLog };
}
