// Readable, secret-redacting logger. Everything printed here ends up in `docker logs`.

const SECRET_NAME = /TOKEN|SECRET|KEY|PASSWORD/i;

function collectSecrets(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_NAME.test(name) && typeof value === 'string' && value.length >= 8)
    .map(([, value]) => value as string)
    .sort((a, b) => b.length - a.length);
}

let secrets = collectSecrets(process.env);

/** Re-read secret values (tests / after env changes). */
export function refreshSecrets(env: NodeJS.ProcessEnv = process.env): void {
  secrets = collectSecrets(env);
}

export function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join('«redacted»');
  // Belt and braces: token-shaped strings even if they aren't in our env.
  return out.replace(/\b(ghp_|gho_|github_pat_|sk-ant-|xox[abp]-|xapp-)[A-Za-z0-9_\-]{8,}/g, '$1«redacted»');
}

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

function write(icon: string, msg: string): void {
  process.stdout.write(`[${stamp()}] ${icon} ${redact(msg)}\n`);
}

export const log = {
  info: (msg: string) => write('·', msg),
  step: (msg: string) => write('▶', msg),
  ok: (msg: string) => write('✓', msg),
  warn: (msg: string) => write('!', msg),
  error: (msg: string) => write('✗', msg),
  agent: (msg: string) => write('💬', msg),
  tool: (msg: string) => write('🔧', msg),
};
