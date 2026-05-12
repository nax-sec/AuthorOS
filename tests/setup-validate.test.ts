import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repairBookFileIfNeeded } from '../src/commands/setup-validate.ts';

async function withTempBook(body: (bookDir: string) => Promise<void>): Promise<void> {
  const bookDir = await mkdtemp(join(tmpdir(), 'authoros-v03-setup-validate-'));
  try {
    await body(bookDir);
  } finally {
    await rm(bookDir, { recursive: true, force: true });
  }
}

test('repairBookFileIfNeeded repairs missing headings and passes validation', async () => {
  await withTempBook(async (bookDir) => {
    await writeFile(join(bookDir, 'product.md'), '# 作品定位\n\n## 题材\n\n侦探小说\n', 'utf8');
    const calls: string[] = [];
    const llm = {
      async generate(prompt: string) {
        calls.push(prompt);
        assert.match(prompt, /SETUP_REPAIR/);
        assert.match(prompt, /Missing required heading: ## 目标读者/);
        return [
          '# 作品定位',
          '',
          '## 题材',
          '',
          '侦探小说',
          '',
          '## 目标读者',
          '',
          '喜欢法医悬疑的读者。',
          '',
          '## 核心卖点',
          '',
          '- 小镇连环案件',
          '',
          '## 禁区',
          '',
          '- 不空降破案信息',
          '',
        ].join('\n');
      },
    };

    const result = await repairBookFileIfNeeded(bookDir, 'demo', 'product.md', llm);

    assert.equal(result.repaired, true);
    assert.equal(calls.length, 1);
    assert.equal(result.violationsAfter.length, 0);
    const repaired = await readFile(join(bookDir, 'product.md'), 'utf8');
    assert.match(repaired, /## 目标读者/);
  });
});
