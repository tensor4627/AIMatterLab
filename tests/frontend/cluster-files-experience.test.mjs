import test from 'node:test';
import assert from 'node:assert/strict';
import {experienceHarness,deferred} from '../helpers/settings-experience-hooks.mjs';
const sha='a'.repeat(64),file=(text='fixture A')=>({exists:true,base64:Buffer.from(text).toString('base64'),sha256:sha,size:Buffer.byteLength(text)});
function setup(override){return experienceHarness({component:'ClusterFiles',invoke:async(method,data)=>{const result=override?.(method,data);if(result!==undefined)return result;if(method==='worker.request')return file();if(method==='cluster.download')return {bytes:9,sha256:sha};throw Error('Unexpected fixture action');}});}
const pathInput=h=>h.find(node=>node.type==='input');
async function preview(h,path='a.xyz'){h.change(pathInput(h),path);h.button('浏览 / 预览').props.onClick();await h.flush();}
for(const source of ['path','root','project','cluster','root-list','scope','connection'])test(source+' change hides remote preview/download and asks for an explicit new read',async()=>{
 const h=setup();try{await preview(h);assert.match(h.text(),/fixture A/);const calls=h.calls.length;
  if(source==='path')h.change(pathInput(h),'b.xyz');else if(source==='root'){h.change(h.find(n=>n.type==='select'),'1');assert.equal(pathInput(h).props.value,'');}else h.render(source==='project'?{projectId:'project-b'}:source==='cluster'?{clusterId:'cluster-b'}:source==='root-list'?{roots:['~/other']} :source==='scope'?{scope:'other-source'}:{enabled:false});
  await h.flush();assert(!h.text().includes('fixture A'));assert(!h.all().some(n=>n.type==='button'&&n.props.children==='下载文件'));h.byId('cluster-files-stale');assert.match(h.text(),/旧预览已隐藏/);assert.equal(h.calls.length,calls);assert.equal(h.calls.filter(c=>c.method==='cluster.download').length,0);
 }finally{h.unmount();}
});
test('late browse responses and errors cannot replace a new path or connection',async()=>{
 const gates=[],h=setup(method=>{if(method==='worker.request'){const gate=deferred();gates.push(gate);return gate.promise;}});try{await preview(h,'old.xyz');h.change(pathInput(h),'new.xyz');h.button('浏览 / 预览').props.onClick();await h.flush();gates[1].resolve(file('current file'));await h.flush();gates[0].resolve(file('old file'));await h.flush();assert.match(h.text(),/current file/);assert(!h.text().includes('old file'));await preview(h,'third.xyz');h.render({scope:'project-b:cluster-b:2',projectId:'project-b',clusterId:'cluster-b'});gates[2].reject(Error('Old connection failure'));await h.flush();assert(!h.text().includes('current file'));assert.deepEqual(h.errors,[]);}finally{h.unmount();}
});
test('download uses immutable preview identity and hash; cancellation never claims success',async()=>{
 const gate=deferred(),h=setup(method=>method==='cluster.download'?gate.promise:undefined);try{await preview(h);const click=h.button('下载文件').props.onClick;click();click();await h.flush();const calls=h.calls.filter(c=>c.method==='cluster.download');assert.equal(calls.length,1);assert.deepEqual(calls[0].data,{project_id:'project-a',cluster_id:'cluster-a',relative:'a.xyz',root_index:0,expected_sha256:sha});assert.match(h.text(),/正在准备下载/);gate.resolve(null);await h.flush();assert(!h.text().includes('文件已下载并通过'));assert.equal(h.button('下载文件').props.disabled,false);}finally{h.unmount();}
});
test('successful download reports completion, empty files are downloadable, and failures are retryable',async()=>{
 let fail=false;const h=setup(method=>method==='worker.request'?Promise.resolve(file('')):method==='cluster.download'&&fail?Promise.reject(Error('Synthetic download error')):undefined);try{await preview(h);h.button('下载文件').props.onClick();await h.flush();assert.match(h.text(),/文件已下载并通过 SHA256 核对/);fail=true;h.button('下载文件').props.onClick();await h.flush();assert(!h.text().includes('文件已下载并通过'));assert.match(h.text(),/Synthetic download error/);assert.equal(h.button('下载文件').props.disabled,false);}finally{h.unmount();}
});
test('saved-profile requirement disables browsing, and directory rows use the loaded parent path',async()=>{
 const h=setup(()=>Promise.resolve({exists:true,entries:[{name:'child',directory:true}]}));try{h.render({enabled:false});h.button('浏览 / 预览').props.onClick();await h.flush();assert.equal(h.calls.length,0);h.render({enabled:true});await preview(h,'parent');h.button('childdirectory').props.onClick();await h.flush();assert.equal(h.calls.at(-1).data.data.relative,'parent/child');h.button('上一级目录').props.onClick();await h.flush();assert.equal(h.calls.at(-1).data.data.relative,'parent');}finally{h.unmount();}
});

for(const outcome of ['success','cancel','failure'])test('a displaced remote download '+outcome+' settles visibly without applying to the new file',async()=>{
 const gate=deferred(),h=setup(method=>method==='cluster.download'?gate.promise:undefined);try{await preview(h);h.button('下载文件').props.onClick();await h.flush();h.change(pathInput(h),'other.xyz');await h.flush();assert.match(h.text(),/下载仍可能完成/);const calls=h.calls.length;if(outcome==='failure')gate.reject(Error('Old download failed'));else gate.resolve(outcome==='cancel'?null:{bytes:9,sha256:sha});await h.flush();assert.match(h.text(),/先前下载请求已结束/);assert.doesNotMatch(h.text(),/仍可能完成|文件已下载并通过/);assert.equal(h.calls.length,calls);assert.deepEqual(h.errors,[]);}finally{h.unmount();}
});

for(const partial of [false,true])test((partial?'partial':'complete')+' remote preview reports actual byte coverage without reading more data',async()=>{
 const h=setup(method=>method==='worker.request'?Promise.resolve({...file('结构'),size:partial?400000:6}):undefined);try{await preview(h);h.byId('cluster-file-preview-size');assert.match(h.text(),partial?/6 \/ 400000 B/:/6 \/ 6 B/);if(partial)assert.match(h.text(),/部分预览：仅显示文件前部/);else assert.doesNotMatch(h.text(),/部分预览/);assert.equal(h.calls.length,1);assert.equal(h.calls[0].data.data.relative,'a.xyz');assert.equal(h.button('下载文件').props.disabled,false);}finally{h.unmount();}
});
