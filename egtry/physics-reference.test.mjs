import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newBookReference} from './physics-reference.mjs';
const inventory={schema:'egtry-physics-track-inventory/1',books:[{slug:'mechanics'}],new_books:[{slug:'new-models',title:'Models',chapters:[{pages:[{slug:'one'},{slug:'two'}]}]}]};
test('only explicitly new inventory books replace a nonexistent legacy index',()=>{
 assert.deepEqual(newBookReference(inventory,'new-models').paths,['/new-models/one/','/new-models/two/']);
 assert.equal(newBookReference(inventory,'mechanics'),null);
 assert.equal(newBookReference(inventory,'unknown'),null);
 assert.equal(newBookReference({...inventory,new_books:[...inventory.new_books,{slug:'mechanics',chapters:[{pages:[{slug:'fake'}]}]}]},'mechanics'),null);
 assert.throws(()=>newBookReference({schema:'other'},'new-models'),/schema/);
 assert.throws(()=>newBookReference({...inventory,new_books:[{slug:'new-models',chapters:[{pages:[{slug:'../unsafe'}]}]}]},'new-models'),/slugs/);
});
