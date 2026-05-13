import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';

async function withBook(body: (bookDir: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-console-'));
  try {
    const init = silentIo();
    const exit = await run(['init', 'demo', '--quick'], root, init.io);
    assert.equal(exit, 0, init.err.join(''));
    await body(join(root, 'demo'));
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

function fakeLlm(reply: string, capture?: (prompt: string, options?: { maxTokens?: number }) => void) {
  return {
    async generate(prompt: string, options?: { maxTokens?: number }) {
      capture?.(prompt, options);
      return reply;
    },
  };
}

function renameProductReply(): string {
  return [
    '[scope] book',
    '[impact]',
    '  medium: product.md - rename the top heading',
    '[edits]',
    '- file: product.md',
    '  op: replace-text',
    '  find: |',
    '    # 作品定位',
    '  replace: |',
    '    # 新作品定位',
    '[next]',
    '  author brief',
  ].join('\n');
}

test('console one-shot dry-run prints four blocks and does not write files', async () => {
  await withBook(async (bookDir) => {
    const before = await readFile(join(bookDir, 'product.md'), 'utf8');
    let captured = '';
    let capturedMaxTokens: number | undefined;
    const io = silentIo();

    const exit = await run(['console', '把作品定位标题改掉'], bookDir, io.io, {
      llm: fakeLlm(renameProductReply(), (prompt, options) => {
        captured = prompt;
        capturedMaxTokens = options?.maxTokens;
      }),
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
    });

    assert.equal(exit, 0, io.err.join(''));
    const output = io.out.join('');
    assert.match(output, /\[scope\] book/);
    assert.match(output, /\[impact\]/);
    assert.match(output, /\[edits\]/);
    assert.match(output, /\[next\]/);
    assert.match(output, /dry-run/);
    assert.match(captured, /Output MUST be exactly this structure/);
    assert.match(captured, /Scope selection rules/);
    assert.match(captured, /review_rules\.md/);
    assert.match(captured, /# append a section after an existing heading/);
    assert.match(captured, /op: append-after-heading/);
    assert.match(captured, /# rename a string across the whole file/);
    assert.match(captured, /op: rename-text/);
    assert.match(captured, /# replace a unique text block with new wording/);
    assert.match(captured, /op: replace-text/);
    assert.match(captured, /# replace a whole section with new content/);
    assert.match(captured, /op: replace-section/);
    assert.match(captured, /# prepend before a heading/);
    assert.match(captured, /op: prepend-before-heading/);
    assert.match(captured, /# set a yaml scalar field/);
    assert.match(captured, /op: set-yaml-key/);
    assert.match(captured, /# append item to yaml array/);
    assert.match(captured, /op: append-yaml-array-item/);
    assert.match(captured, /# delete yaml array item by predicate/);
    assert.match(captured, /op: delete-yaml-array-item/);
    assert.match(captured, /# create a new console delta file/);
    assert.match(captured, /op: create-file/);
    assert.match(captured, /Use the exact file field `memory\/console-\*\.delta\.md`/);
    assert.match(captured, /Do not include memory\/canon\.md/);
    assert.match(captured, /# append to an existing file/);
    assert.match(captured, /op: append-to-file/);
    assert.match(captured, /Op selection rules/);
    assert.match(captured, /append-after-heading/);
    assert.match(captured, /rename-text/);
    assert.match(captured, /replace-text` is the last resort/);
    assert.match(captured, /no chapters drafted yet/);
    assert.match(captured, /把作品定位标题改掉/);
    assert.equal(capturedMaxTokens, 5000);
    assert.equal(await readFile(join(bookDir, 'product.md'), 'utf8'), before);
    await assert.rejects(() => stat(join(bookDir, 'changes')));
  });
});

test('console one-shot invalid protocol reports the raw agent output', async () => {
  await withBook(async (bookDir) => {
    const io = silentIo();
    const exit = await run(['console', 'bad output'], bookDir, io.io, {
      llm: fakeLlm('[scope] book\n[impact]\nok\n[next]\nretry'),
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
    });

    assert.equal(exit, 1);
    const err = io.err.join('');
    assert.match(err, /missing \[edits\] block/);
    assert.match(err, /raw agent output:/);
    assert.match(err, /\[scope\] book/);
  });
});

test('console one-shot --write applies edits and writes a full change record', async () => {
  await withBook(async (bookDir) => {
    const io = silentIo();

    const exit = await run(['console', '--write', '把作品定位标题改掉'], bookDir, io.io, {
      llm: fakeLlm(renameProductReply()),
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
      now: new Date('2026-05-12T14:00:00Z'),
    });

    assert.equal(exit, 0, io.err.join(''));
    assert.match(await readFile(join(bookDir, 'product.md'), 'utf8'), /^# 新作品定位/);
    const changes = await readdir(join(bookDir, 'changes'));
    assert.equal(changes.length, 1);
    const changeDir = join(bookDir, 'changes', changes[0]!);
    const meta = await readFile(join(changeDir, 'meta.json'), 'utf8');
    assert.match(meta, /"agent": "author-console"/);
    assert.match(meta, /"files": \[\s*"product.md"/);
    assert.match(meta, /"editOps": \[\s*"replace-text"/);
    assert.doesNotMatch(meta, /"placeholder": true/);
    assert.match(await readFile(join(changeDir, 'before/product.md'), 'utf8'), /^# 作品定位/);
    assert.match(await readFile(join(changeDir, 'after/product.md'), 'utf8'), /^# 新作品定位/);
    assert.match(await readFile(join(changeDir, 'edits.yaml'), 'utf8'), /op: replace-text/);
  });
});

test('console log lists recorded changes', async () => {
  await withBook(async (bookDir) => {
    const write = silentIo();
    assert.equal(await run(['console', '--write', '把作品定位标题改掉'], bookDir, write.io, {
      llm: fakeLlm(renameProductReply()),
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
      now: new Date('2026-05-12T14:00:00Z'),
    }), 0, write.err.join(''));

    const log = silentIo();
    const exit = await run(['console', 'log'], bookDir, log.io, {
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
    });

    assert.equal(exit, 0, log.err.join(''));
    const output = log.out.join('');
    assert.match(output, /Changes:/);
    assert.match(output, /CHG-/);
    assert.match(output, /author-console/);
    assert.match(output, /product\.md/);
  });
});

test('console --rollback restores the before snapshot and records rollback history', async () => {
  await withBook(async (bookDir) => {
    const write = silentIo();
    assert.equal(await run(['console', '--write', '把作品定位标题改掉'], bookDir, write.io, {
      llm: fakeLlm(renameProductReply()),
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
      now: new Date('2026-05-12T14:00:00Z'),
    }), 0, write.err.join(''));
    const id = write.out.join('').match(/applied: (CHG-[A-Z0-9]+)/)?.[1];
    assert.ok(id);
    assert.match(await readFile(join(bookDir, 'product.md'), 'utf8'), /^# 新作品定位/);

    const rollbackIo = silentIo();
    const exit = await run(['console', '--rollback', id], bookDir, rollbackIo.io, {
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
      now: new Date('2026-05-12T14:00:05Z'),
    });

    assert.equal(exit, 0, rollbackIo.err.join(''));
    assert.match(rollbackIo.out.join(''), new RegExp(`rollback: CHG-[A-Z0-9]+\\nrollback_of: ${id}`));
    assert.match(await readFile(join(bookDir, 'product.md'), 'utf8'), /^# 作品定位/);
    const changes = await readdir(join(bookDir, 'changes'));
    assert.equal(changes.length, 2);
  });
});

test('console REPL supports drill and apply', async () => {
  await withBook(async (bookDir) => {
    const answers = ['把作品定位标题改掉', 'drill product.md', 'apply', 'exit'];
    const ask = async () => answers.shift() ?? 'exit';
    const io = silentIo();

    const exit = await run(['console'], bookDir, io.io, {
      llm: fakeLlm(renameProductReply()),
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
      ask,
      now: new Date('2026-05-12T14:00:00Z'),
    });

    assert.equal(exit, 0, io.err.join(''));
    const output = io.out.join('');
    assert.match(output, /Author Console/);
    assert.match(output, /Preview: product\.md/);
    assert.match(output, /# 新作品定位/);
    assert.match(output, /applied: CHG-/);
    assert.match(await readFile(join(bookDir, 'product.md'), 'utf8'), /^# 新作品定位/);
  });
});

test('console REPL supports abort and edit without applying by accident', async () => {
  await withBook(async (bookDir) => {
    const before = await readFile(join(bookDir, 'product.md'), 'utf8');
    const answers = ['把作品定位标题改掉', 'edit', 'abort', 'exit'];
    const ask = async () => answers.shift() ?? 'exit';
    const io = silentIo();

    const exit = await run(['console'], bookDir, io.io, {
      llm: fakeLlm(renameProductReply()),
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm', EDITOR: '' },
      ask,
    });

    assert.equal(exit, 0, io.err.join(''));
    const output = io.out.join('');
    assert.match(output, /edits file:/);
    assert.match(output, /aborted/);
    assert.equal(await readFile(join(bookDir, 'product.md'), 'utf8'), before);
  });
});
