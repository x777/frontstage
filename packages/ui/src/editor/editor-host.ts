import type { EditorStore } from "@palmier/core";
import type { MediaManifest, MediaGateway } from "@palmier/core";
import type { ProjectHost, ProjectGateway, BoundProject } from "@palmier/core";
import { emptyGenerationLog } from "@palmier/core";

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
}

export function createEditorHost(
  store: EditorStore,
  mediaHost: EditorMediaHost,
  gateway: ProjectGateway,
): EditorHostResult {
  let _lastMedia: MediaGateway | null = null;

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
      _lastMedia = bound.media;
      mediaHost.setGateway(bound.media);
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
      return emptyGenerationLog();
    },
    loadDoc(doc) {
      store.load(doc.timeline);
      mediaHost.loadManifest(doc.manifest, _lastMedia);
    },
    pendingMedia() {
      return mediaHost.pendingMedia();
    },
    markMediaPersisted(paths) {
      mediaHost.markMediaPersisted(paths);
    },
  };

  return { host, wrappedGateway };
}
