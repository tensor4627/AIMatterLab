// Exercise the built renderer, production main/preload and an isolated catalog of planning fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {_electron as electron} from 'playwright';
import {Catalog} from '../backend/main/workspace/catalog.mjs';
import {TaskRecords} from '../backend/main/workspace/task-records.mjs';
import plan from '../tests/fixtures/workflow-roadmap.json' with {type:'json'};

const root=fileURLToPath(new URL('../',import.meta.url));
const runtime=path.join(root,'.studio');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'workflow-roadmap-')),profile=path.join(out,'profile');
const catalog=new Catalog(path.join(profile,'studio')),records=new TaskRecords(catalog,()=>{});
function seed(name,roadmap,files=['model.xyz','run.in']){
 const task=records.create({provider:'deepseek',planningMode:true,workflowVersion:2,request:name});
 const thread='fixture-'+task.id;
 records.attach(task.id,'deepseek',thread);
 const fields=['structure_file','potential_file','control_file'].map(key=>({key,label:key,type:'file',required:true}));
 const steps=[{id:'sources',title:'输入文件',fields},...Array.from({length:18},(_,i)=>({id:'form-'+i,title:'参数分组 '+(i+1),fields:[]}))];
 records.event({provider:'deepseek',method:'item/completed',params:{threadId:thread,item:{tool:'present_task',
  result:{id:task.id,kind:'task-parameters',name,steps,parameters:{engine:'gpumd.md',structure_file:'model.xyz',control_file:'run.in',potential_file:null,files},missing_fields:['potential_file'],...(roadmap?{roadmap}:{})}}}});
 return task.id;
}
const oldFiles=['基准计算/含有长名称的初始结构目录/第一组/model.xyz','重复计算/含有长名称的另一结构目录/第二组/model.xyz'];
const id=seed('分子动力学轨迹、热力学与结构分析',plan),old=seed('既有 MD 草稿',undefined,oldFiles);
const longPlan={schema_version:1,resources:Array.from({length:33},(_,i)=>({id:'r'+i,label:'产物 '+i,basis:'user'})),inputs:['r0'],outputs:['r32'],
 steps:Array.from({length:32},(_,i)=>({id:'s'+i,tool:'example.transform',label:'处理 '+(i+1),inputs:[{port:'source',resource:'r'+i}],outputs:[{port:'product',resource:'r'+(i+1)}]}))};
const longId=seed('32 次调用的接口示例',longPlan);
catalog.db.close();
const wrapper=path.join(out,'harness.mjs');
fs.writeFileSync(wrapper,`import {app} from 'electron';
app.setPath('userData',${JSON.stringify(profile)});
app.setPath('sessionData',${JSON.stringify(path.join(out,'session'))});
app.on('browser-window-created',(_event,win)=>{win.show=()=>{};win.showInactive=()=>{};win.webContents.setBackgroundThrottling(false);});
await import(${JSON.stringify(pathToFileURL(path.join(root,'desktop/main.mjs')).href)});`);
fs.mkdirSync(path.join(out,'session'));
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('STUDIO_')&&!['ELECTRON_RUN_AS_NODE','NODE_OPTIONS'].includes(key)));
const app=await electron.launch({args:[wrapper,'--disable-renderer-backgrounding'],env:{...env,STUDIO_PROFILE_DIR:profile}});
const checks=[];
try{
 const page=await app.firstWindow();page.setDefaultTimeout(13000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const header=page.getByTestId('workflow-pinned-heading'),drawing=page.getByTestId('workflow-roadmap');
 const canvas=drawing.locator('.roadmap-canvas'),transform=()=>page.getByTestId('roadmap-transform').getAttribute('transform');
 const scroller=page.locator('.workspace-content');
 async function open(taskId){
  await page.locator('.workspace-shell').waitFor();
  await page.evaluate(key=>{localStorage.removeItem('studio.conversation');localStorage.setItem('studio.section','agent-task:'+key);},taskId);
  await page.reload();await header.waitFor();
 }
 async function scrollTo(y){await scroller.evaluate((el,top)=>el.scrollTop=top,y);await page.evaluate(()=>new Promise(requestAnimationFrame));}
 await open(id);
 assert.equal(await drawing.locator('.roadmap-node.step').count(),4);
 assert.equal(await drawing.locator('.roadmap-edge').count(),10);
 assert.equal(await drawing.locator('.roadmap-runtime').count(),2);
 assert.equal(await page.getByText('CONVERSATION WORKFLOW',{exact:false}).count(),0);
 assert.equal(await page.getByText('在对话中持续调整，或展开步骤直接填写参数与文件。').count(),0);
 const hint=drawing.getByRole('tooltip'),node=key=>drawing.locator('[data-node-key="'+key+'"]');
 const names=[
  [node('input:structure'),'结构',plan.resources[0].label],
  [node('step:md'),'MD 采样',plan.steps[2].label],
  [node('output:thermo'),'热力学',plan.resources[4].label],
  [drawing.locator('.roadmap-runtime[data-side="top"]'),'NEP',plan.steps[2].runtime_labels.top.label],
  [drawing.locator('.roadmap-handoff').filter({hasText:'位移序列'}),'位移序列',plan.resources[5].label],
 ];
 for(const [item,short,full] of names){
  assert.equal(await item.locator('text').textContent(),short);
  await item.hover();await hint.waitFor();assert.equal(await hint.textContent(),full);
  await header.locator('h1').hover();await hint.waitFor({state:'hidden'});
  await item.focus();await hint.waitFor();assert.equal(await hint.textContent(),full);
 }
 assert.equal(await drawing.locator('.roadmap-port text').count(),0);
 assert.equal(await drawing.locator('.roadmap-canvas text').allTextContents().then(names=>names.some(n=>n.includes('…'))),false);
 assert.equal(await drawing.locator('.roadmap-handoff').count(),2);
 await header.locator('h1').click();await node('output:thermo').hover();
 await drawing.screenshot({path:path.join(out,'hover.png')});
 await header.locator('h1').click();await hint.waitFor({state:'hidden'});
 checks.push('input, tool, output, in-process module and handoff show the short label and reveal the exact full name on hover and keyboard focus');
 await header.screenshot({path:path.join(out,'expanded.png')});checks.push('four invocations, branching and joining artifact edges, internal runtime ports');
 await scroller.screenshot({path:path.join(out,'parameter-panel.png')});
 const execution=page.getByTestId('roadmap-execution');
 await execution.locator(':scope > summary').click();
 assert(await execution.getByRole('button',{name:'核对执行快照'}).isDisabled());
 assert(await execution.getByText('请先保存本地计算项目、环境与资源。').isVisible());
 assert.equal(await execution.getByLabel('执行回执').count(),0);
 await execution.locator(':scope > summary').click();await scrollTo(0);checks.push('execution panel opens and exposes missing deployment without submitting or claiming a receipt');
 const original=await header.boundingBox();await scrollTo(550);
 assert((await scroller.evaluate(el=>el.scrollTop))>250);
 assert(Math.abs((await header.boundingBox()).y-original.y)<2);checks.push('expanded header stays pinned when scrolling parameters');
 const box=await canvas.boundingBox(),cx=box.x+15,cy=box.y+box.height*.7;
 await header.locator('h1').click();const inactive=await transform(),initialScroll=await scroller.evaluate(el=>el.scrollTop);
 await page.mouse.move(cx,cy);await page.mouse.wheel(0,95);await page.waitForFunction(top=>document.querySelector('.workspace-content').scrollTop>top,initialScroll);
 assert.equal(await transform(),inactive);
 await page.mouse.click(cx,cy);await page.mouse.move(cx,cy);const before=await transform();
 const scrollBefore=await scroller.evaluate(el=>el.scrollTop);
 await page.mouse.wheel(0,-160);await page.waitForFunction(v=>document.querySelector('[data-testid="roadmap-transform"]').getAttribute('transform')!==v,before);
 assert.equal(await scroller.evaluate(el=>el.scrollTop),scrollBefore);
 const zoomed=await transform();await page.mouse.down();await page.mouse.move(cx+42,cy+16,{steps:4});await page.mouse.up();
 assert.notEqual(await transform(),zoomed);
 await page.getByRole('button',{name:'适应全图',exact:true}).click();assert.equal(await transform(),before);
 checks.push('pointer-centred wheel zoom, drag pan, fit and independent panel scroll');
 await scrollTo(0);
 await drawing.locator('[data-node-key="output:report"]').press('Enter');
 assert.match(await drawing.locator('.roadmap-node-detail').innerText(),/所需初始输入/);
 await page.getByRole('button',{name:'关闭节点详情'}).click();
 await drawing.locator('[data-node-key="output:thermo"]').press('Enter');
 assert.match(await drawing.locator('.roadmap-node-detail').innerText(),/采样间隔 0\.1 ps/);
 await page.getByRole('button',{name:'在对话中确认'}).click();
 await page.waitForFunction(owner=>localStorage.getItem('studio.conversation')===owner,'deepseek:fixture-'+id);
 await page.waitForFunction(()=>[...document.querySelectorAll('.composer textarea')].some(input=>input.value.includes('output:thermo')&&input.value.includes('采样间隔 0.1 ps')));
 assert.equal((await page.evaluate(taskId=>window.studio.invoke('task.read',{id:taskId}),id)).roadmap.resources.find(item=>item.id==='thermo').basis,'inferred');
 checks.push('inferred goal opens an editable confirmation in its own chat and stays pending before sending');
 await drawing.locator('[data-node-key="input:model"]').press('Enter');
 await page.getByRole('button',{name:'定位参数'}).click();
 await page.waitForFunction(()=>document.activeElement?.closest('[data-field]')?.getAttribute('data-field')==='potential_file');
 checks.push('requested product traces to initial inputs and a missing input focuses its editable form');
 await page.getByRole('button',{name:'收起计算流程图'}).click();
 const mini=page.getByTestId('roadmap-mini');await mini.waitFor();
 assert.equal(await mini.locator('.roadmap-node.step').count(),4);
 assert.equal(await mini.locator('text,[tabindex]').count(),0);
 const reduced=await header.boundingBox();assert(reduced.height<original.height-60);
 assert((await mini.boundingBox()).x>(await header.locator('h1').boundingBox()).x);
 await scrollTo(850);assert(Math.abs((await header.boundingBox()).y-original.y)<2);
 await header.screenshot({path:path.join(out,'collapsed.png')});
 await mini.press('Enter');await drawing.waitFor();checks.push('same graph in title thumbnail, space reclaimed, pinned while collapsed, keyboard restores');
 async function resize(width,height){
  await app.evaluate(({BrowserWindow},[w,h])=>{const win=BrowserWindow.getAllWindows()[0];win.setMinimumSize(800,600);win.setContentSize(w,h);},[width,height]);
  await page.waitForFunction(w=>innerWidth===w,width);
 }
 await resize(1366,768);await scrollTo(0);
 await drawing.screenshot({path:path.join(out,'laptop.png')});
 await resize(1024,768);
 await page.evaluate(()=>{
  document.documentElement.dataset.theme='light';
  document.documentElement.style.setProperty('--ui-scale',String(24/13));
  document.documentElement.style.setProperty('--ui-min-font','18px');
  window.dispatchEvent(new Event('studio:appearance'));
 });
 const narrow=await canvas.boundingBox();assert(narrow.width>120&&narrow.height>70);
 await node('output:thermo').focus();await hint.waitFor();
 const bubble=await hint.boundingBox();assert(bubble.x>=narrow.x&&bubble.x+bubble.width<=narrow.x+narrow.width+1);
 await node('output:thermo').press('Enter');await drawing.locator('.roadmap-node-detail').waitFor();
 assert.match(await drawing.locator('.roadmap-node-detail').innerText(),/采样间隔 0\.1 ps/);
 await page.getByRole('button',{name:'关闭节点详情'}).click();
 await page.getByRole('button',{name:'适应全图',exact:true}).click();
 await drawing.screenshot({path:path.join(out,'narrow-light.png')});
 checks.push('1366 and 1024 pixel windows, light theme, large type, in-bounds hover and focused offscreen output');
 await open(old);
 assert.equal(await drawing.locator('.roadmap-node.step').count(),1);
 assert.equal(await drawing.locator('.roadmap-node.output').count(),0);
 for(const [i,full] of oldFiles.entries()){
  const input=node('input:file-'+i);
  assert.equal(await input.locator('text').textContent(),'model.xyz · '+(i+1));
  await input.hover();await hint.waitFor();assert.equal(await hint.textContent(),full);
 }
 await drawing.getByRole('button',{name:/待明确/}).click();assert.match(await drawing.locator('.roadmap-findings').innerText(),/待定义目标产物/);
 checks.push('legacy files preserve both full paths on hover, distinguish matching basenames and preserve unknown outputs');
 await open(longId);assert.equal(await drawing.locator('.roadmap-node.step').count(),32);
 const firstBox=await node('step:s0').locator('text').boundingBox();
 assert(firstBox.height>=12);
 await node('output:r32').focus();await hint.waitFor();assert.equal(await hint.textContent(),'产物 32');
 await drawing.getByRole('button',{name:'适应全图',exact:true}).click();
 const bounds=await canvas.boundingBox(),ends=await drawing.locator('.roadmap-node.input, .roadmap-node.output').evaluateAll(nodes=>nodes.map(el=>({x:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})));
 assert(ends.length===2&&ends.every(end=>end.x>=bounds.x&&end.right<=bounds.x+bounds.width));
 checks.push('32-invocation chain opens at readable size, keyboard reaches its last output and Fit shows both boundaries');
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({status:'passed',checks,scope:'Offline planning fixtures, real Electron pointer/keyboard input; no model or calculation.'},null,2));
 console.log(JSON.stringify({out,checks}));
}finally{await app.close();}
