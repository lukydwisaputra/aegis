/**
 * Dependency-free Markdown helpers. The baseline guard script imports this module through tsx
 * before `pnpm build` runs in CI, so it must not import `@qa/contracts` or `@qa/run-state`.
 */

export const CONTRACT_HEADING = "## Contract (machine-checked)";

export function frontmatterLite(source: string): { name?: string; tools: string[] } {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(source);
  const block = m?.[1] ?? "";
  const name = /^name:\s*(.+)$/m.exec(block)?.[1]?.trim();
  const tools = /^tools:\s*\[(.*)\]\s*$/m.exec(block)?.[1];
  return {
    ...(name !== undefined ? { name } : {}),
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
