import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';

// Shared by the executive PDF script tests: a fixture repo root, the script runner and the text of a rendered PDF.
export const ROOT = path.join(__dirname, '..', '..');
export const SKILLS = path.join(ROOT, '.claude', 'skills');
export const SCRIPT = {
  technical: path.join(SKILLS, '_qa-report-technical-pdf', 'run.mjs'),
  signoff: path.join(SKILLS, '_qa-report-signoff-pdf', 'run.mjs'),
  slides: path.join(SKILLS, '_qa-report-executive-slides', 'run.mjs'),
};
export const RUN = 'RUN-20261004-001';
export const PROJECT = 'Northwind Portal';

export const temps: string[] = [];

/** A fixture repo root holding aegis.config.json and runs/RUN/... built from `files` (run-relative). */
export function fixture(files: Record<string, unknown>): { root: string; runDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-pdf-'));
  temps.push(root);
  fs.writeFileSync(path.join(root, 'aegis.config.json'), JSON.stringify({ dashboard: { projectName: PROJECT } }));
  const runDir = path.join(root, 'runs', RUN);
  fs.mkdirSync(runDir, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(runDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body));
  }
  return { root, runDir };
}

export function run(script: string, root: string, extra: string[] = []) {
  return spawnSync(process.execPath, [script, `--run=${RUN}`, ...extra], { env: { ...process.env, AEGIS_ROOT: root }, encoding: 'utf-8', timeout: 120000 });
}

/** The text runs of a PDF: every Tj/TJ string of every inflated content stream, one run per line. */
export function pdfText(file: string): string {
  const raw = fs.readFileSync(file).toString('latin1');
  const runs: string[] = [];
  const streams = /stream\r?\n([\s\S]*?)endstream/g;
  let s: RegExpExecArray | null;
  while ((s = streams.exec(raw))) {
    let body: string;
    try {
      body = zlib.inflateSync(Buffer.from(s[1] ?? '', 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    const ops = /\[((?:[^\]])*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g;
    let o: RegExpExecArray | null;
    while ((o = ops.exec(body))) {
      const hex = o[1] !== undefined ? [...o[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]).join('') : o[2];
      runs.push(Buffer.from(hex ?? '', 'hex').toString('latin1'));
    }
  }
  return runs.join('\n');
}

export const flat = (s: string): string => s.replace(/\s+/g, ' ');

export const GATE3 = {
  runId: RUN, gate: 3, label: 'Closure', sequence: 1, decision: 'approved-with-conditions',
  note: 'Ship after the login fix', decidedBy: 'owner', decidedAt: '2026-10-04T02:00:00Z',
};
