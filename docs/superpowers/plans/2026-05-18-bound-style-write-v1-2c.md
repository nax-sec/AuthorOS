# Bound Style Writing V1.2c Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make normal chapter drafting read the book's bound style profile at generation time, so "continue writing" uses the active prose style before any post-draft rewrite.

**Architecture:** Store a validated style profile snapshot inside each book's `.authoros/private/style-binding.json` when a profile is bound. Add a project-local reader that can load this snapshot without the private root, then pass it into `write.ts` prompt assembly as an optional `bound_style_profile` block.

**Tech Stack:** TypeScript, Node.js test runner, AuthorOS CLI command modules, file-backed JSON state.

---

### Task 1: Persist A Book-Local Style Snapshot

**Files:**
- Modify: `src/commands/style.ts`
- Test: `tests/style.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that prove `bindStyleProfile()` writes the embedded profile and that `readBookStyleProfile(projectDir)` can read it without the private root:

```ts
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

test('readBookStyleProfile returns the embedded style profile snapshot', async () => {
  await withTempRoot(async (root) => {
    const projectDir = join(root, 'books/mara');
    const profile = createStyleProfileFromText(root, { name: 'Mara Noir', text: referenceText });
    await saveStyleProfile(root, profile);
    await bindStyleProfile(root, projectDir, profile.id);

    const result = await readBookStyleProfile(projectDir);

    assert.equal(result?.id, profile.id);
    assert.equal(result?.name, 'Mara Noir');
  });
});
```

- [ ] **Step 2: Run the tests to verify red**

Run:

```bash
node --test tests/style.test.ts
```

Expected: fail because `readBookStyleProfile` is not exported and/or `stored.profile` is missing.

- [ ] **Step 3: Implement the snapshot**

In `src/commands/style.ts`:

```ts
export interface BookStyleBindingSnapshot extends StyleBinding {
  profile?: StyleProfile;
}
```

Write `{ ...binding, profile }` in `bindStyleProfile()`, and add:

```ts
export async function readBookStyleProfile(projectDir: string): Promise<StyleProfile | null> {
  const path = styleBindingPath(projectDir);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (isMissingFileError(error)) return null;
    if (error instanceof SyntaxError) throw new AuthorOsError(`Invalid JSON in style binding: ${path}`);
    throw error;
  }

  if (!isRecord(parsed) || parsed.profile === undefined) return null;
  return parseStyleProfile(parsed.profile, `style binding profile snapshot: ${path}`);
}
```

- [ ] **Step 4: Run the tests to verify green**

Run:

```bash
node --test tests/style.test.ts
```

Expected: all tests in `tests/style.test.ts` pass.

### Task 2: Inject Bound Style Into Chapter Draft Prompts

**Files:**
- Modify: `src/commands/write.ts`
- Test: `tests/write.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a test that creates `.authoros/private/style-binding.json` with an embedded profile and asserts the model prompt includes `bound_style_profile`, an anti-AI rule, and a no-copy guard. Also assert the CLI output lists `.authoros/private/style-binding.json` as an input.

```ts
test('write injects bound style profile snapshot into model prompt', async () => {
  await withProjectWithPlan(async (cwd) => {
    const profile = makeStyleProfileFixture();
    await mkdir(join(cwd, '.authoros/private'), { recursive: true });
    await writeFile(join(cwd, '.authoros/private/style-binding.json'), `${JSON.stringify({
      version: 1,
      profileId: profile.id,
      boundAt: '2026-05-18T01:00:00.000Z',
      profile,
    }, null, 2)}\n`, 'utf8');

    let captured = '';
    const llm = fakeLlm('正文。', (p) => { captured = p; });
    const io = silentIo();
    assert.equal(
      await run(['write', '--chapter', '1', '--model'], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
      io.err.join(''),
    );

    assert.match(captured, /bound_style_profile:/);
    assert.match(captured, /name: Test Style/);
    assert.match(captured, /human cadence/);
    assert.match(captured, /Do not copy sentences/);
    assert.match(io.out.join(''), /\.authoros\/private\/style-binding\.json/);
  });
});
```

- [ ] **Step 2: Run the test to verify red**

Run:

```bash
node --test tests/write.test.ts
```

Expected: fail because `write.ts` does not load or render `bound_style_profile`.

- [ ] **Step 3: Implement prompt injection**

In `src/commands/write.ts`:

```ts
import { readBookStyleProfile, type StyleProfile } from './style.ts';
```

Load the bound style before generation:

```ts
const boundStyle = await readBookStyleProfile(projectDir);
```

Pass it to `generateDraftWithModel()`, render a compact style block, and append `.authoros/private/style-binding.json` to `contextInputs` when present.

- [ ] **Step 4: Run the focused tests**

Run:

```bash
node --test tests/style.test.ts tests/write.test.ts
```

Expected: both test files pass.

### Task 3: Verify And Commit

**Files:**
- Modify: `docs/superpowers/plans/2026-05-18-bound-style-write-v1-2c.md`
- Modify: `src/commands/style.ts`
- Modify: `src/commands/write.ts`
- Modify: `tests/style.test.ts`
- Modify: `tests/write.test.ts`

- [ ] **Step 1: Run full verification**

Run:

```bash
node --test tests/*.test.ts
node scripts/build.mjs
```

Expected: all tests pass and build completes.

- [ ] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-05-18-bound-style-write-v1-2c.md src/commands/style.ts src/commands/write.ts tests/style.test.ts tests/write.test.ts
git commit -m "feat: inject bound style into drafts"
```
