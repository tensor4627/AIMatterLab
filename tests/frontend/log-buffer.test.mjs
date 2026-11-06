import test from 'node:test';
import assert from 'node:assert/strict';
import {appendLogChunks,logText,LOG_LIMIT} from "../../frontend/features/runs/log-buffer.mjs";

test('log chunks keep their order and join to the accumulated output',()=>{
 let buffer={chunks:[],truncated:false};
 for(const text of ['first\n','second\n','third\n'])buffer=appendLogChunks(buffer.chunks,text,1024);
 assert.deepEqual(buffer.chunks,['first\n','second\n','third\n']);
 assert.equal(logText(buffer.chunks),'first\nsecond\nthird\n');
 assert.equal(buffer.truncated,false);
});

test('oldest whole chunks are dropped once the limit is exceeded',()=>{
 let buffer={chunks:[],truncated:false};
 buffer=appendLogChunks(buffer.chunks,'a'.repeat(8),10);
 buffer=appendLogChunks(buffer.chunks,'b'.repeat(8),10);
 assert.deepEqual(buffer.chunks,['b'.repeat(8)]);
 assert.equal(buffer.truncated,true);
 assert.equal(logText(buffer.chunks).length<=10,true);
});

test('a single oversized chunk is trimmed from the front and reported',()=>{
 const buffer=appendLogChunks([],'x'.repeat(30),10);
 assert.deepEqual(buffer.chunks,['x'.repeat(10)]);
 assert.equal(buffer.truncated,true);
 assert.throws(()=>appendLogChunks([],'text',0),/Invalid log limit/);
});

test('default limit stays at one MiB',()=>{
 assert.equal(LOG_LIMIT,1024*1024);
});
