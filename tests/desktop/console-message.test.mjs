import test from 'node:test';
import assert from 'node:assert/strict';
import {consoleMessage} from "../../desktop/platform/verification/console-message.mjs";

test('new Electron console-message details object is normalized',()=>{
 assert.deepEqual(consoleMessage([{}, {level:3,message:'renderer failed',lineNumber:1}]),{level:3,message:'renderer failed'});
 assert.deepEqual(consoleMessage([{}, {level:0,message:'ok'}]),{level:0,message:'ok'});
});

test('legacy level/message positional signature remains supported',()=>{
 assert.deepEqual(consoleMessage([{},3,'old failure']),{level:3,message:'old failure'});
 assert.deepEqual(consoleMessage([{},0]),{level:0,message:''});
});

test('malformed events never throw and fall back to zero level',()=>{
 assert.deepEqual(consoleMessage([]),{level:0,message:''});
 assert.deepEqual(consoleMessage([{},null,'text']),{level:0,message:'text'});
});
