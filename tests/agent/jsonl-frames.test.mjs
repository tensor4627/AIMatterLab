import test from 'node:test';
import assert from 'node:assert/strict';
import {createJsonlFramer} from "../../agent/providers/jsonl-frames.mjs";

test('frames split across chunks are reassembled and multiple frames per chunk emit in order',()=>{
 const frames=[];const framer=createJsonlFramer({onFrame:value=>frames.push(value)});
 framer.feed(Buffer.from('{"a":1}\n{"b"'));
 framer.feed(Buffer.from(':2}\n{"c":3}\r\n'));
 assert.deepEqual(frames,['{"a":1}','{"b":2}','{"c":3}']);
 assert.equal(framer.bufferedBytes,0);
});

test('a partial line is buffered until its newline arrives',()=>{
 const frames=[];const framer=createJsonlFramer({onFrame:value=>frames.push(value)});
 framer.feed(Buffer.from('{"partial"'));
 assert.equal(frames.length,0);
 framer.feed(Buffer.from('}\n'));
 assert.deepEqual(frames,['{"partial"}']);
});

test('an unterminated oversized frame is rejected without retaining it',()=>{
 const frames=[],oversized=[];const framer=createJsonlFramer({onFrame:value=>frames.push(value),onOversize:bytes=>oversized.push(bytes),maxBytes:8});
 framer.feed(Buffer.from('x'.repeat(9)));
 assert.deepEqual(frames,[]);
 assert.deepEqual(oversized,[9]);
 assert.equal(framer.bufferedBytes,0);
 framer.feed(Buffer.from('ok\n'));
 assert.deepEqual(frames,['ok'],'framer must recover after an oversized frame');
});

test('a newline-terminated oversized frame is skipped and later frames still emit',()=>{
 const frames=[],oversized=[];const framer=createJsonlFramer({onFrame:value=>frames.push(value),onOversize:bytes=>oversized.push(bytes),maxBytes:8});
 framer.feed(Buffer.from('123456789\nok\n'));
 assert.deepEqual(oversized,[9]);
 assert.deepEqual(frames,['ok']);
});

test('empty lines are ignored and the bound must be a positive integer',()=>{
 const frames=[];const framer=createJsonlFramer({onFrame:value=>frames.push(value)});
 framer.feed(Buffer.from('\n\nok\n'));
 assert.deepEqual(frames,['ok']);
 assert.throws(()=>createJsonlFramer({onFrame:()=>{},maxBytes:0}),/bound/);
 assert.throws(()=>createJsonlFramer({}),/onFrame/);
});
