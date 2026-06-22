import { useSyncExternalStore } from "react";
import type { EditorStore, EditorState } from "@palmier/core";

export function useStore<T>(store: EditorStore, selector: (s: EditorState) => T): T {
  return useSyncExternalStore(
    store.subscribe.bind(store),
    () => selector(store.getSnapshot()),
  );
}
