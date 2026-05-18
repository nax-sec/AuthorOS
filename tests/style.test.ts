import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bindStyleProfile,
  createStyleProfileFromText,
  listStyleProfiles,
  loadStyleProfile,
  readBookStyleProfile,
  readStyleBinding,
  saveStyleProfile,
} from '../src/commands/style.ts';
import { AuthorOsError } from '../src/core/schema.ts';

const referenceText = [
  'The room held its breath while Mara counted the seconds between the rain and the thunder. She noticed the lemon oil on the table, the stale coffee, and the little blue bruise of evening at the window. "You always arrive after the damage," she said, but her voice stayed level.',
  'Jonah did not answer at once. He set down his hat, read the letter twice, and smiled as if the paper had made a private joke. Outside, the streetlights blinked awake one by one; inside, every silence seemed to move a chair closer.',
  'By morning the town would call it an accident. Mara knew better. Accidents did not hide receipts under floorboards, and they did not leave wet footprints facing the wrong door.',
].join('\n\n');

async function withTempRoot(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-style-'));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('createStyleProfileFromText creates a versioned deterministic profile from reference prose', async () => {
  await withTempRoot(async (root) => {
    const first = createStyleProfileFromText(root, {
      name: 'Mara Noir',
      text: referenceText,
      sourceNote: 'three reference paragraphs',
      now: new Date('2026-05-18T00:00:00Z'),
    });
    const second = createStyleProfileFromText(root, {
      name: 'Mara Noir',
      text: referenceText,
      sourceNote: 'three reference paragraphs',
      now: new Date('2026-05-19T00:00:00Z'),
    });

    assert.equal(first.version, 1);
    assert.match(first.id, /^mara-noir-[a-f0-9]{8}$/);
    assert.equal(first.id, second.id);
    assert.equal(first.name, 'Mara Noir');
    assert.equal(first.createdAt, '2026-05-18T00:00:00.000Z');
    assert.equal(first.sourceNote, 'three reference paragraphs');
    assert.match(first.sourceHash, /^[a-f0-9]{64}$/);
    assert.match(first.description, /paragraph/);
    assert.ok(first.rules.sentenceRhythm.length > 0);
    assert.ok(first.rules.paragraphDensity.length > 0);
    assert.ok(first.rules.dialogue.length > 0);
    assert.ok(first.rules.narrativeDistance.length > 0);
    assert.ok(first.rules.sensoryDetail.length > 0);
    assert.ok(first.rules.imagery.length > 0);
    assert.ok(first.rules.pacing.length > 0);
    assert.ok(first.rules.avoid.length > 0);
    assert.ok(first.rules.antiAiVoice.length > 0);
  });
});

test('createStyleProfileFromText rejects blank or short reference text', async () => {
  await withTempRoot(async (root) => {
    assert.throws(
      () => createStyleProfileFromText(root, { name: 'Empty', text: '   ' }),
      AuthorOsError,
    );
    assert.throws(
      () => createStyleProfileFromText(root, { name: 'Short', text: 'Only one small sentence.' }),
      AuthorOsError,
    );
  });
});

test('createStyleProfileFromText extracts useful rhythm and sensory rules from Chinese prose', async () => {
  await withTempRoot(async (root) => {
    const chineseReference = [
      '雨从旧楼的檐角垂下来，像一串没说完的话。林岚把伞收在门外，先听见楼道深处的水声，然后才看见门缝里透出的灯。',
      '她没有立刻敲门。她习惯先把现场的呼吸数一遍：电梯停在三楼，窗台上有半枚烟灰，墙面新刷过，却盖不住潮气。',
      '“你迟到了。”门内的人说。',
      '“我在等你决定要不要撒谎。”林岚回答。她的语气很轻，像把刀背放在桌上，没有声响，却让人知道刀还在那里。',
      '房间里没有多余的家具。一张桌，一盏灯，一只杯口裂开的白瓷杯。她闻到冷茶、灰尘和某种廉价香水混在一起。',
    ].join('\n\n');

    const profile = createStyleProfileFromText(root, {
      name: '雨夜观察',
      text: chineseReference,
      now: new Date('2026-05-18T00:00:00Z'),
    });

    assert.match(profile.description, /12 sentences/);
    assert.match(profile.rules.sensoryDetail[0], /concrete sensory details/);
    assert.match(profile.rules.narrativeDistance[0], /personal judgment|close third-person/);
  });
});

test('saveStyleProfile writes profiles under the private root', async () => {
  await withTempRoot(async (root) => {
    const profile = createStyleProfileFromText(root, { name: 'Mara Noir', text: referenceText });

    const saved = await saveStyleProfile(root, profile);

    assert.equal(saved, join(root, '.authoros/styles/profiles', `${profile.id}.json`));
    const stored = JSON.parse(await readFile(saved, 'utf8'));
    assert.equal(stored.id, profile.id);
    assert.equal(stored.version, 1);
  });
});

test('listStyleProfiles returns summaries sorted newest first', async () => {
  await withTempRoot(async (root) => {
    const older = createStyleProfileFromText(root, {
      name: 'Older Style',
      text: referenceText,
      now: new Date('2026-05-17T00:00:00Z'),
    });
    const newer = createStyleProfileFromText(root, {
      name: 'Newer Style',
      text: `${referenceText}\n\nThe final image lingered like dust in a projector beam.`,
      now: new Date('2026-05-18T00:00:00Z'),
    });
    await saveStyleProfile(root, older);
    await saveStyleProfile(root, newer);

    const profiles = await listStyleProfiles(root);

    assert.deepEqual(profiles.map((profile) => profile.id), [newer.id, older.id]);
    assert.equal(profiles[0].name, 'Newer Style');
    assert.equal(profiles[0].createdAt, '2026-05-18T00:00:00.000Z');
    assert.equal(profiles[0].sourceHash, newer.sourceHash);
  });
});

test('loadStyleProfile validates JSON and profile schema', async () => {
  await withTempRoot(async (root) => {
    const profile = createStyleProfileFromText(root, { name: 'Mara Noir', text: referenceText });
    await saveStyleProfile(root, profile);
    assert.equal((await loadStyleProfile(root, profile.id)).id, profile.id);

    await writeFile(join(root, '.authoros/styles/profiles/bad-json.json'), '{ nope', 'utf8');
    await assert.rejects(() => loadStyleProfile(root, 'bad-json'), AuthorOsError);

    await writeFile(join(root, '.authoros/styles/profiles/bad-schema.json'), '{"version":1,"id":"bad-schema"}', 'utf8');
    await assert.rejects(() => loadStyleProfile(root, 'bad-schema'), AuthorOsError);
  });
});

test('bindStyleProfile writes a book-local binding after verifying the profile exists', async () => {
  await withTempRoot(async (root) => {
    const projectDir = join(root, 'books/mara');
    const profile = createStyleProfileFromText(root, { name: 'Mara Noir', text: referenceText });
    await saveStyleProfile(root, profile);

    const binding = await bindStyleProfile(root, projectDir, profile.id, new Date('2026-05-18T01:00:00Z'));

    assert.deepEqual(binding, {
      version: 1,
      profileId: profile.id,
      boundAt: '2026-05-18T01:00:00.000Z',
    });
    const stored = JSON.parse(await readFile(join(projectDir, '.authoros/private/style-binding.json'), 'utf8'));
    assert.equal(stored.profileId, profile.id);
  });
});

test('bindStyleProfile stores a validated book-local profile snapshot', async () => {
  await withTempRoot(async (root) => {
    const projectDir = join(root, 'books/mara');
    const profile = createStyleProfileFromText(root, { name: 'Mara Noir', text: referenceText });
    await saveStyleProfile(root, profile);

    await bindStyleProfile(root, projectDir, profile.id, new Date('2026-05-18T01:00:00Z'));

    const stored = JSON.parse(await readFile(join(projectDir, '.authoros/private/style-binding.json'), 'utf8'));
    assert.equal(stored.profile.id, profile.id);
    assert.equal(stored.profile.name, 'Mara Noir');
    assert.deepEqual(stored.profile.rules.antiAiVoice, profile.rules.antiAiVoice);
  });
});

test('bindStyleProfile rejects missing profiles', async () => {
  await withTempRoot(async (root) => {
    await assert.rejects(
      () => bindStyleProfile(root, join(root, 'books/mara'), 'missing-profile'),
      AuthorOsError,
    );
  });
});

test('readStyleBinding returns null when no binding exists', async () => {
  await withTempRoot(async (root) => {
    assert.equal(await readStyleBinding(root, join(root, 'books/mara')), null);
  });
});

test('readBookStyleProfile returns null when no embedded snapshot exists', async () => {
  await withTempRoot(async (root) => {
    const projectDir = join(root, 'books/mara');
    assert.equal(await readBookStyleProfile(projectDir), null);

    await mkdir(join(projectDir, '.authoros/private'), { recursive: true });
    await writeFile(
      join(projectDir, '.authoros/private/style-binding.json'),
      JSON.stringify({ version: 1, profileId: 'mara-noir', boundAt: '2026-05-18T01:00:00.000Z' }),
      'utf8',
    );

    assert.equal(await readBookStyleProfile(projectDir), null);
  });
});

test('readBookStyleProfile returns the embedded style profile snapshot', async () => {
  await withTempRoot(async (root) => {
    const projectDir = join(root, 'books/mara');
    const profile = createStyleProfileFromText(root, { name: 'Mara Noir', text: referenceText });
    await saveStyleProfile(root, profile);
    await bindStyleProfile(root, projectDir, profile.id);

    const result = await readBookStyleProfile(projectDir);

    assert.equal(result?.id, profile.id);
    assert.equal(result?.name, 'Mara Noir');
    assert.deepEqual(result?.rules.antiAiVoice, profile.rules.antiAiVoice);
  });
});

test('readStyleBinding returns the binding and loaded profile', async () => {
  await withTempRoot(async (root) => {
    const projectDir = join(root, 'books/mara');
    const profile = createStyleProfileFromText(root, { name: 'Mara Noir', text: referenceText });
    await saveStyleProfile(root, profile);
    const binding = await bindStyleProfile(root, projectDir, profile.id, new Date('2026-05-18T01:00:00Z'));

    const result = await readStyleBinding(root, projectDir);

    assert.equal(result?.binding.profileId, binding.profileId);
    assert.equal(result?.profile.id, profile.id);
  });
});

test('readStyleBinding reports missing profile references clearly', async () => {
  await withTempRoot(async (root) => {
    const projectDir = join(root, 'books/mara');
    await mkdir(join(projectDir, '.authoros/private'), { recursive: true });
    await writeFile(
      join(projectDir, '.authoros/private/style-binding.json'),
      JSON.stringify({ version: 1, profileId: 'missing-profile', boundAt: '2026-05-18T01:00:00.000Z' }),
      'utf8',
    );

    await assert.rejects(
      () => readStyleBinding(root, projectDir),
      /Style binding points to a missing profile: missing-profile/,
    );
  });
});
