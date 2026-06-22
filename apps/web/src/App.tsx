import { useEffect } from "react";
import { theme, Layout, persistLayout } from "@palmier/ui";
import type { EditorStore } from "@palmier/core";

interface AppProps {
  store: EditorStore;
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

export function App({ store }: AppProps) {
  useEffect(() => {
    return store.subscribe(() => persistLayout(store));
  }, [store]);

  return (
    <Layout
      store={store}
      media={<Placeholder label="Media" />}
      preview={<Placeholder label="Preview" />}
      timeline={<Placeholder label="Timeline" />}
      inspector={<Placeholder label="Inspector" />}
    />
  );
}
