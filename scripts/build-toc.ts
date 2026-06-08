/**
 * build-toc.ts — regenerate the Table of Contents in HANDBOOK.md.
 *
 * Scans HANDBOOK/NN-*.md chapter files in numeric order, derives each chapter's
 * title and one-line summary, and rewrites the table between the
 * `<!-- TOC START -->` and `<!-- TOC END -->` markers in HANDBOOK.md.
 *
 *   Chapter title  ← the file's H1 "## Chapter N — Title" (text after the em-dash)
 *   Summary        ← the chapter's intro blurb line "> _..._" (underscores/quote stripped)
 *
 * Run with: pnpm qa-build-toc
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const handbookDir = join(repoRoot, "HANDBOOK");
const handbookFile = join(repoRoot, "HANDBOOK.md");

const TOC_START = "<!-- TOC START -->";
const TOC_END = "<!-- TOC END -->";

type Chapter = { num: number; file: string; title: string; summary: string };

function extractTitle(content: string, fallback: string): string {
  // "## Chapter 4 — STLC Walkthrough"  →  "STLC Walkthrough"
  const h1 = content.match(/^#{1,2}\s+Chapter\s+\d+\s*[—–-]\s*(.+?)\s*$/m);
  if (h1?.[1]) return h1[1].trim();
  // Fallback: first heading of any level
  const anyHeading = content.match(/^#{1,3}\s+(.+?)\s*$/m);
  return anyHeading?.[1]?.trim() ?? fallback;
}

function extractSummary(content: string): string {
  // Blurb line: "> _..._"  (may contain inline code/backticks)
  const blurb = content.match(/^>\s*_(.+?)_\s*$/m);
  if (blurb?.[1]) return blurb[1].trim();
  // Fallback: first non-empty paragraph after the H1
  const lines = content.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (l && !l.startsWith("#") && !l.startsWith("---")) return l.replace(/^>\s*/, "");
  }
  return "";
}

function titleCaseFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const chapters: Chapter[] = readdirSync(handbookDir)
  .filter((f) => /^\d{2}-.+\.md$/.test(f))
  .map((file) => {
    const num = parseInt(file.slice(0, 2), 10);
    const slug = file.replace(/^\d{2}-/, "").replace(/\.md$/, "");
    const content = readFileSync(join(handbookDir, file), "utf-8");
    return {
      num,
      file,
      title: extractTitle(content, titleCaseFromSlug(slug)),
      summary: extractSummary(content),
    };
  })
  .sort((a, b) => a.num - b.num);

if (chapters.length === 0) {
  console.error(`No chapter files (NN-*.md) found in ${handbookDir}`);
  process.exit(1);
}

const rows = chapters
  .map((c) => `| ${c.num} | [${c.title}](HANDBOOK/${c.file}) | ${c.summary} |`)
  .join("\n");

const toc = [
  TOC_START,
  "## Table of Contents",
  "",
  "| # | Chapter | Summary |",
  "|---|---|---|",
  rows,
  "",
  TOC_END,
].join("\n");

const handbook = readFileSync(handbookFile, "utf-8");
const startIdx = handbook.indexOf(TOC_START);
const endIdx = handbook.indexOf(TOC_END);

if (startIdx === -1 || endIdx === -1) {
  console.error(`Could not find ${TOC_START} / ${TOC_END} markers in HANDBOOK.md`);
  process.exit(1);
}

const updated =
  handbook.slice(0, startIdx) + toc + handbook.slice(endIdx + TOC_END.length);

if (updated === handbook) {
  console.log(`TOC already up to date (${chapters.length} chapters).`);
} else {
  writeFileSync(handbookFile, updated, "utf-8");
  console.log(`Regenerated TOC with ${chapters.length} chapters in HANDBOOK.md`);
}
