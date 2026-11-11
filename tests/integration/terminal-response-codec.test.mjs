import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {decodeGzipResponse} from '../../desktop/platform/terminal-service/response-codec.mjs';
test('bounded response gzip decodes exact content and rejects CRC, length, truncation, bombs and trailing members',async()=>{
 const raw=Buffer.from(JSON.stringify({safe:'a'.repeat(50000)})),packed=gzipSync(raw);
 assert.deepEqual(await decodeGzipResponse(packed,raw.length),raw);
 const bad=Buffer.from(packed);bad[bad.length-8]^=1;
 for(const [bytes,size] of [[bad,raw.length],[packed,raw.length-1],[packed.subarray(0,-1),raw.length],[Buffer.concat([packed,gzipSync(Buffer.from(' '))]),raw.length],[Buffer.concat([packed,Buffer.from('junk')]),raw.length],[packed,8*1024*1024+1]])await assert.rejects(decodeGzipResponse(bytes,size),/service_protocol_failed/);
});
