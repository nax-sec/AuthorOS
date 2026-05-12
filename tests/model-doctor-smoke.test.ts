import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';
import type { GenerateOptions, LlmClient } from '../src/core/llm.ts';

async function withInitedProject(body: (cwd: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v2-doctor-test-'));
  try {
    const io = silentIo();
    const exit = await run(['init', 'demo', '--quick'], root, io.io, { env: {} });
    assert.equal(exit, 0, io.err.join(''));
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

function fakeLlm(reply: string): LlmClient {
  return {
    async generate() {
      return reply;
    },
  };
}

test('doctor reports blockers when nothing is configured', async () => {
  await withInitedProject(async (cwd) => {
    const io = silentIo();
    const exit = await run(['model', 'doctor'], cwd, io.io, { env: {} });
    assert.equal(exit, 0);
    const output = io.out.join('');
    assert.match(output, /ready: no/);
    assert.match(output, /API key env OPENAI_API_KEY is not set/);
    assert.match(output, /model is not set/);
    assert.match(output, /smoke: author model smoke   # pings chief-writer/);
  });
});

test('doctor reports ready when api key and model are present', async () => {
  await withInitedProject(async (cwd) => {
    const io = silentIo();
    const exit = await run(['model', 'doctor'], cwd, io.io, {
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'gpt-test' },
    });
    assert.equal(exit, 0);
    const output = io.out.join('');
    assert.match(output, /ready: yes/);
    assert.match(output, /api key env: OPENAI_API_KEY \(set\)/);
    assert.match(output, /model: gpt-test/);
    assert.doesNotMatch(output, /blockers:/);
  });
});

test('smoke pings chief-writer with the agent profile injected and renders the reply', async () => {
  await withInitedProject(async (cwd) => {
    let captured = '';
    let capturedOptions: GenerateOptions | undefined;
    const llm: LlmClient = {
      async generate(prompt, options) {
        captured = prompt;
        capturedOptions = options;
        return '收到,我是 chief-writer,负责章节方向。';
      },
    };

    const io = silentIo();
    const exit = await run(['model', 'smoke'], cwd, io.io, {
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'gpt-test' },
      llm,
    });
    assert.equal(exit, 0, io.err.join(''));

    assert.match(captured, /AGENT_PING chief-writer/);
    assert.match(captured, /# chief-writer/);
    assert.match(captured, /Required Context/);
    assert.match(captured, /已理解我的 AuthorOS 角色。/);
    assert.equal(capturedOptions?.maxTokens, 800);

    const output = io.out.join('');
    assert.match(output, /agent: chief-writer/);
    assert.match(output, /model: gpt-test/);
    assert.match(output, /我是 chief-writer/);
  });
});

test('smoke surfaces network errors as AuthorOS errors', async () => {
  await withInitedProject(async (cwd) => {
    const llm: LlmClient = {
      async generate() {
        throw new Error('connection refused');
      },
    };

    const io = silentIo();
    const exit = await run(['model', 'smoke'], cwd, io.io, {
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'gpt-test' },
      llm,
    });
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /Model smoke failed.*connection refused/);
  });
});
