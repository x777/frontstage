import type { ClipType } from "./clip-type.js";

export type MediaSource =
  | { kind: "external"; absolutePath: string }
  | { kind: "project"; relativePath: string };

export interface GenerationInput {
  prompt: string;
  model: string;
  duration: number;
  aspectRatio: string;
  resolution?: string;
  quality?: string;
  imageURLs?: string[];
  numImages?: number;
  voice?: string;
  lyrics?: string;
  styleInstructions?: string;
  instrumental?: boolean;
  generateAudio?: boolean;
  referenceImageURLs?: string[];
  referenceVideoURLs?: string[];
  referenceAudioURLs?: string[];
  imageURLAssetIds?: string[];
  referenceImageAssetIds?: string[];
  referenceVideoAssetIds?: string[];
  referenceAudioAssetIds?: string[];
  createdAt?: string; // ISO 8601
}

export interface MediaManifestEntry {
  id: string;
  name: string;
  type: ClipType;
  source: MediaSource;
  duration: number;
  generationInput?: GenerationInput;
  sourceWidth?: number;
  sourceHeight?: number;
  sourceFPS?: number;
  hasAudio?: boolean;
  folderId?: string;
  cachedRemoteURL?: string;
  cachedRemoteURLExpiresAt?: string; // ISO 8601
}

export interface MediaFolder {
  id: string;
  name: string;
  parentFolderId?: string;
}

export interface MediaManifest {
  version: number;
  entries: MediaManifestEntry[];
  folders: MediaFolder[];
}

export function emptyMediaManifest(): MediaManifest {
  return { version: 2, entries: [], folders: [] };
}

export function makeMediaFolder(name: string, parentFolderId?: string): MediaFolder {
  return parentFolderId === undefined
    ? { id: crypto.randomUUID(), name }
    : { id: crypto.randomUUID(), name, parentFolderId };
}
