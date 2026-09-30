const TOKENS = new Set(["{run}", "{target}", "{tests}", "{aegis}"]);

/** Canonical spelling of a path pattern taken from a contract or from prose. */
export function normalizePath(raw: string): string {
  let p = (raw.trim().split(/\s+/)[0] ?? "").replace(/^`+/, "").replace(/[`,;:.)]+$/, "");
  p = p.replace(/^\.\//, "").replace(/^aegis\//, "");
  p = p.replace(/^runs\/\{[^}]+\}/, "{run}");
  p = p.replace(/^\.\.\/tests\//, "{tests}/").replace(/^tests\//, "{tests}/");
  if (p.endsWith("/")) p += "**";
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

type Tok = { k: "c"; c: string } | { k: "any" } | { k: "star" };

function tokens(seg: string): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]!;
    if (c === "{" && !TOKENS.has(seg) && seg.indexOf("}", i) !== -1) {
      i = seg.indexOf("}", i);
      out.push({ k: "any" }, { k: "star" }); // a placeholder is one or more characters
    } else if (c === "*") out.push({ k: "star" });
    else out.push({ k: "c", c });
  }
  return out;
}

/** Can one segment string satisfy both segment patterns? */
function segmentsOverlap(a: string, b: string): boolean {
  const x = tokens(a);
  const y = tokens(b);
  const memo = new Map<string, boolean>();
  const go = (i: number, j: number): boolean => {
    const key = `${i},${j}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let r = false;
    if (i === x.length && j === y.length) r = true;
    else {
      if (i < x.length && x[i]!.k === "star") r = go(i + 1, j) || (j < y.length && go(i, j + 1));
      if (!r && j < y.length && y[j]!.k === "star") r = go(i, j + 1) || (i < x.length && go(i + 1, j));
      if (!r && i < x.length && j < y.length) {
        const p = x[i]!;
        const q = y[j]!;
        if (p.k !== "star" && q.k !== "star" && (p.k === "any" || q.k === "any" || (p.k === "c" && q.k === "c" && p.c === q.c))) {
          r = go(i + 1, j + 1);
        }
      }
    }
    memo.set(key, r);
    return r;
  };
  return go(0, 0);
}

/** Could some path match both patterns? Symmetric, works on normalized spellings. */
export function overlaps(a: string, b: string): boolean {
  const x = normalizePath(a).split("/");
  const y = normalizePath(b).split("/");
  const memo = new Map<string, boolean>();
  const go = (i: number, j: number): boolean => {
    const key = `${i},${j}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let r = false;
    if (i === x.length && j === y.length) r = true;
    else {
      if (i < x.length && x[i] === "**") r = go(i + 1, j) || (j < y.length && go(i, j + 1));
      if (!r && j < y.length && y[j] === "**") r = go(i, j + 1) || (i < x.length && go(i + 1, j));
      if (!r && i < x.length && j < y.length && x[i] !== "**" && y[j] !== "**") {
        r = segmentsOverlap(x[i]!, y[j]!) && go(i + 1, j + 1);
      }
    }
    memo.set(key, r);
    return r;
  };
  return go(0, 0);
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
