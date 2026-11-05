import test from 'node:test';import assert from 'node:assert/strict';import {pixelFontSize} from "../../frontend/ui/ui-font.mjs";

for(const [b,m,s,v]of [[12,18,1,18],[12,18,24/13,288/13],[13,18,1,18],[24,18,1,24],[12,11,12/13,144/13]])test('final pixel font '+[b,m,s],()=>assert.equal(pixelFontSize(b,m,s),v));
test('nonfinite settings never create NaN',()=>assert.equal(pixelFontSize(NaN,Infinity,-1),13));
