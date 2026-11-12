import assert from 'node:assert/strict';
import {test} from 'node:test';
import {counts} from './or-helper.mjs';

test('growth counts are read from table cells as exact integers', () => {
  assert.deepEqual(counts(['16', '1,048,576', ' 1,152,921,504,606,846,976 ']), [16n, 1048576n, 1152921504606846976n]);
  assert.deepEqual(counts(['1.27 × 10^30', 'run']), [null, null]);
});
