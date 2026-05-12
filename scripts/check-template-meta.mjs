#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const FORBIDDEN_TONE_WORDS = [
  '能力', '代价', '异能', '异常', '灵根', '境界', '神迹', '种族',
  '线索', '嫌疑人', '反物质', '奇点', '金手指', '修罗场', '反派',
  '系统', '规则',
];

const key = process.argv[2];
if (!key) {
  console.error('usage: check-template-meta.mjs <key>');
  process.exit(2);
}

const metaPath = resolve('src/seed-templates', key, 'meta.yaml');
const meta = parseSimpleMeta(await readFile(metaPath, 'utf8'));
const errors = [];

if (meta.key !== key) errors.push(`meta.key (${meta.key}) != dir name (${key})`);
if (!/^[a-z][a-z0-9_]{1,40}$/.test(meta.key ?? '')) errors.push(`key format invalid: ${meta.key}`);
if (!meta.name) errors.push('missing name');
if (!Array.isArray(meta.tone_keywords) || meta.tone_keywords.length === 0) errors.push('missing tone_keywords');
if (!meta.one_line_pitch) errors.push('missing one_line_pitch');
if (!meta.applicable_when) errors.push('missing applicable_when');
if (!meta.not_applicable_when) errors.push('missing not_applicable_when');
if (!meta.diff_from || Object.keys(meta.diff_from).length === 0) errors.push('missing diff_from');

for (const word of FORBIDDEN_TONE_WORDS) {
  if ((meta.tone_keywords ?? []).some((tone) => String(tone).includes(word))) {
    errors.push(`tone_keywords contains forbidden setting word: ${word}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`ok: ${key}`);

function parseSimpleMeta(raw) {
  const root = {};
  let currentObjectKey = null;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const nested = line.match(/^  ([^:]+):\s*(.*)$/);
    if (nested && currentObjectKey) {
      root[currentObjectKey][nested[1].trim()] = stripScalar(nested[2].trim());
      continue;
    }

    const top = line.match(/^([^:]+):\s*(.*)$/);
    if (!top) continue;

    const k = top[1].trim();
    const v = top[2].trim();
    if (!v) {
      root[k] = {};
      currentObjectKey = k;
      continue;
    }

    currentObjectKey = null;
    root[k] = v.startsWith('[') ? parseInlineArray(v) : stripScalar(v);
  }

  return root;
}

function parseInlineArray(value) {
  const match = value.match(/^\[(.*)\]$/);
  if (!match) return [];
  return match[1].split(',').map((item) => stripScalar(item.trim())).filter(Boolean);
}

function stripScalar(value) {
  return value.replace(/^['"]|['"]$/g, '');
}
