import { ClaudeCodeRunner } from './claude.ts';
import type { AgentRunner } from './types.ts';

/** Pick the adapter for `codecrafter.agent.provider`. Adding Cursor = one more case here. */
export function createRunner(provider: string): AgentRunner {
  switch (provider) {
    case 'claude':
      return new ClaudeCodeRunner();
    default:
      throw new Error(`agent provider "${provider}" is not supported yet (available: claude)`);
  }
}
