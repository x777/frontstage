/** A minimal XML element tree. Leaf text is a single string child; nested elements are XmlNode children. */
export interface XmlNode {
  tag: string;
  attrs?: Record<string, string | number>;
  children?: (XmlNode | string)[];
}

export function renderXml(root: XmlNode, opts?: { declaration?: string; doctype?: string }): string {
  const prefix = [opts?.declaration, opts?.doctype]
    .filter((line): line is string => !!line)
    .map((line) => `${line}\n`)
    .join("");
  return prefix + render(root, 0);
}

function render(node: XmlNode, indent: number): string {
  const pad = " ".repeat(indent);
  const attrs = renderAttrs(node.attrs);
  const children = node.children ?? [];

  if (children.length === 0) return `${pad}<${node.tag}${attrs}/>`;
  if (children.length === 1 && typeof children[0] === "string") {
    return `${pad}<${node.tag}${attrs}>${escapeXml(children[0])}</${node.tag}>`;
  }

  const innerPad = " ".repeat(indent + 2);
  const inner = children
    .map((child) => (typeof child === "string" ? `${innerPad}${escapeXml(child)}` : render(child, indent + 2)))
    .join("\n");
  return `${pad}<${node.tag}${attrs}>\n${inner}\n${pad}</${node.tag}>`;
}

function renderAttrs(attrs: Record<string, string | number> | undefined): string {
  if (!attrs) return "";
  let out = "";
  for (const [key, value] of Object.entries(attrs)) {
    out += ` ${key}="${escapeXml(String(value))}"`;
  }
  return out;
}

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
