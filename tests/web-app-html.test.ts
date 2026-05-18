import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('private web app exposes personal cockpit regions', async () => {
  const html = await readFile(new URL('../src/web/public/app.html', import.meta.url), 'utf8');

  assert.match(html, /AuthorOS Personal Cockpit/);
  assert.match(html, /data-testid="session-status"/);
  assert.match(html, /data-testid="next-action"/);
  assert.match(html, /data-testid="task-center"/);
  assert.match(html, /data-testid="chapter-reader"/);
  assert.match(html, /data-testid="assistant-chat"/);
  assert.match(html, /loadCockpit/);
  assert.match(html, /watchJob/);
  assert.match(html, /loadLatestChapter/);
  assert.match(html, /api\('\/api\/cockpit'\)/);
  assert.match(html, /api\('\/api\/jobs'\)/);
  assert.match(html, /EventSource/);
  assert.match(html, /completed/);
});
