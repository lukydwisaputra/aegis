export interface Finding {
  rule: string;
  severity: "error" | "warning";
  file: string;
  line: number;
  message: string;
  context: string;
}

/**
 * The lines of `text` with everything that is not the author's own prose blanked out with spaces (so columns and line numbers stay):
 * fenced code blocks, inline code spans, and double-quoted runs (straight or curly) on one line, which is where a requirement or an
 * error message is quoted verbatim.
 */
export function maskedLines(text: string): Array<{ line: number; text: string }> {
  let fenced = false;
  return text.split("\n").map((raw, i) => {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      return { line: i + 1, text: " ".repeat(raw.length) };
    }
    if (fenced) return { line: i + 1, text: " ".repeat(raw.length) };
    const blank = (m: string): string => " ".repeat(m.length);
    return { line: i + 1, text: raw.replace(/`[^`]*`/g, blank).replace(/"[^"\n]*"/g, blank).replace(/“[^”\n]*”/g, blank) };
  });
}

export interface ResolvedRuleLike {
  id: string;
  re: RegExp;
  message: string;
  severity: "error" | "warning";
}

const WINDOW = 40;

/**
 * Every match of every rule, in file order. A match whose neighbourhood contains an `allow` phrase is dropped.
 * A blank `allow` entry is ignored: an empty phrase would sit in every neighbourhood and silence the whole lint.
 */
export function scanWithRules(file: string, text: string, rules: readonly ResolvedRuleLike[], allow: readonly string[]): Finding[] {
  const originals = text.split("\n");
  const findings: Finding[] = [];
  const allowLower = allow.map((a) => a.trim().toLowerCase()).filter((a) => a !== "");
  for (const { line, text: masked } of maskedLines(text)) {
    for (const rule of rules) {
      const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : `${rule.re.flags}g`);
      for (let m = re.exec(masked); m !== null; m = re.exec(masked)) {
        if (m[0] === "") { re.lastIndex++; continue; }
        const orig = originals[line - 1] ?? "";
        const near = orig.slice(Math.max(0, m.index - WINDOW), m.index + m[0].length + WINDOW).toLowerCase();
        if (allowLower.some((a) => near.includes(a))) continue;
        findings.push({ rule: rule.id, severity: rule.severity, file, line, message: rule.message, context: orig.slice(Math.max(0, m.index - WINDOW), m.index + m[0].length + WINDOW).trim() });
      }
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}
