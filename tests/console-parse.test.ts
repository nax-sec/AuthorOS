import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConsoleOutput } from '../src/commands/console.ts';

test('parseConsoleOutput accepts the four block protocol with whitespace and CRLF', () => {
  const parsed = parseConsoleOutput([
    '  [scope]',
    '  book',
    '',
    '[impact]\r',
    '  medium: product.md - rename positioning\r',
    '',
    '[diff]  ',
    '--- product.md',
    '@@ -1,1 +1,1 @@',
    '-# Old',
    '+# New',
    '',
    '[next]',
    '  author brief',
    '',
  ].join('\r\n'));

  assert.equal(parsed.scope, 'book');
  assert.match(parsed.impact, /product\.md/);
  assert.match(parsed.diff, /@@ -1,1 \+1,1 @@/);
  assert.match(parsed.next, /author brief/);
});

test('parseConsoleOutput accepts inline scope', () => {
  const parsed = parseConsoleOutput([
    '[scope] author',
    '[impact]',
    '  low: author.md - update preference',
    '[diff]',
    '--- author.md',
    '@@ -1,1 +1,1 @@',
    '-old',
    '+new',
    '[next]',
    '  author author show',
  ].join('\n'));

  assert.equal(parsed.scope, 'author');
});

test('parseConsoleOutput rejects missing blocks with a precise error', () => {
  assert.throws(
    () => parseConsoleOutput('[scope] book\n[impact]\nok\n[next]\nnoop'),
    /missing \[diff\] block/,
  );
});

test('parseConsoleOutput rejects duplicate blocks', () => {
  assert.throws(
    () => parseConsoleOutput('[scope] book\n[impact]\na\n[diff]\nd\n[next]\nn\n[diff]\nd2'),
    /duplicate \[diff\] block/,
  );
});

test('parseConsoleOutput rejects blocks in the wrong order', () => {
  assert.throws(
    () => parseConsoleOutput('[scope] book\n[diff]\nd\n[impact]\na\n[next]\nn'),
    /expected \[impact\] before \[diff\]/,
  );
});
