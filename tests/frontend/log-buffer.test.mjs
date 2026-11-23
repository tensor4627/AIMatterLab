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

test('a cross-chunk overflow trims only the excess and keeps later chunks intact',()=>{
 const previous=Object.freeze(['old','abcdefgh','middle']);
 const buffer=appendLogChunks(previous,'latest',14);
 assert.deepEqual(buffer,{chunks:['gh','middle','latest'],truncated:true});
 assert.deepEqual(previous,['old','abcdefgh','middle']);
 assert.equal(logText(buffer.chunks).length,14);
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

test('several small appends keep the full recent tail after a large batch',()=>{
 let input='stale prefix\n'+'a'.repeat(LOG_LIMIT-10)+'recent log';
 let buffer=appendLogChunks([],input);
 assert.equal(buffer.truncated,true);
 for(const addition of ['end of synthetic log\n','another update\n','last\n']){
  input+=addition;
  buffer=appendLogChunks(buffer.chunks,addition);
  assert.equal(buffer.truncated,true);
  assert.equal(logText(buffer.chunks),input.slice(-LOG_LIMIT));
 }
 const empty=appendLogChunks(buffer.chunks,'');
 assert.deepEqual(empty,{chunks:buffer.chunks,truncated:false});
 assert.notEqual(empty.chunks,buffer.chunks);
});

test('surrogate pairs survive intact around the cutoff and are never split by it',()=>{
 const text='x😀yz';
 for(const [limit,expected] of [[4,'😀yz'],[3,'yz'],[2,'yz']]){
  const buffer=appendLogChunks([],text,limit);
  assert.equal(logText(buffer.chunks),expected);
  assert.equal(buffer.truncated,true);
  assert(logText(buffer.chunks).length<=limit);
 }
 assert.deepEqual(appendLogChunks([],'😀',1),{chunks:[],truncated:true});
});

test('surrogate pairs that cross chunk boundaries are handled at the exact cutoff',()=>{
 const prior=['x\ud83d','','\ude00y'];
 assert.equal(logText(appendLogChunks(prior,'z',4).chunks),'😀yz');
 assert.deepEqual(appendLogChunks(prior,'z',3),{chunks:['y','z'],truncated:true});
 assert.deepEqual(appendLogChunks(['\ud83d',''], '\ude00',1),{chunks:[],truncated:true});
});
