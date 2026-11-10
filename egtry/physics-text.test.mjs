import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateWorkedText} from './physics-checks.mjs';
test('worked substitutions expose physical numbers rather than minified program fields',()=>{
 for(const equation of ['e.force × e.cosine','p.mass * p.acceleration','Math.sqrt(4)','p=>p.x','${p.mass}','NaN m','[object Object]'])assert.throws(()=>validateWorkedText([{equation,explanation:'Substitute the numerical SI inputs.'}]),/leaks|numbers/);
 assert.throws(()=>validateWorkedText([{equation:'F × cos θ',explanation:'Substitute the numerical SI inputs.'}]),/numbers/);
 assert.doesNotThrow(()=>validateWorkedText([{equation:'Fx = (5 N) × 0.8 = 4 N',explanation:'Substitute the numerical SI inputs.'},{equation:'v₀ → v₁; Δx = 0.5 a t²',explanation:'Apply the motion law.'}]));
});
