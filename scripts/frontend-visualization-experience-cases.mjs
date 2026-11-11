// Actual renderer controls, with synthetic structures and service responses only.
import assert from 'node:assert/strict';
import path from 'node:path';

export async function frontendVisualizationExperienceCases({check,out}){
 const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await check('experience-materials-search-before-environment',async page=>{
  await page.evaluate(async()=>{
   const {MaterialsProjectSearch}=await import('/frontend/features/assets/MaterialsProject.tsx');
   document.getElementById('root').style.cssText='padding:24px;color:var(--text);background:var(--bg);height:100vh;overflow:auto';
   window.__test.mpCalls=[];const original=window.studio.invoke;
   window.studio.invoke=async(method,data)=>{if(method==='materials.search'){window.__test.mpCalls.push(data);return {documents:[{material_id:'mp-demo',formula:'CuNi',n_atoms:2,symmetry:{symbol:'synthetic'}}]};}return original(method,data);};
   window.testRoot.render(window.React.createElement(MaterialsProjectSearch,{worker:true,workerScope:'synthetic',projectId:'project',environments:[{id:'env-a',name:'Environment A'},{id:'env-b',name:'Environment B'}],onSaved:()=>{},onError:error=>{throw error;}}));
  });
  await page.getByPlaceholder('Li3PS4 / mp-149').fill('CuNi');await page.getByRole('button',{name:'搜索结构',exact:true}).click();
  await page.getByText('CuNi · mp-demo',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'导入并校验',exact:true}).isEnabled(),false);
  for(const id of ['env-a','env-b']){await page.getByLabel('检查环境',{exact:true}).selectOption(id);assert.equal(await page.getByText('CuNi · mp-demo',{exact:true}).isVisible(),true);assert.equal(await page.getByRole('button',{name:'导入并校验',exact:true}).isEnabled(),true);}
  assert.equal(await page.evaluate(()=>window.__test.mpCalls.length),1);
  await page.screenshot({path:path.join(out,'experience-materials-search-before-environment.png')});
 });
 await check('experience-structure-view-survives-frame-and-reopen',async page=>{
  await page.evaluate(async()=>{
   const {Structure}=await import('/frontend/ui/widgets.tsx');const {useState,createElement:h}=window.React;
   const data={positions:[[0,0,0],[2,0,0],[0,2,0],[0,0,2]],symbols:['Cu','Ni','Mg','O'],cell:[[4,0,0],[0,4,0],[0,0,4]],n_atoms:4};
   document.getElementById('root').style.cssText='padding:24px;max-width:1000px;margin:auto;color:var(--text);background:var(--bg);height:100vh;overflow:auto';
   function Fixture(){const[frame,setFrame]=useState(0),[open,setOpen]=useState(true);return h('div',{},h('h2',{},'结构查看 · 合成界面样例'),h('div',{className:'button-row'},h('button',{className:'button',onClick:()=>setFrame(frame+1)},'下一帧'),h('button',{className:'button',onClick:()=>setOpen(!open)},open?'关闭预览':'重新打开预览')),open?h('section',{className:'structure-card',style:{height:480}},h(Structure,{data:frame%2?{...data,positions:[[0,0,0],[3,0,0],[0,2.5,0],[0,0,1.5],[1,1,1]],symbols:[...data.symbols,'Li'],cell:[[5,0,0],[1,4,0],[0,0,3]],n_atoms:5}:data,viewKey:'synthetic-trajectory'})):h('p',{},'预览已关闭'));}
   window.testRoot.render(h(Fixture));
  });
  const canvas=page.locator('.structure canvas');await canvas.waitFor();await settle(page);
  const colors=await page.locator('.structure-legend i').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).backgroundColor));assert.equal(new Set(colors).size,4);
  const box=await canvas.boundingBox();await page.mouse.move(box.x+box.width*.55,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.75,box.y+box.height*.7,{steps:12});await page.mouse.up();await page.mouse.wheel(0,-200);await settle(page);
  const before=await canvas.screenshot();await canvas.evaluate(node=>{window.__test.originalCanvas=node;});
  await page.getByRole('button',{name:'下一帧',exact:true}).click();await settle(page);
  assert.equal(await canvas.evaluate(node=>window.__test.originalCanvas===node),true,'retain the WebGL renderer between frames');const changed=await canvas.screenshot();assert.notDeepEqual(changed,before,'different atom positions, atom count and cell must actually be rendered');
  await page.getByRole('button',{name:'关闭预览',exact:true}).click();await page.getByText('预览已关闭',{exact:true}).waitFor();await page.getByRole('button',{name:'重新打开预览',exact:true}).click();await canvas.waitFor();await settle(page);assert.deepEqual(await canvas.screenshot(),changed,'reopening the changed geometry restores the user view');
  await page.getByRole('button',{name:'下一帧',exact:true}).click();await settle(page);assert.deepEqual(await canvas.screenshot(),before,'returning through a genuinely different geometry preserves the rotated and zoomed camera');
  await page.getByRole('button',{name:'重置视角',exact:true}).click();await settle(page);assert.notDeepEqual(await canvas.screenshot(),before,'explicit reset changes the rotated view');
  await page.screenshot({path:path.join(out,'experience-structure-view-survives-frame-and-reopen.png')});
 });
 await check('experience-chart-range-survives-appearance-and-reopen',async page=>{
  await page.evaluate(async()=>{
   const {Chart}=await import('/frontend/ui/widgets.tsx');const{useState,createElement:h}=window.React;
   const text='# time temperature energy\n'+Array.from({length:100},(_,i)=>`${i} ${300+Math.sin(i/7)*5} ${40+Math.cos(i/8)*3}`).join('\n');
   document.getElementById('root').style.cssText='padding:24px;max-width:1100px;margin:auto;color:var(--text);background:var(--bg);height:100vh;overflow:auto';
   function Fixture(){const[open,setOpen]=useState(true),[source,setSource]=useState('file-a');return h('div',{},h('h2',{},'曲线查看 · 合成界面样例'),h('div',{className:'button-row'},h('button',{className:'button',onClick:()=>{document.documentElement.dataset.theme='light';document.documentElement.style.setProperty('--ui-min-font','16px');window.dispatchEvent(new Event('studio:appearance'));}},'浅色与大字体'),h('button',{className:'button',onClick:()=>setOpen(!open)},open?'关闭曲线':'重新打开曲线'),h('button',{className:'button',onClick:()=>setSource('file-b')},'另一份文件')),open?h('section',{style:{height:520}},h(Chart,{text,name:'thermo.out',viewKey:source})):h('p',{},'曲线已关闭'));}
   window.testRoot.render(h(Fixture));
  });
  await page.locator('.chart canvas').waitFor();await page.waitForFunction(()=>window.testChart(document.querySelector('.chart'))?.getOption()?.series?.length===2);
  const box=await page.locator('.chart').boundingBox();await page.mouse.click(box.x+50,box.y+18);
  await page.waitForFunction(()=>Object.values(window.testChart(document.querySelector('.chart')).getOption().legend[0].selected).some(v=>v===false));
  await page.mouse.move(box.x+box.width*.55,box.y+box.height*.5);await page.mouse.wheel(0,-300);
  await page.waitForFunction(()=>{const z=window.testChart(document.querySelector('.chart')).getOption().dataZoom[0];return z.end-z.start<99;});
  const capture=()=>page.evaluate(()=>{const chart=window.testChart(document.querySelector('.chart')),o=chart.getOption();return {id:chart.id,start:o.dataZoom[0].start,end:o.dataZoom[0].end,selected:o.legend[0].selected};});
  const before=await capture();await page.getByRole('button',{name:'浅色与大字体',exact:true}).click();await settle(page);
  assert.deepEqual(await capture(),before,'appearance updates keep the instance, range and legend');
  await page.getByRole('button',{name:'关闭曲线',exact:true}).click();await page.getByText('曲线已关闭',{exact:true}).waitFor();await page.getByRole('button',{name:'重新打开曲线',exact:true}).click();await page.locator('.chart canvas').waitFor();await settle(page);
  const reopened=await capture();assert.notEqual(reopened.id,before.id);assert.deepEqual({...reopened,id:before.id},before);
  await page.screenshot({path:path.join(out,'experience-chart-range-survives-appearance-and-reopen.png')});
  await page.getByRole('button',{name:'另一份文件',exact:true}).click();await settle(page);const other=await capture();assert.equal(other.start,0);assert.equal(other.end,100);assert(!Object.values(other.selected).includes(false));
 });
 await check('experience-structure-narrow-large-text-controls-remain-visible',async page=>{
  await page.evaluate(async()=>{
   const {Structure}=await import('/frontend/ui/widgets.tsx'),h=window.React.createElement;
   document.documentElement.style.setProperty('--ui-min-font','18px');document.getElementById('root').style.cssText='width:350px;margin:24px;color:var(--text);background:var(--bg);height:calc(100vh - 48px);overflow:auto';
   window.testRoot.render(h('section',{className:'structure-card'},h('p',{className:'mono'},'/synthetic/project/trajectory.extxyz · 结构帧序号 0'),h(Structure,{viewKey:'narrow-large',data:{positions:[[0,0,0],[2,0,0],[0,2,0],[0,0,2]],symbols:['Cu','Ni','Mg','O'],cell:[[4,0,0],[0,4,0],[0,0,4]],n_atoms:4}})));
  });
  await page.locator('.structure canvas').waitFor();await settle(page);
  const geometry=await page.evaluate(()=>{const card=document.querySelector('.structure-card'),button=card.querySelector('button'),note=card.querySelector('.chart-note'),c=card.getBoundingClientRect(),b=button.getBoundingClientRect(),n=note.getBoundingClientRect();return {cardBottom:c.bottom,buttonBottom:b.bottom,noteBottom:n.bottom,overflowX:card.scrollWidth-card.clientWidth,hit:button.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))};});
  assert(geometry.buttonBottom<=geometry.cardBottom&&geometry.noteBottom<=geometry.cardBottom,'controls and notes fit inside the adaptive card');assert.equal(geometry.hit,true);assert(geometry.overflowX<=1);
  await page.getByRole('button',{name:'重置视角',exact:true}).focus();await page.keyboard.press('Enter');await page.screenshot({path:path.join(out,'experience-structure-narrow-large-text-controls-remain-visible.png')});
 });
}
