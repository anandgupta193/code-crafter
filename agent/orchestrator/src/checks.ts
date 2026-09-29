import { sh, tail } from './exec.ts';
import { log } from './log.ts';

export interface CheckResult {
  name: string;
  command: string;
  ok: boolean;
  output: string;
}

/** Run the repo-declared checks from codecrafter.yaml, in order, all of them (so the agent sees every failure). */
export async function runChecks(commands: Record<string, string>, cwd: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const [name, command] of Object.entries(commands)) {
    log.step(`check ${name}: ${command}`);
    const r = await sh(command, { cwd, timeoutMs: 15 * 60_000 });
    const ok = r.code === 0;
    (ok ? log.ok : log.warn)(`check ${name} ${ok ? 'passed' : `failed (exit ${r.code})`}`);
    results.push({ name, command, ok, output: tail(`${r.stdout}\n${r.stderr}`, 80) });
  }
  return results;
}

export function checksTable(results: CheckResult[]): string {
  return ['| Check | Command | Result |', '|---|---|---|', ...results.map((r) => `| ${r.name} | \`${r.command}\` | ${r.ok ? '✅' : '❌'} |`)].join('\n');
}
