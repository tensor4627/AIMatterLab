import assert from 'node:assert/strict';

const compiler='tools/graph_workflow.py',cvSource='fixture/cv.py',biasSource='fixture/bias.py';
const source={id:'synthetic-pygas-ports',files:{[compiler]:'a'.repeat(64),[cvSource]:'b'.repeat(64),[biasSource]:'c'.repeat(64)}};
function entry(kind,name,file,semantics={},output_size,params=[]){
 return {kind,name,source:{name:file,line:1,sha256:source.files[file]},semantics:{source:file,sha256:source.files[file],...semantics},output_size,
  documentation:'Synthetic renderer contract fixture',params:params.map(name=>({name,default:'',required:true,type_hint:'tensor',is_module_param:false})),forward_args:[]};
}
const cv=[entry('cv','FixtureVector',cvSource,{output_rank:1},1),entry('cv','FixtureScalar',cvSource,{output_rank:0},1),entry('cv','FixtureUnknown',cvSource,{},1)];
const bias=entry('bias','FixtureBias',biasSource,{reorder_policy:'permutation',ordered_cv_parameters:{sigma:{axis:0},scale:{axis:0}}},undefined,['sigma','scale']);
const catalog={schema_version:1,status:'passed',scope:'Synthetic renderer contract only',source,catalog:{cv,bias:[bias],switch:[],neighbor:[]},ports:{status:'passed',source_sha256:source.files[compiler],
 classes:{...Object.fromEntries(cv.map(item=>['cv.'+item.name,{inputs:{pos:'pos'},outputs:{value:'value'}}])),['bias.'+bias.name]:{inputs:{cv:'cv'},outputs:{bias:'bias'}}},
 templates:{metad:{input:{inputs:{},outputs:{pos:'pos'}},collect:{inputs:{value:'value'},outputs:{cv:'cv'}},output:{inputs:{cv:'cv',bias:'bias'},outputs:{}},reduce:{inputs:{value:'value'},outputs:{value:'value'}}}},
 multiple_inputs:[['collect','value'],['output','cv'],['output','bias']],compatible_pairs:[['value','cv'],['cv','value']],reductions:['identity','mean','sum','first'],
}};
const componentIds=['first','second','third'];
const connection=(src,sourcePort,dst,targetPort)=>({source:{node:src,port:sourcePort},target:{node:dst,port:targetPort}});
const graph={version:2,mode:'metad',parameter_format:'structured-v1',settings:{},nodes:[{id:'input',kind:'input'},
 ...componentIds.map(id=>({id,kind:'cv',class_name:'FixtureVector'})),{id:'scalar',kind:'cv',class_name:'FixtureScalar'},{id:'unknown',kind:'cv',class_name:'FixtureUnknown'},
 {id:'collect',kind:'collect'},{id:'bias',kind:'bias',class_name:'FixtureBias',params:{sigma:[1,2,3],scale:[1,0,1]}},{id:'output',kind:'output'}],edges:[
 ...[...componentIds,'scalar','unknown'].map(id=>connection('input','pos',id,'pos')),
 connection('first','value','collect','value'),connection('collect','cv','bias','cv'),connection('second','value','collect','value'),
 connection('collect','cv','output','cv'),connection('third','value','collect','value'),connection('bias','bias','output','bias')
]};

async function mount(page,{blockedBias=false}={}){
 await page.evaluate(({catalog,graph,blockedBias})=>{
  const f=window.__test,original=window.studio.invoke,taskId='synthetic-pygas-port-task';
  if(blockedBias)catalog.catalog.bias[0].semantics.reorder_policy='blocked';
  const sha='d'.repeat(64),composition={id:'synthetic-pair',graphPath:'/fixture/owned/workflow.json',sourcePath:'/fixture/owned/build_bias.py',
   status:'rendered',graph_sha256:sha,source_sha256:'e'.repeat(64),expected:{journal_sha256:'f'.repeat(64),files:{'workflow.json':sha}}};
  const response={taskId,composition,catalog,graph,assets:[],render_blocked:false};
  f.pygasPorts={calls:[],state:[],errors:[]};
  window.studio.invoke=async(method,data)=>{
   if(!method.startsWith('task.pygas.'))return original(method,data);
   f.pygasPorts.calls.push({method,data});
   if(method==='task.pygas.read')return response;
   if(method==='task.pygas.save')return {...response,graph:data.graph,composition:{...composition,status:'draft'},render_blocked:true};
   throw Error('Unexpected synthetic pyGAS operation '+method);
  };
  return window.renderTest('PygasTaskComposer',{task:{id:taskId,composition},worker:true,onSaved(){},onDiscussion(){},onError(error){f.pygasPorts.errors.push(String(error));},onStateChange(value){f.pygasPorts.state.push(value);}});
 },{catalog,graph,blockedBias});
 const composer=page.getByTestId('pygas-composer');await composer.waitFor();
 const node=composer.locator('.pg-node').filter({has:page.locator('.pg-node-toggle code').filter({hasText:/^collect$/})});
 const toggle=node.locator('.pg-node-toggle');
 if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
 await node.locator('.pg-connections>summary').click();
 return node.locator('[data-param="collect.value"]');
}
const operations=page=>page.evaluate(()=>window.__test.pygasPorts.calls);
const collectorSources=graph=>graph.edges.filter(edge=>edge.target.node==='collect'&&edge.target.port==='value').map(edge=>edge.source.node);
async function dragLastToFirst(page,rows){
 const handle=rows.last().getByTestId('pygas-cv-drag-handle');
 await handle.scrollIntoViewIfNeeded();await rows.first().scrollIntoViewIfNeeded();
 const from=await handle.boundingBox(),to=await rows.first().boundingBox();assert.ok(from&&to);
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
 await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:8});
 assert.equal(await rows.first().getAttribute('data-drag-over'),'true');
 await page.mouse.up();
}

export async function frontendPygasConnectionCases({check}){
 await check('experience-pygas-port-choices-show-real-rank-and-draft-conflict',async page=>{
  const port=await mount(page),rows=port.getByTestId('pygas-port-edge');
  assert.match(await rows.first().innerText(),/first\.value.*1D.*collect\.value/s);
  const alternate=port.getByLabel('collect.value add connection');
  assert(await alternate.isEnabled());
  await port.locator('.pg-source-choices>summary').press('Enter');
  const scalar=port.getByRole('button',{name:/scalar\.value/}),unknown=port.getByRole('button',{name:/unknown\.value/});
  await scalar.waitFor();
  assert.match(await scalar.innerText(),/0D.*0D 输出需先连接 Reduce/s);
  assert.match(await unknown.innerText(),/阶数待确认.*1 分量/);
  assert.equal(await port.getByRole('button',{name:/input\.pos/}).count(),0);
  await scalar.click();
  const edge=rows.filter({hasText:'scalar.value'});
  assert.equal(await edge.locator('[data-conflict=true]').count(),1);
  await page.getByTestId('pygas-ordering-review').waitFor();
  assert.equal(await page.evaluate(()=>window.__test.pygasPorts.state.at(-1).renderBlocked),true);
  assert.deepEqual((await operations(page)).map(call=>call.method),['task.pygas.read']);
  await edge.getByRole('button',{name:'Remove connection collect value 3',exact:true}).press('Enter');
  await edge.waitFor({state:'detached'});
  await page.getByTestId('save-pygas-composition').click();
  await page.waitForFunction(()=>window.__test.pygasPorts.calls.some(call=>call.method==='task.pygas.save'),undefined,{polling:25});
  const save=(await operations(page)).at(-1);
  assert.equal(save.method,'task.pygas.save');assert.equal(save.data.taskId,'synthetic-pygas-port-task');
  assert.deepEqual(save.data.graph,graph);
 });

 await check('experience-pygas-cv-drag-and-keyboard-keep-ordered-bias-aligned',async page=>{
  const port=await mount(page),rows=port.getByTestId('pygas-port-edge');
  await dragLastToFirst(page,rows);
  const review=page.getByTestId('pygas-ordering-review');await review.getByText(/2 → 0 → 1/).waitFor();
  assert.match(await rows.first().innerText(),/third\.value/);
  await rows.first().getByRole('button',{name:'Move down collect 0',exact:true}).press('Enter');
  await review.getByText(/1 → 0 → 2/).waitFor();
  assert.match(await rows.first().innerText(),/first\.value/);
  await page.getByTestId('save-pygas-composition').click();
  await page.waitForFunction(()=>window.__test.pygasPorts.calls.some(call=>call.method==='task.pygas.save'),undefined,{polling:25});
  const saved=(await operations(page)).at(-1).data.graph;
  assert.deepEqual(collectorSources(saved),['first','third','second']);
  assert.deepEqual(saved.nodes.find(node=>node.id==='bias').params,{sigma:[1,3,2],scale:[1,1,0]});
  assert.deepEqual(saved.edges.filter(edge=>edge.target.node!=='collect'),graph.edges.filter(edge=>edge.target.node!=='collect'));
 });

 await check('experience-pygas-cv-drag-honors-existing-source-guard',async page=>{
  const port=await mount(page,{blockedBias:true}),rows=port.getByTestId('pygas-port-edge');
  await dragLastToFirst(page,rows);
  await page.getByTestId('pygas-ordering-review').getByText(/Unknown bias/).waitFor();
  assert.match(await rows.first().innerText(),/first\.value/);
  assert.equal(await page.evaluate(()=>window.__test.pygasPorts.state.at(-1).dirty),false);
  assert.deepEqual((await operations(page)).map(call=>call.method),['task.pygas.read']);
 });
}
