import test from 'node:test';import assert from 'node:assert/strict';import {axisLabelMatches as matches} from './physics-axis-label.mjs';
test('Robertson cancellation differs by an ulp between browser and Node',()=>{
 assert.ok(matches(['c (1): -2.220446049e-16 … 0.6266046936'],'c','1',-1.1102230246251565e-16,.6266046935650417));
});
test('axis labels keep quantities, units, finite values and meaningful bounds strict',()=>{
 for(const label of ['c (s): 0 … 0.6266046936','b (1): 0 … 0.6266046936','c (1): NaN … 0.6266046936','c (1): 0 … 0.6266048','c (1): 0.000001 … 0.6266046936'])assert.equal(matches([label],'c','1',0,.6266046935650417),false,label);
 assert.equal(matches(['x (m): 0 … 0'],'x','m',0,1e-20),false);
 assert.ok(matches(['x (m): 0 … 1e-20'],'x','m',0,1e-20));
});
