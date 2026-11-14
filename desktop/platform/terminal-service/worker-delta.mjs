/** Source-only delta transfer; the remote inventory never selects local paths to read. */
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function deltaBundle(payload,inventory){
 if(!Array.isArray(inventory)||inventory.length>512)throw Error('service_protocol_failed');
 const available=new Map();
 for(const row of inventory){
  if(!row||Object.keys(row).sort().join(',')!=='path,sha256,size'||typeof row.path!=='string'||row.path.length>240||!Number.isSafeInteger(row.size)||row.size<0||row.size>2*1024*1024||!/^[a-f0-9]{64}$/.test(row.sha256)||available.has(row.path))throw Error('service_protocol_failed');
  available.set(row.path,row);
 }
 const files=payload.files.filter(row=>{const prior=available.get(row.path);return !prior||prior.size!==row.size||prior.sha256!==row.sha256;});
 const manifest=payload.files.map(({base64,...row})=>row),raw=Buffer.from(JSON.stringify({...payload,files,manifest})),packed=gzipSync(raw,{level:6});
 return {packed,end:{encoding:'gzip',size:packed.length,sha256:hash(packed),uncompressed_size:raw.length,uncompressed_sha256:hash(raw)},changedPaths:files.map(row=>row.path),sourceBytes:files.reduce((sum,row)=>sum+row.size,0)};
}
