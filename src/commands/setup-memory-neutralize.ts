import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SetupStrategy } from './setup-strategy.ts';

export async function neutralizeMemoryFiles(bookDir: string, strategy: SetupStrategy, projectName: string): Promise<void> {
  await writeFile(join(bookDir, 'memory/canon.md'), renderCanon(strategy, projectName), 'utf8');
  await writeFile(join(bookDir, 'memory/foreshadowing.yaml'), 'hooks: []\n', 'utf8');
  await writeFile(join(bookDir, 'memory/plot_threads.yaml'), 'threads: []\n', 'utf8');
  await writeFile(join(bookDir, 'memory/character_state.yaml'), [
    'protagonist:',
    '  name: "待补充"',
    '  desire: "待补充"',
    '',
  ].join('\n'), 'utf8');
}

function renderCanon(strategy: SetupStrategy, projectName: string): string {
  const confirmed = [
    `- 项目名:${projectName}`,
    strategy.base !== 'none'
      ? `- 基础题材参考:${strategy.base}`
      : '- 题材:由概念定义,不依赖既有模板',
    ...strategy.invent.map((item) => `- 自定义元素:${item}`),
  ];

  return [
    '# 正史设定',
    '',
    '不可违背的设定记录。memory-curator 每章按 delta 追加,不重写。',
    '',
    '## 已确认设定',
    '',
    ...confirmed,
    '',
    '## 待确认设定',
    '',
    '(后续章节通过 memory-curator delta 补充)',
    '',
    '## 变更记录',
    '',
    '(memory-curator 每次更新时追加 `- chapter N: <delta>`)',
    '',
  ].join('\n');
}
