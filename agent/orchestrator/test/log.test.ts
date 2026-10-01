import { afterEach, describe, expect, it } from 'vitest';
import { redact, refreshSecrets } from '../src/log.ts';

afterEach(() => refreshSecrets());

describe('redact', () => {
  it('hides secret env values but not the ticket key', () => {
    refreshSecrets({ GITHUB_TOKEN: 'supersecretvalue123', JIRA_TASK_KEY: 'SCRUM-10' });
    expect(redact('branch CODE-CRAFTER-SCRUM-10 pushed with supersecretvalue123')).toBe(
      'branch CODE-CRAFTER-SCRUM-10 pushed with «redacted»',
    );
  });
});
