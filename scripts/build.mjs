#!/usr/bin/env node
import { cpSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const tscBin = resolve(root, 'node_modules', 'typescript', 'bin', 'tsc');

if (existsSync(dist)) {
  rmSync(dist, { recursive: true, force: true });
}

const tsc = spawnSync(process.execPath, [tscBin, '-p', 'tsconfig.build.json'], {
  cwd: root,
  stdio: 'inherit',
});
if (tsc.status !== 0) {
  process.exit(tsc.status ?? 1);
}

cpSync(resolve(root, 'src', 'templates'), resolve(root, 'dist', 'templates'), {
  recursive: true,
});

console.log('Build complete: dist/ ready.');
