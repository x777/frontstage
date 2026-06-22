import { useEffect } from "react";
import { theme, Layout, persistLayout, PreviewPanel } from "@palmier/ui";
import type { EditorStore } from "@palmier/core";
import type { MediaByteSource } from "@palmier/engine";

interface AppProps {
  store: EditorStore;
  media: MediaByteSource;
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

export function App({ store, media }: AppProps) {
  useEffect(() => {
    return store.subscribe(() => persistLayout(store));
  }, [store]);

  return (
    <Layout
      store={store}
      media={<Placeholder label="Media" />}
      preview={<PreviewPanel store={store} media={media} />}
      timeline={<Placeholder label="Timeline" />}
      inspector={<Placeholder label="Inspector" />}
    />
  );
}
