import type { Timeline } from "@palmier/core";
import type { EditorStore } from "@palmier/core";
import type { ToolResult, ToolSpec, ToolContext } from "./types.js";

export function ok(text: string): ToolResult {
  return { blocks: [{ kind: "text", text }], isError: false };
}

export function errorResult(message: string): ToolResult {
  return { blocks: [{ kind: "text", text: message }], isError: true };
}

export function asUndoStep(
  store: EditorStore,
  label: string,
  reducers: ((t: Timeline) => Timeline)[],
): void {
  store.dispatch({
    label,
    apply: (t) => reducers.reduce((acc, r) => r(acc), t),
  });
}

export class ToolExecutor {
  private readonly specs: ToolSpec[];
  private readonly ctx: ToolContext;

  constructor(specs: ToolSpec[], ctx: ToolContext) {
    this.specs = specs;
    this.ctx = ctx;
  }

  list(): { name: string; description: string; inputSchema: ToolSpec["inputSchema"] }[] {
    return this.specs.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  }

  async execute(name: string, args: unknown): Promise<ToolResult> {
    const spec = this.specs.find((s) => s.name === name);
    if (!spec) return errorResult(`unknown tool: ${name}`);

    const parsed = spec.inputSchema.safeParse(args);
    if (!parsed.success) {
      return errorResult(parsed.error.issues.map((i) => i.message).join("; "));
    }

    try {
      return await spec.run(parsed.data, this.ctx);
    } catch (err) {
      return errorResult(String(err));
    }
  }
}
