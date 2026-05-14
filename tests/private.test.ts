import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';
import type { LlmClient } from '../src/core/llm.ts';

async function withTempRoot(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-private-'));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function silentIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (message: string) => out.push(message),
      stderr: (message: string) => err.push(message),
    },
    out,
    err,
  };
}

function fakePrivateLlm(): LlmClient {
  return {
    async generate(prompt) {
      if (prompt.includes('SETUP_STRATEGY')) {
        return JSON.stringify({
          base: 'none',
          borrow_from: [],
          invent: ['战后魔法部审计'],
          scope_hint: 'this-book-only',
          per_section_intent: {
            'product.md': '写私人作者测试定位。',
            'author.md': '写私人作者测试作者。',
            'outline.md': '写私人作者测试大纲。',
            'world.md': '写私人作者测试世界。',
            'characters.yaml': '写私人作者测试人物。',
            'review_rules.md': '写私人作者测试评审。',
          },
          rationale: '私人作者测试',
        });
      }
      if (prompt.includes('SETUP_DISTILL')) {
        return JSON.stringify({ should_create: false, reason: 'covered by seed template' });
      }
      if (prompt.includes('SETUP_GENERATE_PRODUCT')) {
        return '# 作品定位\n\n## 题材\n\n战后魔法部审计同人。\n\n## 目标读者\n\n喜欢官僚冷幽默和证据链的读者。\n\n## 核心卖点\n\n- 用审计视角拆魔法部漏洞\n\n## 禁区\n\n- 不空降爽点';
      }
      if (prompt.includes('SETUP_GENERATE_AUTHOR')) {
        return '# 作者人格\n\n## 写作偏好\n\n克制、聪明、带冷幽默。\n\n## 反馈态度\n\n优先处理读者指出的不合理动机。\n\n## 决策原则\n\n人物可信优先。';
      }
      if (prompt.includes('SETUP_GENERATE_WORLD')) {
        return '# 世界与规则\n\n## 基础规则\n\n战后魔法部仍按旧流程运转。\n\n## 风险提醒\n\n不能让主角无成本碾压。';
      }
      if (prompt.includes('SETUP_GENERATE_OUTLINE')) {
        return '# 主线大纲\n\n## 节奏规则\n\n每章推进一个案卷漏洞。\n\n## 主线阶段\n\n- 第一阶段: 自动繁殖茶杯案暴露流程问题\n\n## 待规划章节\n\n- 第一章: 陆漪进入魔法部审计岗';
      }
      if (prompt.includes('SETUP_GENERATE_CHARACTERS')) {
        return 'protagonist:\n  name: "陆漪"\n  desire: "在魔法部站稳脚跟"\nmajor:\n  - name: "卢平"\n    role: "外部顾问"\nantagonists: []';
      }
      if (prompt.includes('SETUP_GENERATE_REVIEW_RULES')) {
        return '# 章节评审规则\n\n## 必查项\n\n- 官僚流程是否可信\n\n## 风险分级\n\n- 高: 主角无根据解决问题';
      }
      if (prompt.includes('PLAN_CHAPTER')) {
        return '## 主要冲突\n\n陆漪发现茶杯案卷宗存在程序瑕疵。\n\n## 爽点\n\n她用审计思维看出数据矛盾。\n\n## 章尾钩子\n\n案卷里多出一个未登记签名。';
      }
      if (prompt.includes('WRITE_CHAPTER')) {
        return '陆漪第一次坐在魔法部的旧木桌前,闻到羊皮纸和冷茶的味道。\n\n她翻开自动繁殖茶杯案,很快看见频率记录和魔力枯竭曲线对不上。\n\n她没有立刻指出问题,只是把那枚未登记签名圈了起来。';
      }
      if (prompt.includes('REVISION_NEEDED')) {
        return [
          'REVISION_NEEDED: yes',
          'rationale:',
          '- 按私人读者反馈补强冷幽默',
          '---',
          '陆漪第一次坐在魔法部的旧木桌前,闻到羊皮纸和冷茶的味道。',
          '',
          '她翻开自动繁殖茶杯案,发现表格第十七页居然要求茶杯签署自愿繁殖声明。',
          '',
          '她没有立刻指出问题,只是把那枚未登记签名圈了起来。',
        ].join('\n');
      }
      throw new Error(`unexpected prompt: ${prompt.slice(0, 80)}`);
    },
  };
}

test('private new creates a bookshelf and selects the new book', async () => {
  await withTempRoot(async (root) => {
    const io = silentIo();
    assert.equal(
      await run([
        'private',
        'new',
        '--title',
        'HP Audit',
        '--concept',
        'HP战后魔法部审计同人',
        '--root',
        root,
      ], root, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
        llm: fakePrivateLlm(),
        now: new Date('2026-05-14T00:00:00Z'),
      }),
      0,
      io.err.join(''),
    );

    const shelf = JSON.parse(await readFile(join(root, 'bookshelf.json'), 'utf8'));
    assert.equal(shelf.current, 'hp-audit');
    assert.equal(shelf.books[0].title, 'HP Audit');
    await stat(join(root, 'books/hp-audit/product.md'));
    assert.match(io.out.join(''), /Private Author: new book/);
  });
});

test('private new uses a stable short hash id for non-ascii titles', async () => {
  await withTempRoot(async (root) => {
    const title = '私测法医小镇';
    const expectedId = `book-${createHash('sha256').update(title).digest('hex').slice(0, 8)}`;
    const io = silentIo();

    assert.equal(
      await run([
        'private',
        'new',
        '--title',
        title,
        '--concept',
        '侦探小说,主角是法医,在小镇调查连环谋杀',
        '--root',
        root,
      ], root, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
        llm: fakePrivateLlm(),
      }),
      0,
      io.err.join(''),
    );

    const shelf = JSON.parse(await readFile(join(root, 'bookshelf.json'), 'utf8'));
    assert.equal(shelf.current, expectedId);
    assert.match(expectedId, /^book-[a-f0-9]{8}$/);
    await stat(join(root, 'books', expectedId, 'product.md'));
  });
});

test('private list and switch preserve multiple books', async () => {
  await withTempRoot(async (root) => {
    for (const title of ['HP Audit', 'Detective Town']) {
      const io = silentIo();
      assert.equal(
        await run(['private', 'new', '--title', title, '--concept', title, '--root', root], root, io.io, {
          env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
          llm: fakePrivateLlm(),
        }),
        0,
        io.err.join(''),
      );
    }

    const listIo = silentIo();
    assert.equal(await run(['private', 'list', '--root', root], root, listIo.io, { env: {} }), 0);
    assert.match(listIo.out.join(''), /hp-audit/);
    assert.match(listIo.out.join(''), /\* detective-town/);

    const switchIo = silentIo();
    assert.equal(await run(['private', 'switch', '--book', 'hp-audit', '--root', root], root, switchIo.io, { env: {} }), 0);
    assert.match(switchIo.out.join(''), /Current private book: hp-audit/);

    const shelf = JSON.parse(await readFile(join(root, 'bookshelf.json'), 'utf8'));
    assert.equal(shelf.current, 'hp-audit');
  });
});

test('private continue plans and writes the current book', async () => {
  await withTempRoot(async (root) => {
    const llm = fakePrivateLlm();
    assert.equal(await run(['private', 'new', '--title', 'HP Audit', '--concept', 'HP', '--root', root], root, silentIo().io, {
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
      llm,
    }), 0);

    const io = silentIo();
    assert.equal(await run(['private', 'continue', '--root', root], root, io.io, {
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
      llm,
      now: new Date('2026-05-14T01:00:00Z'),
    }), 0, io.err.join(''));

    await stat(join(root, 'books/hp-audit/plans/0001.md'));
    const chapter = await readFile(join(root, 'books/hp-audit/chapters/0001.md'), 'utf8');
    assert.match(chapter, /自动繁殖茶杯案/);
    assert.match(io.out.join(''), /Private Author: continued hp-audit chapter 1/);
  });
});

test('private read latest prints the latest chapter', async () => {
  await withTempRoot(async (root) => {
    const llm = fakePrivateLlm();
    assert.equal(await run(['private', 'new', '--title', 'HP Audit', '--concept', 'HP', '--root', root], root, silentIo().io, {
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
      llm,
    }), 0);
    assert.equal(await run(['private', 'continue', '--root', root], root, silentIo().io, {
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
      llm,
    }), 0);

    const io = silentIo();
    assert.equal(await run(['private', 'read', '--chapter', 'latest', '--root', root], root, io.io, { env: {} }), 0);
    assert.match(io.out.join(''), /Private Author: read hp-audit chapter 1/);
    assert.match(io.out.join(''), /未登记签名/);
  });
});

test('private feedback previews a chapter revision and apply writes it', async () => {
  await withTempRoot(async (root) => {
    const llm = fakePrivateLlm();
    assert.equal(await run(['private', 'new', '--title', 'HP Audit', '--concept', 'HP', '--root', root], root, silentIo().io, {
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
      llm,
    }), 0);
    assert.equal(await run(['private', 'continue', '--root', root], root, silentIo().io, {
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
      llm,
    }), 0);

    const feedbackIo = silentIo();
    assert.equal(await run([
      'private',
      'feedback',
      '--chapter',
      'latest',
      '--text',
      '这一章冷幽默不够,茶杯案可以更荒诞一点',
      '--root',
      root,
    ], root, feedbackIo.io, {
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
      llm,
    }), 0, feedbackIo.err.join(''));
    assert.match(feedbackIo.out.join(''), /Private Author: feedback preview/);
    await stat(join(root, 'books/hp-audit/.authoros/private/pending-feedback.json'));

    const before = await readFile(join(root, 'books/hp-audit/chapters/0001.md'), 'utf8');
    assert.doesNotMatch(before, /自愿繁殖声明/);

    const applyIo = silentIo();
    assert.equal(await run(['private', 'apply', '--root', root], root, applyIo.io, {
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
      llm,
    }), 0, applyIo.err.join(''));
    assert.match(applyIo.out.join(''), /Private Author: feedback applied/);

    const after = await readFile(join(root, 'books/hp-audit/chapters/0001.md'), 'utf8');
    assert.match(after, /自愿繁殖声明/);
    await assert.rejects(() => stat(join(root, 'books/hp-audit/.authoros/private/pending-feedback.json')));
  });
});
