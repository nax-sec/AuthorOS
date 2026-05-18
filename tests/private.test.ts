import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';
import {
  applyPrivateStyleRewrite,
  previewPrivateStyleRewrite,
} from '../src/commands/private.ts';
import {
  bindStyleProfile,
  createStyleProfileFromText,
  saveStyleProfile,
} from '../src/commands/style.ts';
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

function fakePrivateLlm(capture?: (prompt: string) => void): LlmClient {
  return {
    async generate(prompt) {
      capture?.(prompt);
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

async function createBookWithChapter(root: string, llm: LlmClient = fakePrivateLlm()): Promise<void> {
  assert.equal(await run(['private', 'new', '--title', 'HP Audit', '--concept', 'HP', '--root', root], root, silentIo().io, {
    env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
    llm,
  }), 0);
  assert.equal(await run(['private', 'continue', '--root', root], root, silentIo().io, {
    env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
    llm,
  }), 0);
}

async function bindTestStyle(root: string): Promise<string> {
  const projectDir = join(root, 'books/hp-audit');
  const profile = createStyleProfileFromText(root, {
    name: '雨夜冷调',
    text: [
      '雨从旧楼的檐角垂下来，像一串没说完的话。林岚把伞收在门外，先听见楼道深处的水声，然后才看见门缝里透出的灯。',
      '她没有立刻敲门。她习惯先把现场的呼吸数一遍：电梯停在三楼，窗台上有半枚烟灰，墙面新刷过，却盖不住潮气。',
      '“你迟到了。”门内的人说。',
      '“我在等你决定要不要撒谎。”林岚回答。她的语气很轻，像把刀背放在桌上，没有声响，却让人知道刀还在那里。',
      '房间里没有多余的家具。一张桌，一盏灯，一只杯口裂开的白瓷杯。她闻到冷茶、灰尘和某种廉价香水混在一起。',
    ].join('\n\n'),
    now: new Date('2026-05-18T00:00:00Z'),
  });
  await saveStyleProfile(root, profile);
  await bindStyleProfile(root, projectDir, profile.id, new Date('2026-05-18T01:00:00Z'));
  return profile.id;
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

test('private style rewrite preview requires a bound style profile', async () => {
  await withTempRoot(async (root) => {
    const llm = fakePrivateLlm();
    await createBookWithChapter(root, llm);

    await assert.rejects(
      () => previewPrivateStyleRewrite(root, {
        chapter: 'latest',
        intent: 'remove_ai_voice',
        text: '去掉 AI 味',
        llm,
      }),
      /No style profile bound/,
    );
  });
});

test('private style rewrite previews saved content and apply writes the saved preview', async () => {
  await withTempRoot(async (root) => {
    let captured = '';
    const llm = fakePrivateLlm((prompt) => {
      if (prompt.includes('REVISE_CHAPTER')) captured = prompt;
    });
    await createBookWithChapter(root, llm);
    const profileId = await bindTestStyle(root);
    const chapterPath = join(root, 'books/hp-audit/chapters/0001.md');
    const before = await readFile(chapterPath, 'utf8');

    const preview = await previewPrivateStyleRewrite(root, {
      chapter: 'latest',
      intent: 'remove_ai_voice',
      text: '去掉 AI 味，保留案卷冷幽默。',
      llm,
      now: new Date('2026-05-18T02:00:00Z'),
    });

    assert.equal(preview.book.id, 'hp-audit');
    assert.equal(preview.chapter, 1);
    assert.equal(preview.profile.id, profileId);
    assert.equal(preview.pendingPath, '.authoros/private/pending-style-rewrite.json');
    assert.match(captured, /Private style rewrite for chapter 1/);
    assert.match(captured, /intent: remove_ai_voice/);
    assert.match(captured, /雨夜冷调/);

    const afterPreview = await readFile(chapterPath, 'utf8');
    assert.equal(afterPreview, before);

    const pending = JSON.parse(await readFile(join(root, 'books/hp-audit/.authoros/private/pending-style-rewrite.json'), 'utf8'));
    assert.equal(pending.version, 1);
    assert.equal(pending.profile_id, profileId);
    assert.equal(pending.profile_name, '雨夜冷调');
    assert.equal(pending.intent, 'remove_ai_voice');
    assert.equal(pending.text, '去掉 AI 味，保留案卷冷幽默。');
    assert.match(pending.preview_content, /自愿繁殖声明/);
    assert.match(pending.original_hash, /^[a-f0-9]{64}$/);

    const applied = await applyPrivateStyleRewrite(root, { now: new Date('2026-05-18T03:00:00Z') });
    assert.equal(applied.book.id, 'hp-audit');
    assert.equal(applied.chapter, 1);
    assert.equal(applied.profileId, profileId);

    const draftBackup = await readFile(join(root, 'books/hp-audit/chapters/0001.draft.md'), 'utf8');
    assert.equal(draftBackup, before);
    const afterApply = await readFile(chapterPath, 'utf8');
    assert.match(afterApply, /自愿繁殖声明/);
    await assert.rejects(() => stat(join(root, 'books/hp-audit/.authoros/private/pending-style-rewrite.json')));
  });
});

test('private style rewrite apply rejects if the chapter changed after preview', async () => {
  await withTempRoot(async (root) => {
    const llm = fakePrivateLlm();
    await createBookWithChapter(root, llm);
    await bindTestStyle(root);
    const chapterPath = join(root, 'books/hp-audit/chapters/0001.md');

    await previewPrivateStyleRewrite(root, {
      chapter: 'latest',
      intent: 'style_polish',
      text: '按绑定文风润色。',
      llm,
      now: new Date('2026-05-18T02:00:00Z'),
    });
    await writeFile(chapterPath, '# 章节 1\n\n正文已经被手动改过。', 'utf8');

    await assert.rejects(
      () => applyPrivateStyleRewrite(root),
      /changed since the style rewrite preview was created/,
    );
    const after = await readFile(chapterPath, 'utf8');
    assert.match(after, /手动改过/);
    await stat(join(root, 'books/hp-audit/.authoros/private/pending-style-rewrite.json'));
  });
});

test('private style-preview and style-apply are available from the CLI', async () => {
  await withTempRoot(async (root) => {
    const llm = fakePrivateLlm();
    await createBookWithChapter(root, llm);
    await bindTestStyle(root);

    const previewIo = silentIo();
    assert.equal(await run([
      'private',
      'style-preview',
      '--intent',
      'anti-ai',
      '--text',
      '去掉 AI 味',
      '--root',
      root,
    ], root, previewIo.io, {
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
      llm,
      now: new Date('2026-05-18T02:00:00Z'),
    }), 0, previewIo.err.join(''));
    assert.match(previewIo.out.join(''), /Private Author: style rewrite preview/);
    await stat(join(root, 'books/hp-audit/.authoros/private/pending-style-rewrite.json'));

    const applyIo = silentIo();
    assert.equal(await run(['private', 'style-apply', '--root', root], root, applyIo.io, {
      env: {},
      now: new Date('2026-05-18T03:00:00Z'),
    }), 0, applyIo.err.join(''));
    assert.match(applyIo.out.join(''), /Private Author: style rewrite applied/);

    const after = await readFile(join(root, 'books/hp-audit/chapters/0001.md'), 'utf8');
    assert.match(after, /自愿繁殖声明/);
  });
});

test('private help mentions style rewrite commands', async () => {
  const io = silentIo();
  assert.equal(await run(['private', '--help'], process.cwd(), io.io, { env: {} }), 0, io.err.join(''));
  assert.match(io.out.join(''), /style-preview/);
  assert.match(io.out.join(''), /style-apply/);
});
