import { useStore } from "../store/use-store.js";
import { theme } from "../theme/theme.js";
import { MenuList, type MenuListItem } from "../primitives/index.js";
import { canExtractAudioFromEntry, canLinkSelection, canUnlinkSelection, dispatchLinkSelection, dispatchUnlinkSelection, findClip, selectForwardFromClip, type EditorStore, type MediaManifestEntry } from "@frontstage/core";

export interface ClipContextMenuState { x: number; y: number; clipId?: string }

export function ClipContextMenu({
  store,
  menu,
  onClose,
  library,
  onExtractAudio,
}: {
  store: EditorStore;
  menu: ClipContextMenuState | null;
  onClose: () => void;
  library?: { getSnapshot(): { entries: MediaManifestEntry[] } };
  onExtractAudio?: (mediaRef: string) => void;
}) {
  const selection = useStore(store, (s) => s.selection);
  const timeline = useStore(store, (s) => s.timeline);
  if (!menu) return null;
  const canLink = canLinkSelection(timeline, selection);
  const canUnlink = canUnlinkSelection(timeline, selection);
  const clipId = menu.clipId;
  const loc = clipId ? findClip(timeline, clipId) : null;
  const clip = loc ? timeline.tracks[loc.trackIndex]!.clips[loc.clipIndex] : undefined;
  const entry = clip ? library?.getSnapshot().entries.find((e) => e.id === clip.mediaRef) : undefined;
  const canExtract = !!clip && !!entry && canExtractAudioFromEntry(entry) && !!onExtractAudio;
  const canNest = selection.size > 0;
  const canDecompose = clip?.sourceClipType === "sequence";

  const items: MenuListItem[] = [
    { id: "select-forward-track", label: "Select Forward on Track", disabled: clipId == null, testid: "ctx-select-forward-track" },
    { id: "select-forward-all", label: "Select Forward on All Tracks", disabled: clipId == null, testid: "ctx-select-forward-all" },
    { id: "link", label: "Link", disabled: !canLink, testid: "ctx-link" },
    { id: "unlink", label: "Unlink", disabled: !canUnlink, testid: "ctx-unlink" },
    { id: "nest-clips", label: "Nest Clips", disabled: !canNest, testid: "ctx-nest-clips", separatorBefore: true },
    { id: "decompose-nest", label: "Decompose Nested Timeline", disabled: !canDecompose, testid: "ctx-decompose-nest" },
    { id: "extract-audio", label: "Extract Audio", disabled: !canExtract, testid: "ctx-extract-audio" },
  ];

  function handleSelect(id: string) {
    switch (id) {
      case "select-forward-track":
        if (clipId != null) selectForwardFromClip(store, clipId, "track");
        break;
      case "select-forward-all":
        if (clipId != null) selectForwardFromClip(store, clipId, "allTracks");
        break;
      case "link":
        dispatchLinkSelection(store);
        break;
      case "unlink":
        dispatchUnlinkSelection(store);
        break;
      case "nest-clips":
        store.nestSelectedClips();
        break;
      case "decompose-nest":
        if (clipId != null) store.decomposeNest(clipId);
        break;
      case "extract-audio":
        if (clip && canExtract) onExtractAudio?.(clip.mediaRef);
        break;
    }
    onClose();
  }

  return (
    <div
      data-testid="clip-context-menu"
      role="menu"
      style={{ position: "absolute", left: menu.x, top: menu.y, zIndex: theme.z.menu }}
    >
      <MenuList items={items} onSelect={handleSelect} />
    </div>
  );
}
