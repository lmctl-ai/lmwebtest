import assert from 'node:assert/strict';
import {test} from 'node:test';
import {counts, STATUS, growthChecks} from './or-helper.mjs';

test('growth counts are read from table cells as exact integers', () => {
  assert.deepEqual(counts(['16', '1,048,576', ' 1,152,921,504,606,846,976 ']), [16n, 1048576n, 1152921504606846976n]);
  assert.deepEqual(counts(['1.27 × 10^30', 'run']), [null, null]);
});


test('runtime solver families have valid status labels; unknown families and statuses fail', () => {
  for (const family of ['CP-SAT', 'GLOP', 'SAT', 'PDLP', 'Flow', 'Routing']) {
    for (const status of ['OPTIMAL', 'FEASIBLE', 'INFEASIBLE', 'UNBOUNDED'])
      assert.ok(STATUS.test(`${family} ${status}: objective 9; 6 nodes, 8 arcs`));
  }
  for (const label of ['Other OPTIMAL', 'Flow UNKNOWN', 'Routing FAILED', 'NotFlow OPTIMAL', 'Flow OPTIMALITY'])
    assert.equal(STATUS.test(label), false, label);
});

const magic = {measured: counts(['72', '504', '3024', '15120', '60480', '181440', '362880', '362880']),
  sizes: [2, 3, 4, 5, 6, 7, 8, 9], formula: '9!/(9-n)!', far: 0};

test('the full finite magic-square domain may end with equal counts and no far row', () => {
  assert.deepEqual(growthChecks(magic), {grows: true, extent: true, finite: true, completeFinite: true});
  assert.equal(growthChecks({...magic, formula: ' 9! / ( 9 - n )! '}).completeFinite, true);
});

test('finite exemption requires exact counts, ordered domain positions and exhaustion', () => {
  assert.equal(growthChecks({...magic, sizes: [2, 3, 4, 5, 6, 7, 8, 8]}).extent, false);
  const incorrect = {...magic, measured: [...magic.measured.slice(0, -1), 400000n]};
  assert.equal(growthChecks(incorrect).extent, false);
  assert.equal(growthChecks({...incorrect, far: 1}).grows, false);
  const partial = {...magic, measured: magic.measured.slice(0, -1), sizes: magic.sizes.slice(0, -1)};
  assert.equal(growthChecks(partial).extent, false);
  assert.equal(growthChecks({...partial, far: 1}).extent, true);
  assert.equal(growthChecks({...magic, formula: 'n!'}).extent, false);
  assert.equal(growthChecks({...magic, formula: 'n!', far: 1}).grows, false);
});

test('growth still rejects decreases, flat/weak tables, missing counts and undersampling', () => {
  for (const measured of [[1n, 20n, 19n], [5n, 5n, 5n], [10n, 11n, 12n], [1n, null, 100n], [0n, 1n, 100n], [1n, 100n]])
    assert.equal(growthChecks({measured, sizes: [1, 2, 3], formula: '2^n', far: 1}).grows, false);
  assert.equal(growthChecks({measured: [2n, 4n, 64n], sizes: [1, 2, 6], formula: '2^n', far: 1}).grows, true);
});
