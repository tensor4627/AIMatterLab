import assert from 'node:assert/strict';
import path from 'node:path';

export async function frontendManagedToolCases({check,out}){
 await check('managed-tools-experience-follows-the-restored-conversation',async page=>{
  await page.evaluate(()=>{
   const original=window.studio.invoke;
   const provider='deepseek',threadId='isolated-managed-tool-chat';
   const conversation={id:provider+':'+threadId,provider,threadId,name:'隔离测试 · 集群队列',projectId:null,taskId:null};
   const ready={status:'blocked',count:0,managedCompute:true,threadId,managedTools:{status:'ready',count:3}};
   const f=window.managedToolFixture={calls:[],compute:0,errors:[],sendStatus(params){
    window.__test.events.forEach(fn=>fn({provider,method:'studio/toolsStatus',params:{...ready,...params}}));
   }};
   window.studio.invoke=async(method,data)=>{
    f.calls.push({method,data});
    if(method==='agent.connect')return {tools:ready};
    if(method==='agent.tools')return ready;
    if(method==='agent.account')return {credentialStored:true};
    if(method==='conversation.remember')return conversation;
    if(method==='conversation.list')return [conversation];
    if(method==='agent.rpc'){
     if(data.method==='model/list')return {data:[{id:'fixture-model',model:'fixture-model',isDefault:true}]};
     if(['thread/read','thread/resume'].includes(data.method))return {thread:{id:threadId,turns:[]},model:'fixture-model'};
    }
    return original(method,data);
   };
   return window.renderTest('Agent',{planningMode:false,onPlanningModeChange(){},context:'{}',computeConnected:false,
    onConnectCompute:()=>{f.compute++;},onError:error=>f.errors.push(String(error)),sessionSelection:{nonce:'fixture-restore',conversation}});
  });
  await page.getByTestId('agent-options-summary').getByText(/fixture-model/).waitFor();
  await page.getByTestId('agent-options').click();
  const status=page.getByTestId('agent-tools-status');
  await status.getByText('托管计算工具通道已连接',{exact:true}).waitFor();
  assert.equal(await status.getAttribute('data-status'),'ready');
  assert.equal(await page.getByTestId('agent-tool-repair').count(),0);
  assert.equal(await page.getByTestId('agent-workflow-tools-status').count(),0);
  await page.screenshot({path:path.join(out,'managed-tools-restored-ready.png')});

  // A status for another chat must not replace the displayed one.
  const incomplete={status:'blocked',count:2,message:'当前对话的托管计算工具清单不完整。'};
  await page.evaluate(managedTools=>window.managedToolFixture.sendStatus({threadId:'foreign-chat',managedTools}),incomplete);
  assert.equal(await status.getAttribute('data-status'),'ready');
  await page.evaluate(managedTools=>window.managedToolFixture.sendStatus({managedTools}),incomplete);
  const repair=page.getByTestId('agent-managed-tools-repair');
  await repair.waitFor();
  assert.equal(await repair.innerText(),'修复工具连接');
  await page.screenshot({path:path.join(out,'managed-tools-incomplete.png')});
  await page.locator('.composer textarea').fill('继续查询同一个资源。');
  await repair.click();
  await status.getByText('托管计算工具通道已连接',{exact:true}).waitFor();
  assert.equal(await page.locator('.composer textarea').inputValue(),'继续查询同一个资源。');
  const {calls,compute,errors}=await page.evaluate(()=>window.managedToolFixture);
  assert.equal(compute,0);assert.deepEqual(errors,[]);
  assert.deepEqual(calls.filter(call=>call.method==='agent.connect').at(-1).data,
   {provider:'deepseek',threadId:'isolated-managed-tool-chat',repairTools:'managed'});
  assert(!calls.some(call=>call.method==='worker.connect'||call.method==='agent.rpc'&&call.data.method==='turn/start'));
 });
}
