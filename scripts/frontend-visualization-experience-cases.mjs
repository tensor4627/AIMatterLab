// Actual renderer controls, with synthetic structures and service responses only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
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
   const {observeStructureViews}=await import('/tests/helpers/three-viewer-probe.mjs');window.__test.structureViews=observeStructureViews();
   const data={positions:[[0,0,0],[2,0,0],[0,2,0],[0,0,2]],symbols:['Cu','Ni','Mg','O'],cell:[[4,0,0],[0,4,0],[0,0,4]],n_atoms:4};
   document.getElementById('root').style.cssText='padding:24px;max-width:1000px;margin:auto;color:var(--text);background:var(--bg);height:100vh;overflow:auto';
   function Fixture(){const[frame,setFrame]=useState(0),[open,setOpen]=useState(true);return h('div',{},h('h2',{},'结构查看 · 合成界面样例'),h('div',{className:'button-row'},h('button',{className:'button',onClick:()=>setFrame(frame+1)},'下一帧'),h('button',{className:'button',onClick:()=>setOpen(!open)},open?'关闭预览':'重新打开预览')),open?h('section',{className:'structure-card',style:{height:480}},h(Structure,{data:frame%2?{...data,positions:[[0,0,0],[3,0,0],[0,2.5,0],[0,0,1.5],[1,1,1]],symbols:[...data.symbols,'Li'],cell:[[5,0,0],[1,4,0],[0,0,3]],n_atoms:5}:data,viewKey:'synthetic-trajectory'})):h('p',{},'预览已关闭'));}
   window.testRoot.render(h(Fixture));
  });
  const canvas=page.locator('.structure canvas');await canvas.waitFor();
  const capture=async count=>{
   await page.waitForFunction(count=>window.__test.structureViews.read(document.querySelector('.structure canvas'))?.count===count,count,{polling:25});
   return canvas.evaluate(node=>window.__test.structureViews.read(node));
  };
  const colors=await page.locator('.structure-legend i').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).backgroundColor));assert.equal(new Set(colors).size,4);
  try{
   const initial=await capture(4),box=await canvas.boundingBox();
   await page.mouse.move(box.x+box.width*.55,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.75,box.y+box.height*.7,{steps:12});await page.mouse.up();
   const rotated=await capture(4);assert.notDeepEqual(rotated.view.orientation,initial.view.orientation);
   await page.mouse.wheel(0,-200);
   await page.waitForFunction(initial=>JSON.stringify(window.__test.structureViews.read(document.querySelector('.structure canvas'))?.view.position)!==JSON.stringify(initial),rotated.view.position,{polling:25});
   const before=await capture(4);await canvas.evaluate(node=>{window.__test.originalCanvas=node;});
   await page.getByRole('button',{name:'下一帧',exact:true}).click();
   const changed=await capture(5);
   assert.equal(await canvas.evaluate(node=>window.__test.originalCanvas===node),true,'retain the WebGL renderer between frames');
   assert.notDeepEqual(changed.transforms,before.transforms);assert.notDeepEqual(changed.cell,before.cell);assert.deepEqual(changed.view,before.view);
   await page.getByRole('button',{name:'关闭预览',exact:true}).click();await page.getByText('预览已关闭',{exact:true}).waitFor();
   await page.getByRole('button',{name:'重新打开预览',exact:true}).click();assert.deepEqual(await capture(5),changed,'reopening restores the user view');
   await page.getByRole('button',{name:'下一帧',exact:true}).click();assert.deepEqual(await capture(4),before,'switching back retains the rotated and zoomed view');
   await page.getByRole('button',{name:'重置视角',exact:true}).click();assert.notDeepEqual((await capture(4)).view,before.view,'explicit reset changes the rotated view');
   await page.screenshot({path:path.join(out,'experience-structure-view-survives-frame-and-reopen.png')});
  }finally{await page.evaluate(()=>window.__test.structureViews.restore());}
 });
 await check('experience-structure-frame-reuses-position-and-element-objects',async page=>{
  await page.evaluate(async()=>{
   const {Structure}=await import('/frontend/ui/widgets.tsx');
   const {useState,createElement:h}=window.React;
   const symbols=Array.from({length:72},(_,i)=>i%2?'Cu':'Xx');
   function Fixture(){
    const [frame,setFrame]=useState(0);
    const positions=symbols.map((_,i)=>[i%6,Math.floor(i/6),frame+(i%3)*frame]);
    return h('section',{className:'structure-card',style:{height:480}},
     h('button',{onClick:()=>setFrame(value=>value+1)},'推进夹具帧'),
     h(Structure,{data:{positions,symbols:[...symbols],cell:[],n_atoms:symbols.length},viewKey:'repeat-element-fixture'}));
   }
   window.testRoot.render(h(Fixture));
  });
  await page.locator('.structure canvas').waitFor();
  await page.evaluate(async()=>{const {observeAtomUpdates}=await import('/tests/helpers/three-viewer-probe.mjs');window.__test.atomProbe=observeAtomUpdates();});
  try{
   for(let frame=1;frame<=2;frame++){
    await page.getByRole('button',{name:'推进夹具帧',exact:true}).click();
    await page.waitForFunction(()=>window.__test.atomProbe.count===72);
    assert.deepEqual(await page.evaluate(()=>window.__test.atomProbe.snapshot(72)),{
     atoms:72,centerVectors:1,offsetVectors:1,offsets:72,colorObjects:2,sharedVector:true,reusedCenter:frame===2,reusedVector:frame===2
    });
   }
  }finally{await page.evaluate(()=>window.__test.atomProbe.restore());}
  assert.deepEqual(await page.locator('.structure-legend span').allTextContents(),['Xx · 36','Cu · 36']);
 });
 await check('experience-chart-range-survives-appearance-and-reopen',async page=>{
  await page.evaluate(async()=>{
   const {Chart}=await import('/frontend/ui/widgets.tsx');const{useState,createElement:h}=window.React;
   const text='# time temperature energy\n'+Array.from({length:100},(_,i)=>`${i} ${300+Math.sin(i/7)*5} ${40+Math.cos(i/8)*3}`).join('\n');
   document.getElementById('root').style.cssText='padding:24px;max-width:1100px;margin:auto;color:var(--text);background:var(--bg);height:100vh;overflow:auto';
   function Fixture(){const[open,setOpen]=useState(true),[source,setSource]=useState('file-a');return h('div',{},h('h2',{},'曲线查看 · 合成界面样例'),h('div',{className:'button-row'},h('button',{className:'button',onClick:()=>{document.documentElement.dataset.theme='light';document.documentElement.style.setProperty('--ui-min-font','16px');window.dispatchEvent(new Event('studio:appearance'));}},'浅色与大字体'),h('button',{className:'button',onClick:()=>setOpen(!open)},open?'关闭曲线':'重新打开曲线'),h('button',{className:'button',onClick:()=>setSource('file-b')},'另一份文件')),open?h('section',{style:{height:520}},h(Chart,{text,name:'thermo.out',viewKey:source})):h('p',{},'曲线已关闭'));}
   window.testRoot.render(h(Fixture));
  });
  const ready=()=>page.waitForFunction(()=>{const host=document.querySelector('.chart');return host&&window.testChart(host)?.getOption()?.series?.length===2;},undefined,{polling:25});
  await page.locator('.chart canvas').waitFor();await ready();
  const box=await page.locator('.chart').boundingBox();await page.mouse.click(box.x+50,box.y+18);
  await page.waitForFunction(()=>Object.values(window.testChart(document.querySelector('.chart')).getOption().legend[0].selected).some(v=>v===false));
  await page.mouse.move(box.x+box.width*.55,box.y+box.height*.5);await page.mouse.wheel(0,-300);
  await page.waitForFunction(()=>{const z=window.testChart(document.querySelector('.chart')).getOption().dataZoom[0];return z.end-z.start<99;});
  const capture=()=>page.evaluate(()=>{const chart=window.testChart(document.querySelector('.chart')),o=chart.getOption();return {id:chart.id,start:o.dataZoom[0].start,end:o.dataZoom[0].end,selected:o.legend[0].selected};});
  const before=await capture();await page.getByRole('button',{name:'浅色与大字体',exact:true}).click();
  await page.waitForFunction(()=>window.testChart(document.querySelector('.chart'))?.getOption()?.textStyle?.fontSize>=16,undefined,{polling:25});
  assert.deepEqual(await capture(),before,'appearance updates keep the instance, range and legend');
  await page.getByRole('button',{name:'关闭曲线',exact:true}).click();await page.getByText('曲线已关闭',{exact:true}).waitFor();await page.getByRole('button',{name:'重新打开曲线',exact:true}).click();await ready();
  const reopened=await capture();assert.notEqual(reopened.id,before.id);assert.deepEqual({...reopened,id:before.id},before);
  await page.getByRole('button',{name:'另一份文件',exact:true}).click();
  await page.waitForFunction(id=>{const chart=window.testChart(document.querySelector('.chart'));return chart?.id!==id&&chart?.getOption()?.series?.length===2;},reopened.id,{polling:25});
  const other=await capture();assert.equal(other.start,0);assert.equal(other.end,100);assert(!Object.values(other.selected).includes(false));
  await page.screenshot({path:path.join(out,'experience-chart-range-survives-appearance-and-reopen.png')});
 });
 await check('experience-chart-resize-bursts-share-a-frame-and-cancel-on-close',async page=>{
  await page.evaluate(async()=>{
   const {Chart}=await import('/frontend/ui/widgets.tsx'),{useState,createElement:h}=window.React;
   const OriginalObserver=window.ResizeObserver,raf=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);
   const queued=new Map();let nextId=-1,duringNotify=false;
   const fixture=window.__test.resizeProbe={cancelled:0,disconnected:0,resizes:0,patches:0,queued};
   window.requestAnimationFrame=callback=>{
    if(!duringNotify)return raf(callback);
    const id=nextId--;queued.set(id,callback);return id;
   };
   window.cancelAnimationFrame=id=>{if(queued.delete(id))fixture.cancelled++;else cancel(id);};
   window.ResizeObserver=class extends OriginalObserver{
    constructor(callback){super(callback);this.callback=callback;}
    observe(host,options){
     if(!host.matches('.chart')){super.observe(host,options);return;}
     this.chartHost=host;
     fixture.notify=(width,count)=>{
      host.style.width=width+'px';duringNotify=true;
      try{for(let i=0;i<count;i++)this.callback([],this);}finally{duringNotify=false;}
     };
    }
    disconnect(){if(this.chartHost)fixture.disconnected++;super.disconnect();}
   };
   fixture.flush=()=>{for(const [id,callback] of queued){queued.delete(id);callback(performance.now());}};
   document.getElementById('root').style.cssText='width:960px;padding:24px';
   function Fixture(){
    const[open,setOpen]=useState(true);
    return h('section',{},h('button',{onClick:()=>setOpen(false)},'关闭测试图表'),open&&h(Chart,{text:'# time value\n0 1\n1 2\n2 3',name:'resize.out'}));
   }
   window.testRoot.render(h(Fixture));
  });
  await page.locator('.chart canvas').waitFor();
  await page.waitForFunction(()=>window.testChart(document.querySelector('.chart'))?.getOption()?.xAxis?.length===1&&window.__test.resizeProbe.notify);
  const first=await page.evaluate(()=>{
   const f=window.__test.resizeProbe,chart=f.chart=window.testChart(document.querySelector('.chart'));
   const resize=chart.resize,option=chart.setOption;
   chart.resize=function(...args){f.resizes++;return resize.apply(this,args);};
   chart.setOption=function(...args){f.patches++;return option.apply(this,args);};
   f.notify(310,4);
   return {resizes:f.resizes,patches:f.patches,queued:f.queued.size};
  });
  assert.deepEqual(first,{resizes:0,patches:0,queued:1});
  const result=await page.evaluate(()=>{
   const f=window.__test.resizeProbe;
   f.flush();const first={resizes:f.resizes,patches:f.patches,width:f.chart.getWidth(),ticks:f.chart.getOption().xAxis[0].splitNumber};
   f.notify(311,3);f.flush();
   const second={resizes:f.resizes,patches:f.patches,width:f.chart.getWidth(),ticks:f.chart.getOption().xAxis[0].splitNumber};
   f.notify(600,2);
   return {first,second,queued:f.queued.size};
  });
  assert.deepEqual(result,{first:{resizes:1,patches:1,width:310,ticks:3},second:{resizes:2,patches:1,width:311,ticks:3},queued:1});
  await page.getByRole('button',{name:'关闭测试图表',exact:true}).click();
  await page.waitForFunction(()=>window.__test.resizeProbe.chart.isDisposed(),undefined,{polling:25});
  assert.deepEqual(await page.evaluate(()=>{
   const f=window.__test.resizeProbe;f.flush();return {resizes:f.resizes,patches:f.patches,queued:f.queued.size,cancelled:f.cancelled,disconnected:f.disconnected,disposed:f.chart.isDisposed()};
  }),{resizes:2,patches:1,queued:0,cancelled:1,disconnected:1,disposed:true});
 });
 await check('experience-structure-cell-follows-theme-without-reset',async page=>{
  await page.evaluate(async()=>{
   const {Structure}=await import('/frontend/ui/widgets.tsx'),{observeStructureViews}=await import('/tests/helpers/three-viewer-probe.mjs'),h=window.React.createElement;
   window.__test.structureViews=observeStructureViews();
   document.documentElement.dataset.theme='dark';
   const root=document.getElementById('root');root.style.cssText='padding:24px;max-width:900px;background:var(--bg)';
   const appear=theme=>{document.documentElement.dataset.theme=theme;window.dispatchEvent(new Event('studio:appearance'));};
   window.testRoot.render(h('section',{},h('button',{onClick:()=>appear('light')},'浅色外观'),h('button',{onClick:()=>appear('dark')},'深色外观'),
    h('section',{className:'structure-card',style:{height:430}},h(Structure,{data:{n_atoms:2,positions:[[0,0,0],[1,1,1]],symbols:['Cu','O'],cell:[[4,0,0],[0,4,0],[0,0,4]]},viewKey:'theme-cell-fixture'}))));
  });
  const canvas=page.locator('.structure canvas');await canvas.waitFor();
  const capture=()=>canvas.evaluate(node=>({scene:window.__test.structureViews.read(node),background:getComputedStyle(document.getElementById('root')).backgroundColor.match(/\d+/g).map(Number)}));
  const contrast=({scene,background})=>{
   const color=scene.cellAppearance.color.match(/../g).map(value=>parseInt(value,16)),alpha=scene.cellAppearance.opacity;
   const displayed=color.map((value,i)=>alpha*value+(1-alpha)*background[i]);
   const luminance=channels=>channels.map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
   const values=[luminance(displayed),luminance(background)];return (Math.max(...values)+.05)/(Math.min(...values)+.05);
  };
  try{
   await page.waitForFunction(()=>window.__test.structureViews.read(document.querySelector('.structure canvas'))?.cellAppearance,undefined,{polling:25});
   const before=await capture();await canvas.evaluate(node=>window.__test.originalCanvas=node);
   assert(contrast(before)>=4.5);
   await page.getByRole('button',{name:'浅色外观',exact:true}).press('Enter');
   const light=await capture();assert(contrast(light)>=4.5);assert.notEqual(light.scene.cellAppearance.color,before.scene.cellAppearance.color);
   assert.deepEqual({...light.scene,cellAppearance:before.scene.cellAppearance},before.scene);
   assert.equal(await canvas.evaluate(node=>window.__test.originalCanvas===node),true);
   await page.getByRole('button',{name:'深色外观',exact:true}).press('Enter');assert.deepEqual(await capture(),before);
   await page.screenshot({path:path.join(out,'experience-structure-cell-follows-theme.png')});
  }finally{await page.evaluate(()=>window.__test.structureViews.restore());}
 });

 await check('experience-monaco-artifact-theme-and-computed-font-stay-live',async page=>{
  await page.evaluate(()=>{
   const f=window.__test,style=document.createElement('style');document.head.append(style);
   f.editorAppearance=(theme,base,min)=>{
    document.documentElement.dataset.theme=theme;
    style.textContent=`:root { --editor-font-size:${base}; --ui-min-font:${min}px; }`;
    window.dispatchEvent(new Event('studio:appearance'));
   };
   f.editorAppearance('dark',10,11);
   f.responses={'/api/run/collect':()=>({run:f.run.id,artifacts:[{name:'numbers.txt',size:14}]}),'/api/run/file':()=>({text:'41 42\n43 44\n',offset:12,size:12})};
   return window.renderTest('RunDetail',{run:{...f.run,status:'succeeded'},connected:true,onRefresh:()=>{},onError:error=>{throw error;}});
  });
  await page.getByRole('tab',{name:'结果',exact:true}).click();
  await page.locator('.file-list').getByRole('button',{name:/numbers\.txt/}).click();
  const editor=page.locator('.artifact-preview .monaco-editor');
  await editor.locator('.view-lines').getByText(/41/).waitFor();
  const snapshot=()=>editor.evaluate(node=>({
   dark:node.classList.contains('vs-dark'),light:node.classList.contains('vs'),
   font:getComputedStyle(node.querySelector('.view-lines')).fontSize,
   background:getComputedStyle(node.querySelector('.monaco-editor-background')).backgroundColor,
   lineNumber:getComputedStyle(node.querySelector('.line-numbers')).color,
   text:node.querySelector('.view-lines').textContent,
  }));
  const start=await snapshot();assert.equal(start.dark,true);assert.equal(start.font,'12px');
  await editor.evaluate(node=>window.__test.originalEditor=node);
  await page.evaluate(()=>window.__test.editorAppearance('light',24,18));
  const light=await snapshot();assert.equal(light.light,true);assert.equal(light.font,'24px');
  assert.equal(light.background,'rgb(248, 247, 250)');assert.match(light.lineNumber,/rgb\((41, 38, 51|91, 88, 104)\)/);
  assert.equal(light.text,start.text);assert.equal(await editor.evaluate(node=>window.__test.originalEditor===node),true);
  await page.evaluate(()=>window.__test.editorAppearance('dark',17,18));
  const dark=await snapshot();assert.equal(dark.dark,true);assert.equal(dark.font,'18px');assert.equal(dark.background,start.background);
 });

 await check('experience-run-log-retains-tail-and-evidence-boundary-after-overflow',async page=>{
  await page.evaluate(async()=>{
   const {default:RunDetail}=await import('/frontend/features/runs/RunDetail.tsx');
   const {EvidenceConversation}=await import('/frontend/features/conversations/EvidenceSelection.tsx');
   const {LOG_LIMIT}=await import('/frontend/features/runs/log-buffer.mjs');
   const h=window.React.createElement,f=window.__test;
   const probe=f.logRetention={text:'first log line\n',large:Array.from({length:20000},(_,i)=>`step=${String(i).padStart(6,'0')} temperature[K]=300.5 total_energy[eV]=-12.3 value=synthetic\n`).join(''),
    latest:'end of synthetic log\n',limit:LOG_LIMIT,emptyReads:0};
   f.responses={'/api/run/log':({data})=>{
    if(data.run_id!==f.run.id)throw Error('Unexpected log ownership');
    const offset=Math.min(data.offset+256*1024,probe.text.length),text=probe.text.slice(data.offset,offset);
    if(!text)probe.emptyReads++;
    return {offset,text};
   }};
   window.testRoot.render(h(EvidenceConversation.Provider,{value:{provider:'codex',threadId:'synthetic-log-owner',name:'Synthetic log conversation'}},
    h(RunDetail,{run:{...f.run,status:'running'},connected:true,onRefresh:()=>{},onError:cause=>{throw cause;}})));
  });
  const log=page.locator('pre.console'),evidence=page.getByTestId('chat-evidence');
  await log.getByText('first log line',{exact:true}).waitFor();
  await evidence.waitFor();
  async function waitForTail(){
   await page.waitForFunction(()=>{
    const text=document.querySelector('pre.console')?.textContent;
    return text?.endsWith(window.__test.logRetention.text.slice(-128));
   },undefined,{timeout:9000,polling:25});
  }
  const observe=()=>log.evaluate(pre=>{
   const f=window.__test.logRetention,marker=pre.firstElementChild?.textContent??'';
   const chunks=[...pre.children].slice(1).map(span=>span.textContent),tail=chunks.join('');
   return {codeUnits:tail.length,exactTail:tail===f.text.slice(-f.limit),marker:marker.includes('较早输出已省略'),chunks:chunks.length};
  });
  await page.evaluate(()=>{const f=window.__test.logRetention;f.text+=f.large;});
  await waitForTail();
  const overflow=await observe();assert.deepEqual(overflow,{codeUnits:1048576,exactTail:true,marker:true,chunks:1});
  await evidence.waitFor({state:'detached'});
  await page.evaluate(()=>{const f=window.__test.logRetention;f.text+=f.latest;});
  await waitForTail();
  const appended=await observe();assert.deepEqual(appended,{codeUnits:1048576,exactTail:true,marker:true,chunks:2});
  assert.equal(await evidence.count(),0);
  const readCount=await page.evaluate(()=>window.__test.logRetention.emptyReads);
  await page.waitForFunction(count=>window.__test.logRetention.emptyReads>count,readCount,{timeout:9000,polling:25});
  // Allow the empty response to settle in the rendered log before checking its receipt.
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));
  const empty=await observe();assert.deepEqual(empty,appended);assert.equal(await evidence.count(),0);
  await fs.writeFile(path.join(out,'run-log-retention.json'),JSON.stringify({
   scope:'Actual RunDetail with synthetic incremental log IPC and an attached evidence context',inputLines:20000,appendedCodeUnits:21,
   overflow,appended,empty,evidenceBeforeOverflow:true,evidenceAfterOverflow:false,
  },null,2)+'\n');
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
