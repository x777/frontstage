import { useEffect } from "react";
import { theme, Layout, persistLayout, PreviewPanel, TimelinePanel } from "@palmier/ui";
import type { EditorStore } from "@palmier/core";
import type { MediaByteSource } from "@palmier/engine";
import type { MediaLibrary } from "./media-library.js";

interface AppProps {
  store: EditorStore;
  media: MediaByteSource;
  library: MediaLibrary;
}

function Placeholder({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: theme.text.muted,
        fontSize: theme.fontSize.sm,
      }}
    >
      {label}
    </div>
  );
}

export function App({ store, media, library: _library }: AppProps) {
  useEffect(() => {
    return store.subscribe(() => persistLayout(store));
  }, [store]);

  return (
    <Layout
      store={store}
      media={<Placeholder label="Media" />}
      preview={<PreviewPanel store={store} media={media} />}
      timeline={<TimelinePanel store={store} />}
      inspector={<Placeholder label="Inspector" />}
    />
  );
}
