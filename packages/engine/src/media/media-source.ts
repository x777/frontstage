/** Resolves a clip's mediaRef to its bytes for demuxing. Implemented by the harness (M2) and platform stores (later). */
export interface MediaByteSource {
  open(mediaRef: string): Promise<Blob>;
}
