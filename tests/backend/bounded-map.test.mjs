import test from 'node:test';
import assert from 'node:assert/strict';
import {remember} from "../../backend/main/workspace/bounded-map.mjs";

test('remember keeps the most recent entries and evicts the oldest',()=>{
 const map=new Map();
 for(const [key,value] of [['a',1],['b',2],['c',3]])remember(map,key,value,{max:2});
 assert.deepEqual([...map.keys()],['b','c']);
 assert.equal(map.get('b'),2);
});

test('re-inserting an existing key refreshes its position',()=>{
 const map=new Map();
 remember(map,'a',1,{max:2});remember(map,'b',2,{max:2});remember(map,'a',3,{max:2});
 assert.deepEqual([...map.keys()],['b','a']);
 assert.equal(map.get('a'),3);
});

test('invalid maps and bounds are rejected',()=>{
 assert.throws(()=>remember({},'a',1),/Map/);
 assert.throws(()=>remember(new Map(),'a',1,{max:0}),/size/);
 assert.throws(()=>remember(new Map(),'a',1,{max:1.5}),/size/);
});
