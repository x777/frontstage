import { describe, it, expect } from "vitest";
import { renderXml, type XmlNode } from "../../src/interop/xml.js";

describe("renderXml", () => {
  it("self-closes an element with no children", () => {
    expect(renderXml({ tag: "locked" })).toBe("<locked/>");
    expect(renderXml({ tag: "locked", children: [] })).toBe("<locked/>");
  });

  it("renders a single-string child inline as text", () => {
    expect(renderXml({ tag: "name", children: ["MyClip"] })).toBe("<name>MyClip</name>");
  });

  it("renders nested element children indented by 2 spaces per level", () => {
    const node: XmlNode = {
      tag: "a",
      children: [{ tag: "b", children: ["x"] }, { tag: "c" }],
    };
    expect(renderXml(node)).toBe(["<a>", "  <b>x</b>", "  <c/>", "</a>"].join("\n"));
  });

  it("renders attributes in insertion order", () => {
    const node: XmlNode = { tag: "clipitem", attrs: { id: "clipitem-1", version: 4 } };
    expect(renderXml(node)).toBe('<clipitem id="clipitem-1" version="4"/>');
  });

  it("escapes & < > \" ' in text content", () => {
    const node: XmlNode = { tag: "name", children: [`A & B < C > "D" 'E'`] };
    expect(renderXml(node)).toBe("<name>A &amp; B &lt; C &gt; &quot;D&quot; &apos;E&apos;</name>");
  });

  it("escapes & < > \" ' in attribute values", () => {
    const node: XmlNode = { tag: "x", attrs: { v: `A&B<C>"D"'E'` } };
    expect(renderXml(node)).toBe('<x v="A&amp;B&lt;C&gt;&quot;D&quot;&apos;E&apos;"/>');
  });

  it("escapes & before the entities it introduces (no double-escaping)", () => {
    // If '&' were replaced last, "<" -> "&lt;" would itself get "&" escaped again.
    expect(renderXml({ tag: "x", children: ["<"] })).toBe("<x>&lt;</x>");
  });

  it("prepends an optional declaration and doctype, each on their own line", () => {
    const xml = renderXml(
      { tag: "xmeml", attrs: { version: "4" } },
      { declaration: '<?xml version="1.0" encoding="UTF-8"?>', doctype: "<!DOCTYPE xmeml>" },
    );
    expect(xml).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"/>');
  });

  it("omits declaration/doctype lines that are not provided", () => {
    expect(renderXml({ tag: "a" }, { declaration: "<?xml?>" })).toBe("<?xml?>\n<a/>");
    expect(renderXml({ tag: "a" })).toBe("<a/>");
  });

  it("emits multiple children each on their own indented line", () => {
    const node: XmlNode = {
      tag: "sequence",
      children: [
        { tag: "name", children: ["Timeline Export"] },
        { tag: "duration", children: ["0"] },
      ],
    };
    expect(renderXml(node)).toBe(["<sequence>", "  <name>Timeline Export</name>", "  <duration>0</duration>", "</sequence>"].join("\n"));
  });
});
