#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(here, '..', 'dist', 'cli.js');
const srcEntry = resolve(here, '..', 'src', 'cli.ts');

const entry = existsSync(distEntry) ? distEntry : srcEntry;
const { run } = await import(pathToFileURL(entry).href);

process.exitCode = await run();
