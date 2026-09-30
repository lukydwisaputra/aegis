const TOKENS = new Set(["{run}", "{target}", "{tests}", "{aegis}"]);

/** Placeholder names that stand for exactly one artefact ID (`TC-AUTH-031`, `RUN-20260524-001`) — spec §5 AH-04. */
export const ID_PLACEHOLDERS: ReadonlySet<string> = new Set(["TC", "TC-ID", "DEF", "DEF-ID", "REQ", "REQ-id", "US", "AC", "SCN", "SCN-ID", "RISK", "runId", "runA", "runB"]);
const ID_SOURCE = "[A-Z]+(?:-[A-Z0-9]+)+";

/** Canonical spelling of a path pattern taken from a contract or from prose. */
export function normalizePath(raw: string): string {
  let p = (raw.trim().split(/\s+/)[0] ?? "").replace(/^`+/, "").replace(/[`,;:.)]+$/, "");
  p = p.replace(/^\.\//, "").replace(/^(\.\.\/)+aegis\//, "").replace(/^aegis\//, "");
  p = p.replace(/^runs\/\{[^}]+\}/, "{run}");
  // {tests} means <target>/tests (../tests), regardless of aegis.config.json#testsDir (../tests/qa).
  p = p.replace(/^\.\.\/tests\//, "{tests}/").replace(/^tests\//, "{tests}/");
  if (/^(\.\.\/)+/.test(p)) p = "{target}/" + p.replace(/^(\.\.\/)+/, "");
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
        out += ID_PLACEHOLDERS.has(seg.slice(i + 1, end)) ? `(?:${ID_SOURCE}|\\{[^/{}]+\\})` : "[^/]+";
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

/** One character from `set` (null = any character), or zero or more of them. */
type Tok = { k: "one" | "star"; set: string | null };

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const UPPER_DIGIT = UPPER + "0123456789";
const ID_TAIL = UPPER_DIGIT + "-";

function meet(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return true;
  if (a.length === 1) return b.includes(a);
  if (b.length === 1) return a.includes(b);
  for (const ch of a) if (b.includes(ch)) return true;
  return false;
}

/** A star absorbs one character of the other side; an ID star never absorbs an untyped placeholder's character. */
const fits = (star: Tok, one: Tok) => !(star.set !== null && one.set === null) && meet(star.set, one.set);

function tokens(seg: string): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]!;
    const end = c === "{" && !TOKENS.has(seg) ? seg.indexOf("}", i) : -1;
    if (end !== -1) {
      if (ID_PLACEHOLDERS.has(seg.slice(i + 1, end))) {
        // [A-Z]+(-[A-Z0-9]+)+, approximated as [A-Z][A-Z]*-[A-Z0-9][A-Z0-9-]*
        out.push({ k: "one", set: UPPER }, { k: "star", set: UPPER }, { k: "one", set: "-" }, { k: "one", set: UPPER_DIGIT }, { k: "star", set: ID_TAIL });
      } else {
        out.push({ k: "one", set: null }, { k: "star", set: null }); // a placeholder is one or more characters
      }
      i = end;
    } else if (c === "*") out.push({ k: "star", set: null });
    else out.push({ k: "one", set: c });
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
      const p = x[i];
      const q = y[j];
      if (p?.k === "star") r = go(i + 1, j) || (q?.k === "one" && fits(p, q) && go(i, j + 1));
      if (!r && q?.k === "star") r = go(i, j + 1) || (p?.k === "one" && fits(q, p) && go(i + 1, j));
      if (!r && p?.k === "one" && q?.k === "one" && meet(p.set, q.set)) r = go(i + 1, j + 1);
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

/** Token-rooted pattern whose remaining segments are all pure wildcards: exactly `**`, `*`, or one `{X}` placeholder (e.g. `{run}/**`, `{run}/{phase}/**`). */
export function isTooBroad(raw: string): boolean {
  const segs = normalizePath(raw).split("/");
  if (!TOKENS.has(segs[0]!)) return false;
  return segs.slice(1).every((s) => s === "**" || s === "*" || /^\{[^{},]+\}$/.test(s));
}
