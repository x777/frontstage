import { Editor } from "@frontstage/ui";
import type { EditorProps } from "@frontstage/ui";
import type { ProjectSession } from "@frontstage/core";

export interface AppProps extends EditorProps {
  session: ProjectSession;
}

export function App({ ...editorProps }: AppProps) {
  return <Editor {...editorProps} />;
}
