import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';

async function withTempRoot(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-style-cli-'));
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

function referenceText(): string {
  return [
    '雨从旧楼的檐角垂下来，像一串没说完的话。林岚把伞收在门外，先听见楼道深处的水声，然后才看见门缝里透出的灯。',
    '她没有立刻敲门。她习惯先把现场的呼吸数一遍：电梯停在三楼，窗台上有半枚烟灰，墙面新刷过，却盖不住潮气。',
    '“你迟到了。”门内的人说。',
    '“我在等你决定要不要撒谎。”林岚回答。她的语气很轻，像把刀背放在桌上，没有声响，却让人知道刀还在那里。',
    '房间里没有多余的家具。一张桌，一盏灯，一只杯口裂开的白瓷杯。她闻到冷茶、灰尘和某种廉价香水混在一起。',
    '每个段落都往前挪一点，不急着解释，也不急着审判。人物先观察，再开口；线索先落地，再变成判断。',
    '她想起父亲说过，真相通常不是门后最大的声音，而是所有人都假装没听见的那一下轻响。',
    '所以她坐下来，把录音笔推到桌子中央。灯光在金属外壳上短短一闪，像雨夜里被惊醒的眼睛。',
  ].join('\n\n');
}

async function writeReference(root: string): Promise<string> {
  const textFile = join(root, 'reference.txt');
  await writeFile(textFile, referenceText(), 'utf8');
  return textFile;
}

async function extractProfile(root: string): Promise<{ id: string; output: string }> {
  const textFile = await writeReference(root);
  const io = silentIo();
  const exit = await run([
    'style',
    'extract',
    '--name',
    '雨夜观察',
    '--text-file',
    textFile,
    '--root',
    root,
  ], root, io.io, { env: {} });

  assert.equal(exit, 0, io.err.join(''));
  const profileFiles = await readdir(join(root, '.authoros/styles/profiles'));
  assert.equal(profileFiles.length, 1);
  const profile = JSON.parse(await readFile(join(root, '.authoros/styles/profiles', profileFiles[0]), 'utf8'));
  return { id: profile.id, output: io.out.join('') };
}

test('style extract writes a profile and prints id and path', async () => {
  await withTempRoot(async (root) => {
    const { id, output } = await extractProfile(root);

    assert.match(id, /^.+-[a-f0-9]{8}$/);
    assert.match(output, /Style profile extracted/);
    assert.match(output, new RegExp(id));
    assert.match(output, /\.authoros\/styles\/profiles\/.+\.json/);
  });
});

test('style list prints saved profiles', async () => {
  await withTempRoot(async (root) => {
    const { id } = await extractProfile(root);
    const io = silentIo();

    assert.equal(await run(['style', 'list', '--root', root], root, io.io, { env: {} }), 0, io.err.join(''));
    const output = io.out.join('');
    assert.match(output, /Style profiles/);
    assert.match(output, /雨夜观察/);
    assert.match(output, new RegExp(id));
  });
});

test('style show prints structured profile details', async () => {
  await withTempRoot(async (root) => {
    const { id } = await extractProfile(root);
    const io = silentIo();

    assert.equal(await run(['style', 'show', id, '--root', root], root, io.io, { env: {} }), 0, io.err.join(''));
    const output = io.out.join('');
    assert.match(output, /Style profile/);
    assert.match(output, /ID:/);
    assert.match(output, /Name: 雨夜观察/);
    assert.match(output, /Rules:/);
  });
});

test('style bind binds the profile to the current private book', async () => {
  await withTempRoot(async (root) => {
    const { id } = await extractProfile(root);
    const projectDir = join(root, 'books/book-one');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(root, 'bookshelf.json'), JSON.stringify({
      version: 1,
      current: 'book-one',
      books: [{
        id: 'book-one',
        title: 'Book One',
        concept: 'private test book',
        path: 'books/book-one',
        created_at: '2026-05-18T00:00:00.000Z',
        last_active_at: '2026-05-18T00:00:00.000Z',
      }],
    }, null, 2), 'utf8');

    const io = silentIo();
    assert.equal(await run(['style', 'bind', id, '--root', root], root, io.io, { env: {} }), 0, io.err.join(''));

    const binding = JSON.parse(await readFile(join(projectDir, '.authoros/private/style-binding.json'), 'utf8'));
    assert.equal(binding.profileId, id);
    assert.match(io.out.join(''), /Style profile bound/);
    assert.match(io.out.join(''), /book-one/);
  });
});

test('help text mentions style commands', async () => {
  const top = silentIo();
  assert.equal(await run(['--help'], process.cwd(), top.io, { env: {} }), 0);
  assert.match(top.out.join(''), /author style extract\|list\|show\|bind/);

  const style = silentIo();
  assert.equal(await run(['style', '--help'], process.cwd(), style.io, { env: {} }), 0, style.err.join(''));
  const output = style.out.join('');
  assert.match(output, /author style extract --name <name> --text-file <file>/);
  assert.match(output, /author style list/);
  assert.match(output, /author style show <id>/);
  assert.match(output, /author style bind <id>/);
});
