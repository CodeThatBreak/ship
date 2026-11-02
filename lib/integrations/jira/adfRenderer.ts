import "server-only";

/** Flatten Atlassian Document Format into plain text. */
export class AdfRenderer {
  static toText(node: unknown): string {
    if (!node) return "";
    if (typeof node === "string") return node;
    const n = node as {
      text?: string;
      type?: string;
      content?: unknown[];
    };
    let out = "";
    if (n.text) out += n.text;
    if (Array.isArray(n.content)) {
      const parts = n.content.map((child) => AdfRenderer.toText(child));
      const joined = parts.join("");
      out += joined;
      if (["paragraph", "heading", "listItem", "codeBlock", "blockquote"].includes(n.type ?? "")) out += "\n";
      if (n.type === "listItem") out = `• ${out}`;
    }
    return out;
  }
}
