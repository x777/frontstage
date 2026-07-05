import { useStore } from "../store/use-store.js";
import { theme } from "../theme/theme.js";
import { MenuList, type MenuListItem } from "../primitives/index.js";
import { canLinkSelection, canUnlinkSelection, dispatchLinkSelection, dispatchUnlinkSelection, selectForwardFromClip, type EditorStore } from "@frontstage/core";

export interface ClipContextMenuState { x: number; y: number; clipId?: string }

export function ClipContextMenu({ store, menu, onClose }: { store: EditorStore; menu: ClipContextMenuState | null; onClose: () => void }) {
  const selection = useStore(store, (s) => s.selection);
  const timeline = useStore(store, (s) => s.timeline);
  if (!menu) return null;
  const canLink = canLinkSelection(timeline, selection);
  const canUnlink = canUnlinkSelection(timeline, selection);
  const clipId = menu.clipId;

  const items: MenuListItem[] = [
    { id: "select-forward-track", label: "Select Forward on Track", disabled: clipId == null, testid: "ctx-select-forward-track" },
    { id: "select-forward-all", label: "Select Forward on All Tracks", disabled: clipId == null, testid: "ctx-select-forward-all" },
    { id: "link", label: "Link", disabled: !canLink, testid: "ctx-link" },
    { id: "unlink", label: "Unlink", disabled: !canUnlink, testid: "ctx-unlink" },
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
