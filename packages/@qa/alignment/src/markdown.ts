/**
 * Dependency-free Markdown helpers. The baseline guard script imports this module through tsx
 * before `pnpm build` runs in CI, so it must not import `@qa/contracts` or `@qa/run-state`.
 */

export const CONTRACT_HEADING = "## Contract (machine-checked)";

/** The one frontmatter scalar parser (AH-14): name, description, inline tools list. CRLF-safe; surrounding quotes stripped. */
export function frontmatterLite(source: string): { name?: string; description?: string; tools: string[] } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  const block = (m?.[1] ?? "").replace(/\r/g, "");
  const scalar = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(block)?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2");
  const name = scalar("name");
  const description = scalar("description");
  const tools = /^tools:\s*\[(.*)\]\s*$/m.exec(block)?.[1];
  return {
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    tools: tools === undefined ? [] : tools.split(",").map((t) => t.trim()).filter(Boolean),
  };
}

/**
 * 1-based inclusive line range of the contract block: the heading line through the closing fence.
 * Several headings span from the first one; a missing fence runs to the end of the file (the guard
 * then counts more lines as contract, never fewer). `null`: no contract heading. CRLF-safe.
 */
export function contractRange(source: string): { start: number; end: number } | null {
  const lines = source.split("\n");
  const heads = lines.flatMap((l, i) => (l.trim() === CONTRACT_HEADING ? [i] : []));
  if (heads.length === 0) return null;
  const last = heads[heads.length - 1]!;
  let open = -1;
  for (let i = last + 1; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t === "") continue;
    if (t.startsWith("```")) open = i;
    break;
  }
  const close = open === -1 ? -1 : lines.findIndex((x, j) => j > open && x.trim() === "```");
  return { start: heads[0]! + 1, end: close === -1 ? lines.length : close + 1 };
}

/** Lines outside the frontmatter and the contract block, 1-based, `\r` stripped. */
export function proseLines(source: string): Array<{ text: string; line: number }> {
  const lines = source.split("\n");
  const range = contractRange(source);
  const fmEnd = lines[0]?.trim() === "---" ? lines.findIndex((l, i) => i > 0 && l.trim() === "---") : -1;
  return lines.flatMap((text, i) => {
    const line = i + 1;
    if (i <= fmEnd) return [];
    if (range !== null && line >= range.start && line <= range.end) return [];
    return [{ text: text.replace(/\r$/, ""), line }];
  });
}
