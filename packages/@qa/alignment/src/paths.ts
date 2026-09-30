const TOKENS = new Set(["{run}", "{target}", "{tests}", "{aegis}"]);

/** Canonical spelling of a path pattern taken from a contract or from prose. */
export function normalizePath(raw: string): string {
  let p = raw.trim().replace(/^`+|`+$/g, "").replace(/[`,;:.)]+$/, "").split(/\s+/)[0] ?? "";
  p = p.replace(/^\.\//, "").replace(/^aegis\//, "");
  p = p.replace(/^runs\/\{[^}]+\}/, "{run}");
  p = p.replace(/^\.\.\/tests\//, "{tests}/").replace(/^tests\//, "{tests}/");
  return p;
}

function segmentRegex(seg: string): RegExp {
  if (TOKENS.has(seg)) return new RegExp(`^${seg.replace(/[{}]/g, "\\$&")}$`);
  let out = "";
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]!;
    if (c === "{") {
      const end = seg.indexOf("}", i);
      if (end !== -1) {
        out += "[^/]+";
        i = end;
        continue;
      }
    }
    if (c === "*") {
      out += "[^/]*";
      continue;
    }
    out += c.replace(/[.+?^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/** Does `pattern` (placeholders, *, **) match the concrete-ish path `concrete`? */
export function matches(pattern: string, concrete: string): boolean {
  const ps = normalizePath(pattern).split("/");
  const cs = normalizePath(concrete).split("/");
  const memo = new Map<string, boolean>();
  const go = (i: number, j: number): boolean => {
    const k = `${i},${j}`;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    let r: boolean;
    if (i === ps.length) r = j === cs.length;
    else if (ps[i] === "**") r = go(i + 1, j) || (j < cs.length && go(i, j + 1));
    else r = j < cs.length && segmentRegex(ps[i]!).test(cs[j]!) && go(i + 1, j + 1);
    memo.set(k, r);
    return r;
  };
  return go(0, 0);
}

/** A concrete stand-in for a pattern: every placeholder and glob becomes "x1". */
function sample(p: string): string {
  return normalizePath(p)
    .split("/")
    .map((s) => (TOKENS.has(s) ? s : s === "**" ? "x1" : s.replace(/\{[^}]+\}/g, "x1").replace(/\*/g, "x1")))
    .join("/");
}

export function overlaps(a: string, b: string): boolean {
  return matches(a, sample(b)) || matches(b, sample(a));
}

export function staticPrefix(p: string): string {
  const segs = normalizePath(p).split("/");
  const out: string[] = [];
  for (const s of segs) {
    if (/[{*]/.test(s)) break;
    out.push(s);
  }
  return out.join("/");
}
