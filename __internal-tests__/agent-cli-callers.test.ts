import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { extractContract } from '@qa/alignment';
import { roleOf } from '@qa/path-guard';
import { assertCallerAllowed, CLI_COMMANDS, SINGLE_AGENT_COMMANDS, type CliCommand } from '@qa/run-state';

// P2c — every command an agent contract lists is one the CLI lets that agent run (caller rule, P2 spec §4.11.3).
const REPO = path.join(__dirname, '..');

const agentFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? agentFiles(path.join(dir, e.name)) : e.name.endsWith('.md') ? [path.join(dir, e.name)] : []));

const contracts = agentFiles(path.join(REPO, '.claude', 'agents')).flatMap((f) => {
  const c = extractContract(fs.readFileSync(f, 'utf-8'));
  if (typeof c === 'string') return [];
  const cli = (parse(c.yaml) as { cli?: unknown }).cli;
  return [{ agent: path.basename(f, '.md'), cli: Array.isArray(cli) ? cli.map(String) : [] }];
});

describe('agent contracts and the CLI caller rule', () => {
  it('reads the contracts of the agent roster', () => {
    expect(contracts.length).toBeGreaterThan(40);
    expect(contracts.find((c) => c.agent === 'qa-orchestrator')?.cli).toEqual(expect.arrayContaining(['phase.start', 'task.add']));
  });

  it('every cli: command of every agent contract is a CLI command the agent may run', () => {
    const refused: string[] = [];
    for (const { agent, cli } of contracts) {
      for (const cmd of cli) {
        if (!(CLI_COMMANDS as readonly string[]).includes(cmd)) {
          refused.push(`${agent}: ${cmd} (not a CLI command)`);
          continue;
        }
        try {
          assertCallerAllowed(agent, cmd as CliCommand);
        } catch (e) {
          refused.push(`${agent}: ${cmd} (${(e as Error).message})`);
        }
      }
    }
    expect(refused).toEqual([]);
  });

  it('every single-agent command names an agent with a role row', () => {
    const keys = Object.keys(SINGLE_AGENT_COMMANDS) as CliCommand[];
    expect(keys.length).toBeGreaterThan(0);
    for (const c of keys) expect({ command: c, role: roleOf(SINGLE_AGENT_COMMANDS[c]!)?.agent }).toEqual({ command: c, role: SINGLE_AGENT_COMMANDS[c] });
  });
});
