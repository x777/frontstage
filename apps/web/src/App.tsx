import { Editor } from "@palmier/ui";
import type { EditorProps } from "@palmier/ui";

export type AppProps = EditorProps;

export function App(props: AppProps) {
  return <Editor {...props} />;
}
