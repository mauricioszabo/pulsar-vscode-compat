'use strict';

const assert = require('assert');
const conversions = require('../lib/utils/position-range');
const { Position } = require('../lib/types/position');
const { Range } = require('../lib/types/range');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

test('converts Pulsar points to VSCode Positions', () => {
  const fromObject = conversions.atomPointToPosition({ row: 2, column: 5 });
  assert(fromObject instanceof Position);
  assert.strictEqual(fromObject.line, 2);
  assert.strictEqual(fromObject.character, 5);

  const fromArray = conversions.atomPointToPosition([3, 7]);
  assert(fromArray instanceof Position);
  assert.strictEqual(fromArray.line, 3);
  assert.strictEqual(fromArray.character, 7);
});

test('converts VSCode Positions to Pulsar point arrays and objects', () => {
  const position = new Position(4, 9);
  assert.deepStrictEqual(conversions.positionToAtomPoint(position), [4, 9]);
  assert.deepStrictEqual(conversions.positionToAtomPointObject(position), { row: 4, column: 9 });
});

test('converts Pulsar ranges to VSCode Ranges', () => {
  const fromArray = conversions.atomRangeToRange([[1, 2], [3, 4]]);
  assert(fromArray instanceof Range);
  assert.strictEqual(fromArray.start.line, 1);
  assert.strictEqual(fromArray.start.character, 2);
  assert.strictEqual(fromArray.end.line, 3);
  assert.strictEqual(fromArray.end.character, 4);

  const fromObject = conversions.atomRangeToRange({ start: { row: 5, column: 6 }, end: { row: 7, column: 8 } });
  assert(fromObject instanceof Range);
  assert.strictEqual(fromObject.start.line, 5);
  assert.strictEqual(fromObject.start.character, 6);
  assert.strictEqual(fromObject.end.line, 7);
  assert.strictEqual(fromObject.end.character, 8);
});

test('converts VSCode Ranges to Pulsar range arrays and service range objects', () => {
  const range = new Range(new Position(1, 2), new Position(3, 4));
  assert.deepStrictEqual(conversions.rangeToAtomRange(range), [[1, 2], [3, 4]]);

  const objectRange = conversions.rangeToAtomRangeObject(range);
  assert.deepStrictEqual(objectRange.start, { row: 1, column: 2 });
  assert.deepStrictEqual(objectRange.end, { row: 3, column: 4 });
  assert.strictEqual(objectRange.containsPoint({ row: 2, column: 0 }), true);
  assert.strictEqual(objectRange.containsPoint([4, 0]), false);
  assert.strictEqual(objectRange.intersectsWith({ start: { row: 3, column: 0 }, end: { row: 5, column: 0 } }), true);
});
