import assert from 'node:assert/strict';
import path from 'node:path';

async function openClusterEnvironment(page,{deferProfileList=false}={}){
 await page.setViewportSize({width:1024,height:768});
 await page.evaluate(async deferProfileList=>{
  const f=window.__test;
  f.originalEnvironment={executables:{python:'/fixture/python',gpumd:'/fixture/gpumd'},repositories:{pydyn:'/fixture/pydyn'},variables:{OMP_NUM_THREADS:4,LIBRARY_PATH:''},site_extension:{config:{edition:7,features:[true,null,'preserve']}}};
  f.clusterProfile={id:'environment-cluster',version:4,name:'Environment fixture',scheduler:'slurm',auth_mode:'key',host:'fixture.invalid',username:'fixture',port:22,ssh_client:'/usr/bin/ssh',via:[],read_roots:[],remote_root:'/fixture/runs',queue:'short',activation:'',limits:{cpus:8,gpus:1,memory_mb:1024},environment:f.originalEnvironment,
   probe:{selected_scheduler:'slurm',detected_schedulers:['slurm'],ssh_status:'passed',scheduler_status:'passed',queue_status:'passed',queues:['fixture-private-queue']}};
  f.environmentSaves=[];f.environmentPrompts=[];
  f.responses={
   '/api/clusters':request=>{
    if(request.method==='GET')return deferProfileList?new Promise(resolve=>{f.finishClusterProfileList=()=>resolve([f.clusterProfile]);}):[f.clusterProfile];
    assertFixtureProfile(request.data);
    f.environmentSaves.push(structuredClone(request.data));
    f.clusterProfile={...request.data,version:f.clusterProfile.version+1};
    return {id:f.clusterProfile.id,version:f.clusterProfile.version};
   },
   '/api/cluster/profile':()=>f.clusterProfile,
   '/api/engines':()=>[],
  };
  function assertFixtureProfile(value){
   if(value?.id!==f.clusterProfile.id||value.version!==f.clusterProfile.version)throw Error('Unexpected environment fixture profile version');
  }
  const {default:ClusterPage}=await import('/frontend/features/cluster/ClusterPage.tsx');
  const props={worker:true,sourceId:'fixture-environment-worker',serviceVersion:'current',settings:f.settings,project:f.project,onError:error=>{throw error;},onRefresh:()=>{},onAgent:prompt=>f.environmentPrompts.push(prompt),onRun:()=>{},onAuthenticate:()=>{},onConnectCompute:()=>{},onTerminal:()=>{}};
  window.testRoot.render(window.React.createElement('div',{style:{height:'100%',overflow:'auto'}},window.React.createElement(ClusterPage,props)));
 },deferProfileList);
 const cluster=page.getByTestId('cluster-settings');
 await cluster.getByRole('button',{name:'环境探测',exact:true}).click();
 await cluster.getByRole('textbox',{name:'可执行文件绝对路径',exact:true}).first().waitFor();
 return cluster;
}

async function openSkill(cluster){
 const more=cluster.locator('.settings-advanced');
 if(!await more.evaluate(node=>node.open))await more.locator('summary').click();
 await more.getByRole('button',{name:'提交 Skill',exact:true}).click();
}

export async function frontendClusterEnvironmentCases({check,out}){
 await check('cluster-environment-draft-is-retained-during-initial-profile-discovery',async page=>{
  const cluster=await openClusterEnvironment(page,{deferProfileList:true});
  const details=cluster.getByTestId('cluster-environment-json');
  await details.locator('summary').click();
  const json=details.getByRole('textbox',{name:'显式科学环境 · JSON',exact:true});
  const partial='{"executables":{"python":"/draft';
  await json.fill(partial);
  await page.waitForFunction(()=>window.__test.finishClusterProfileList);
  await page.evaluate(()=>window.__test.finishClusterProfileList());
  const profiles=cluster.getByRole('combobox',{name:'集群配置',exact:true});
  await profiles.locator('option[value="environment-cluster"]').waitFor({state:'attached'});
  assert.equal(await profiles.inputValue(),'');
  assert.equal(await json.inputValue(),partial);
  assert.equal(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='worker.request'&&call.data.target==='/api/cluster/profile').length),0);
  await profiles.selectOption('environment-cluster');
  const python=cluster.getByRole('textbox',{name:'可执行文件绝对路径',exact:true}).first();
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-testid="cluster-environment-executables"] input')].some(input=>input.value==='/fixture/python'));
  assert.equal(await python.inputValue(),'/fixture/python');
 });

 await check('cluster-environment-structured-save-retains-the-original-version-and-diagnostics-entry',async page=>{
  const cluster=await openClusterEnvironment(page);
  const editor=cluster.getByTestId('cluster-environment-editor');
  const details=editor.getByTestId('cluster-environment-json');
  assert.equal(await details.evaluate(node=>node.open),false);
  await editor.getByRole('textbox',{name:'可执行文件绝对路径',exact:true}).first().fill('/fixture/selected-python');
  await editor.getByRole('textbox',{name:'变量值',exact:true}).first().fill('8');
  const repositories=editor.getByTestId('cluster-environment-repositories');
  await repositories.getByRole('button',{name:'添加仓库路径',exact:true}).click();
  await repositories.getByRole('textbox',{name:'仓库标识',exact:true}).last().fill('gpumd');
  await repositories.getByRole('textbox',{name:'仓库绝对路径',exact:true}).last().fill('/fixture/registered/gpumd');
  await page.screenshot({path:path.join(out,'cluster-environment-structured-1024.png')});
  await details.locator('summary').click();
  const text=details.getByRole('textbox',{name:'显式科学环境 · JSON',exact:true});
  const expected={...await page.evaluate(()=>window.__test.originalEnvironment),executables:{python:'/fixture/selected-python',gpumd:'/fixture/gpumd'},repositories:{pydyn:'/fixture/pydyn',gpumd:'/fixture/registered/gpumd'},variables:{OMP_NUM_THREADS:8,LIBRARY_PATH:''}};
  assert.deepEqual(JSON.parse(await text.inputValue()),expected);
  await openSkill(cluster);
  const gpu=cluster.getByRole('spinbutton',{name:'gpus',exact:true});
  await gpu.fill('');
  await cluster.getByRole('button',{name:'保存连接',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__test.environmentSaves.length),0);
  await gpu.fill('0');
  await cluster.getByRole('button',{name:'保存连接',exact:true}).click();
  await cluster.getByText('连接已保存；项目授权未改变。',{exact:true}).waitFor();
  const saved=await page.evaluate(()=>window.__test.environmentSaves);
  assert.equal(saved.length,1);
  assert.equal(saved[0].id,'environment-cluster');assert.equal(saved[0].version,4);assert.equal(saved[0].limits.gpus,0);
  assert.deepEqual(saved[0].environment,expected);
  await cluster.getByRole('button',{name:'环境探测',exact:true}).click();
  await cluster.getByRole('button',{name:'让 Agent 协助配置',exact:true}).click();
  const [prompt]=await page.evaluate(()=>window.__test.environmentPrompts);
  assert.match(prompt,/环境|集群/);assert.match(prompt,/environment-cluster/);assert.match(prompt,/"visible_queue_count":1/);
  assert.doesNotMatch(prompt,/fixture-private-queue|selected-python|site_extension/);
  assert.equal(await page.evaluate(()=>window.__test.calls.some(call=>call.method==='worker.request'&&call.data.method==='POST'&&/\/(projects|submit)$/.test(call.data.target))),false);
 });

 await check('cluster-environment-invalid-and-duplicate-drafts-survive-tab-switches',async page=>{
  const cluster=await openClusterEnvironment(page),editor=cluster.getByTestId('cluster-environment-editor');
  const details=editor.getByTestId('cluster-environment-json');
  await details.locator('summary').click();
  const json=details.getByRole('textbox',{name:'显式科学环境 · JSON',exact:true});
  const invalid='{"executables":{"python":"/fixture/partial';
  await json.fill(invalid);
  await details.getByRole('alert').filter({hasText:'JSON 语法有误。'}).waitFor();
  assert.equal(await editor.getByRole('textbox',{name:'可执行文件名称',exact:true}).first().isDisabled(),true);
  await cluster.getByRole('button',{name:'队列与环境',exact:true}).click();
  const queue=cluster.getByTestId('cluster-queue-settings');
  await queue.getByTestId('queue-add').click();
  await queue.getByRole('status').filter({hasText:'请先填写有效环境。'}).waitFor();
  assert.equal(await queue.getByTestId('queue-remove-0').count(),0);
  await openSkill(cluster);
  assert.equal(await json.inputValue(),invalid);
  await cluster.getByRole('button',{name:'保存连接',exact:true}).click();
  await cluster.getByText('修正科学环境草稿后再保存。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__test.environmentSaves.length),0);
  const source=await page.evaluate(()=>JSON.stringify(window.__test.originalEnvironment,null,2));
  await json.fill(source);
  const executables=editor.getByTestId('cluster-environment-executables');
  const duplicate=executables.getByRole('textbox',{name:'可执行文件名称',exact:true}).last();
  await duplicate.fill('python');
  await executables.getByRole('status').filter({hasText:'同一组内的名称必须唯一。'}).waitFor();
  assert.equal(await json.getAttribute('readonly'),'');
  await cluster.getByRole('button',{name:'环境探测',exact:true}).click();
  assert.equal(await duplicate.inputValue(),'python');
  assert.deepEqual(await executables.getByRole('textbox',{name:'可执行文件绝对路径',exact:true}).evaluateAll(inputs=>inputs.map(input=>input.value)),['/fixture/python','/fixture/gpumd']);
  await duplicate.fill('gpumd-renamed');
  await details.locator('summary').click();
  const repaired=JSON.parse(await json.inputValue());
  assert.deepEqual(repaired.executables,{python:'/fixture/python','gpumd-renamed':'/fixture/gpumd'});
  assert.deepEqual(repaired.site_extension,JSON.parse(source).site_extension);
  const duplicateRaw='{"executables":{"python":"/fixture/python"},"extra":{"enabled":true,"\\u0065nabled":false}}';
  await json.fill(duplicateRaw);
  await details.getByRole('alert').filter({hasText:'JSON 对象中有重复键。'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'cluster-environment-duplicate-advanced-json.png')});
  assert.equal(await json.inputValue(),duplicateRaw);
  const signedZero='{"executables":{"python":"/fixture/python"},"extra":{"signed":-0e2}}';
  await json.fill(signedZero);
  await details.getByRole('alert').filter({hasText:'JSON 数值超出可保存的精度。'}).waitFor();
  assert.equal(await json.inputValue(),signedZero);
  await cluster.getByRole('button',{name:'保存连接',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__test.environmentSaves.length),0);
 });
}
