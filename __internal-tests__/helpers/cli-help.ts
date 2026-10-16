import { spawnSync } from 'child_process';
import * as path from 'path';
import { pathToFileURL } from 'url';

const cache = new Map<string, Map<string, string>>();

/**
 * The --help text of every `group verb` command of the built CLI (apps/cli/dist), keyed "group.verb", read in ONE child process
 * that loads the built program and asks each command for its help: the text `aegis group verb --help` prints. One node start
 * instead of one per command (about 60): the per-command spawns took 10 s idle and over 30 s on a loaded runner.
 */
export function builtCliHelp(repo: string): Map<string, string> {
  const hit = cache.get(repo);
  if (hit !== undefined) return hit;
  const program = pathToFileURL(path.join(repo, 'apps', 'cli', 'dist', 'program.js')).href;
  const code = [
    `const { buildProgram } = await import(${JSON.stringify(program)});`,
    'const out = {};',
    "for (const g of buildProgram().commands) for (const v of g.commands) out[g.name() + '.' + v.name()] = v.helpInformation();",
    'process.stdout.write(JSON.stringify(out));',
  ].join('\n');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`the built CLI program did not load: ${r.stderr}`);
  const help = new Map(Object.entries(JSON.parse(r.stdout) as Record<string, string>));
  cache.set(repo, help);
  return help;
}
