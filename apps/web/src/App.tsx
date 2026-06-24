import { Editor } from "@palmier/ui";
import type { EditorProps } from "@palmier/ui";
import type { ProjectSession } from "@palmier/core";

export interface AppProps extends EditorProps {
  session: ProjectSession;
}

export function App({ ...editorProps }: AppProps) {
  return <Editor {...editorProps} />;
}
