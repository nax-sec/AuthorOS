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
    '[edits]  ',
    '- file: product.md',
    '  op: replace-text',
    '  find: Old',
    '  replace: New',
    '',
    '[next]',
    '  author brief',
    '',
  ].join('\r\n'));

  assert.equal(parsed.scope, 'book');
  assert.match(parsed.impact, /product\.md/);
  assert.match(parsed.edits, /replace-text/);
  assert.match(parsed.next, /author brief/);
});

test('parseConsoleOutput accepts inline scope', () => {
  const parsed = parseConsoleOutput([
    '[scope] author',
    '[impact]',
    '  low: author.md - update preference',
    '[edits]',
    '- file: author.md',
    '  op: replace-text',
    '  find: old',
    '  replace: new',
    '[next]',
    '  author author show',
  ].join('\n'));

  assert.equal(parsed.scope, 'author');
});

test('parseConsoleOutput rejects missing blocks with a precise error', () => {
  assert.throws(
    () => parseConsoleOutput('[scope] book\n[impact]\nok\n[next]\nnoop'),
    /missing \[edits\] block/,
  );
});

test('parseConsoleOutput rejects duplicate blocks', () => {
  assert.throws(
    () => parseConsoleOutput('[scope] book\n[impact]\na\n[edits]\nd\n[next]\nn\n[edits]\nd2'),
    /duplicate \[edits\] block/,
  );
});

test('parseConsoleOutput rejects blocks in the wrong order', () => {
  assert.throws(
    () => parseConsoleOutput('[scope] book\n[edits]\nd\n[impact]\na\n[next]\nn'),
    /expected \[impact\] before \[edits\]/,
  );
});
