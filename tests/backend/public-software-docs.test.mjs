import test from 'node:test';
import assert from 'node:assert/strict';
import {publicAddress,publicSoftwareUrl,softwareDocs} from '../../backend/main/tools/public-software-docs.mjs';

test('public software search keeps repository and package evidence separate, including unavailable sources',async()=>{
 const routes=[];
 const result=await softwareDocs('search_software_docs',{software:'example',version:'2.0'},async target=>{
  const url=new URL(target);routes.push(url);
  if(url.hostname==='pypi.org')throw Error('Package not found');
  return {text:JSON.stringify({items:[{full_name:'author/example',html_url:'https://github.com/author/example'}]})};
 });
 assert.equal(result.results[0].name,'author/example');
 assert.equal(result.sources[1].status,'unavailable');
 assert.equal(routes[0].searchParams.get('q'),'example in:name');
 assert.equal(routes[1].pathname,'/pypi/example/2.0/json');
});

test('remote manuals keep the final source and readable contents; internal and credential URLs stay local',async()=>{
 for(const addr of ['127.0.0.1','10.1.2.3','169.254.169.254','::1','::ffff:127.0.0.1','fe80::1','2002::1','192.168.1.1'])
  assert.equal(publicAddress(addr),false);
 assert.equal(publicAddress('1.1.1.1'),true);
 for(const url of ['file:///test','https://192.168.0.1/','https://example.local/','https://user:password@example.org','https://[::1]/'])
  assert.throws(()=>publicSoftwareUrl(url));
 const r=await softwareDocs('read_software_docs',{url:'https://example.org/doc'},async()=>({
  url:'https://docs.example.org/v2',type:'text/html',text:'<script>secret()</script><p>Use the release binary.</p>'}));
 assert.deepEqual(r,{source:'https://docs.example.org/v2',text:'Use the release binary.',truncated:false});
});
