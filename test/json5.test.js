import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJson5 } from '../src/json5.js';

test('parses Terra Invicta-flavoured JSON5 safely', () => {
  const result = parseJson5(`
    // save header
    {
      unquoted: 'value',
      trailing: [1, 2, 3,],
      hex: 0x10,
      leadingDot: .5,
      infinity: Infinity,
      negativeInfinity: -Infinity,
      notANumber: NaN,
      /* block comment */ nested: { ok: true, },
    }
  `);

  assert.equal(result.unquoted, 'value');
  assert.deepEqual(result.trailing, [1, 2, 3]);
  assert.equal(result.hex, 16);
  assert.equal(result.leadingDot, 0.5);
  assert.equal(result.infinity, Infinity);
  assert.equal(result.negativeInfinity, -Infinity);
  assert.ok(Number.isNaN(result.notANumber));
  assert.deepEqual(result.nested, { ok: true });
});

test('rejects executable JavaScript syntax', () => {
  assert.throws(() => parseJson5('{ value: (() => 42)() }'), SyntaxError);
});
