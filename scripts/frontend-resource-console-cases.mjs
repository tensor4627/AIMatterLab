import assert from 'node:assert/strict';

async function mount(page,{theme='dark',language='zh-CN'}={}) {
  await page.evaluate(({theme,language})=>{
    localStorage.setItem('studio.agent','false');
    localStorage.setItem('studio.sidebarVisible','true');
    const f=window.__test,now=Date.now();
    Object.assign(f.settings,{theme,language});
    const status=value=>({status:value,checkedAt:now});
    const session=(provider,name,leaseId,value='assigned',serviceOnly=false)=>({provider,threadId:provider+'-thread',
      conversationId:provider+':'+provider+'-thread',conversationName:name,leaseId,
      source:serviceOnly?'wsl':'managed',serviceOnly,sessionId:serviceOnly?null:'terminal-'+leaseId,
      checkedAt:now,status:value,projectId:provider==='codex'?'fixture-project':null,projectName:provider==='codex'?'材料项目':null,busy:false});
    const shell=(sessionId,connectionId)=>({sessionId,id:sessionId,connectionId,mode:'interactive',kind:'ssh',owner:'human',ownerEpoch:1,
      alive:true,outputWait:false,expired:false,serviceActive:false,sequence:0,resource:{kind:'ssh-connection',connectionId,profileId:'profile-b',profileVersion:7}});
    const humanA=shell('human-a','connection-b'),humanB=shell('human-b','connection-b');
    const localTerminal={sessionId:'plain-human',id:'plain-human',mode:'interactive',kind:'local',owner:'human',ownerEpoch:1,alive:true,expired:false};
    const base={current:true,mode:'interactive',capacity:null,terminals:[],channels:[],projectPolicies:[],managedId:null};
    const a={...base,key:'connection-a',name:'材料中心',kind:'ssh',profileId:'profile-a',profileVersion:2,connectionId:'connection-a',target:'materials.invalid:22',
      master:status('online'),canDisconnect:true,service:{kind:'private',...status('online')},managedId:'ssh:profile-a',
      capacity:{total:4,occupied:2},channels:[session('codex','材料结构分析','lease-a'),session('kimi','相变数据核验','lease-k','releasing')]};
    const b={...base,key:'connection-b',name:'图形中心',kind:'ssh',profileId:'profile-b',profileVersion:7,connectionId:'connection-b',target:'graphics.invalid:2200',
      master:status('online'),canDisconnect:true,service:{kind:'private',...status('unconfigured')},managedId:null,
      capacity:{total:4,occupied:1},terminals:[humanA,humanB].map(shell=>({sessionId:shell.id,kind:'ssh',mode:'interactive',owner:'human',...status('online')})),
      channels:[session('deepseek','GPU 队列筛选','lease-b','preparing')]};
    const local={...base,key:'wsl:profile-local:3',name:'本地 WSL',kind:'wsl',profileId:'profile-local',profileVersion:3,connectionId:null,target:'Fixture WSL · :8790',
      master:null,service:{kind:'wsl',...status('online')},managedId:'wsl:profile-local',localGeneration:'wsl-generation',foregroundEpoch:null,
      channels:[session('qwen','局部构型复核','lease-local','assigned',true)]};
    f.consoleSnapshot={checkedAt:now,observation:'complete',resources:[a,b,local],standalone:[],projects:[{id:'fixture-project',name:'材料项目'}]};
    f.consoleCalls=[];
    const conversations=[...a.channels,...b.channels,...local.channels].map(row=>({id:row.conversationId,provider:row.provider,threadId:row.threadId,name:row.conversationName,updatedAt:now,taskId:null,projectId:null}));
    const profileList=[a,b].map(row=>({id:row.profileId,version:row.profileVersion,kind:'ssh',name:row.name,host:row.target.split(':')[0],port:22,
      username:'fixture',ssh_client:'/usr/bin/ssh',mode:'interactive'}));
    const standard=window.studio.invoke;
    window.studio.invoke=async(method,data)=>{
      f.consoleCalls.push({method,data});
      if (method==='compute.console.snapshot'||method==='compute.console.refresh') return structuredClone(f.consoleSnapshot);
      if (method==='compute.managed.snapshot') return {resources:[],conversations:[],sources:[]};
      if (method==='conversation.list') return structuredClone(conversations);
      if (method==='conversation.select') return structuredClone(conversations.find(row=>row.id===data.id));
      if (method==='worker.restore') return {status:'disconnected',checkedAt:now,...data};
      if (method==='compute.profiles.list') return {profiles:profileList,defaults:{distribution:'Fixture WSL',root:'/fixture',port:8790,ssh_client:'/usr/bin/ssh'}};
      if (method==='compute.resource.status') return {schemaVersion:2,selectionId:null,kind:null,status:'none'};
      if (method==='compute.sshConnection.list') return {connections:[a,b].filter(row=>row.connectionId).map(row=>({schemaVersion:2,connectionId:row.connectionId,profileId:row.profileId,
        profileVersion:row.profileVersion,authentication:'verified',status:'authenticated',capabilities:{multiplex:true},terminalSessionIds:row.terminals.map(shell=>shell.sessionId),serviceIds:[],revision:1}))};
      if (method==='compute.sshService.status') return {schemaVersion:2,connectionId:data.connectionId,profileId:'profile-b',profileVersion:7,status:'idle',workflowReady:false,serviceActive:false,operator:'human',revision:1};
      if (method==='sharedTerminal.list') return {sessions:[humanA,{...humanB,...f.humanBOverride},...f.plainTerminal?[{...localTerminal,...f.plainTerminal}]:[]]};
      if (method==='sharedTerminal.read') {
        if (data.sessionId!=='human-b') throw Error('Native fixture refused a different terminal');
        return {...humanB,output:data.cursor?'':'original-fixture-terminal\r\n',cursor:1,dropped:false};
      }
      if (method==='sharedTerminal.resize') return {accepted:true};
      if (method==='compute.resourceWorkspace.preview'||method==='compute.resourceWorkspace.confirm') {
        if (data.profileId!==b.profileId||data.profileVersion!==b.profileVersion||data.connectionId!==b.connectionId) throw Error('Unexpected workspace target');
        const root='/fixture/workbench';
        const preview={schemaVersion:2,profileId:b.profileId,profileVersion:b.profileVersion,connectionId:b.connectionId,resourceName:b.name,
          root,account:'fixture',hostname:'graphics',directories:[root+'/workfile',root+'/software']};
        if (method==='compute.resourceWorkspace.preview') return {...preview,status:'confirmation_required',confirmationId:'fixture-handoff'};
        if (data.confirmationId!=='fixture-handoff') throw Error('Unexpected workspace confirmation');
        f.workspaceConfirmed=true;
        return {...preview,status:'confirmed'};
      }
      if (method==='compute.console.release') {
        const row=f.consoleSnapshot.resources.find(row=>row.kind+':'+row.profileId===data.resourceId&&row.connectionId===data.connectionId);
        const exact=row?.channels.find(channel=>channel.leaseId===data.leaseId&&channel.provider===data.provider&&channel.threadId===data.threadId&&channel.source===data.source);
        if (!exact) throw Error('Native fixture refused a different allocation');
        row.channels=row.channels.filter(channel=>channel!==exact);
        return {status:'released'};
      }
      if (method==='compute.console.disconnectSsh') {
        if(data.connectionId!=='connection-b'||data.profileId!=='profile-b'||data.profileVersion!==7)throw Error('Native fixture refused a different master');
        b.key='ssh:profile-b:7';b.connectionId=null;b.master=status('offline');b.service={kind:'private',...status('unknown')};b.channels=[];b.terminals=[];b.canDisconnect=false;
        return {status:'disconnected'};
      }
      if (method==='compute.console.detachLocal') {
        if(data.profileId!=='profile-local'||data.profileVersion!==3||data.generation!=='wsl-generation'||data.foregroundEpoch!==null)throw Error('Native fixture refused a different local worker');
        local.localGeneration=null;local.channels=[];local.service={kind:'wsl',...status('offline')};
        return {status:'disconnected'};
      }
      if (method==='compute.console.attachLocal') {
        if(data.profileId!=='profile-local'||data.profileVersion!==3)throw Error('Native fixture refused a different local worker');
        local.localGeneration='wsl-generation';local.service={kind:'wsl',...status('online')};
        return {status:'attached'};
      }
      if (method==='compute.managed.publish'||method==='compute.managed.configureService') {
        if(data.connectionId!=='connection-b'||data.profileId!=='profile-b'||data.profileVersion!==7)throw Error('Native fixture refused a different SSH host');
        if(!f.workspaceConfirmed)throw Error('Native fixture requires a confirmed workspace');
        b.managedId='ssh:profile-b';
        if(method==='compute.managed.configureService')b.service={kind:'private',...status('online')};
        f.events.forEach(listener=>listener({method:'studio/managedActivity'}));
        return {kind:'ssh',resourceId:b.managedId,name:b.name,...data};
      }
      if (method==='compute.console.projectAccess') {
        if (data.connectionId!=='connection-a'||data.profileId!=='profile-a'||data.profileVersion!==2||data.projectId!=='fixture-project') throw Error('Native fixture refused a different grant');
        a.projectPolicies=[{projectId:data.projectId,allowed:data.allowed}];
        return {allowed:data.allowed};
      }
      return standard(method,data);
    };
    window.renderTest('App');
  },{theme,language});
}

export async function frontendResourceConsoleCases({check}) {
  await check('hosted-ssh-verification-pending',async page=>{
    await mount(page);
    await page.evaluate(()=>{
      const original=window.studio.invoke;
      window.__test.verificationPending=true;
      window.studio.invoke=(method,data)=>{
        if(method==='compute.managed.snapshot'){
          const verificationPending=window.__test.verificationPending;
          return Promise.resolve({resources:[{kind:'ssh',resourceId:'ssh:fixture',profileId:'fixture',profileVersion:1,connectionId:'connection-fixture',
            name:'Fixture SSH',serviceStatus:'ready',serviceReady:!verificationPending,verificationPending}],conversations:[],sources:[]});
        }
        return original(method,data);
      };
      window.dispatchEvent(new Event('focus'));
    });
    const footer=page.getByTestId('current-compute-resource-status');
    await footer.getByText(/Fixture SSH.*作业服务 待核对/).waitFor();
    assert.equal(await footer.locator('i.online').count(),0);
    await page.locator('nav [data-testid="navigate-compute-resources"]:visible').click();
    await page.getByTestId('compute-resource-console').waitFor();
    await page.evaluate(()=>{
      window.__test.verificationPending=false;
      window.dispatchEvent(new Event('focus'));
    });
    await footer.getByText(/Fixture SSH.*作业服务 可用/).waitFor();
    assert.equal(await footer.locator('i.online').count(),1);
  });
  await check('resource-console-desktop',async(page,capture)=>{
    await mount(page);
    const console=page.getByTestId('compute-resource-console');
    const detail=page.getByTestId('compute-console-detail');
    await page.locator('nav [data-testid="navigate-compute-resources"]:visible').click();
    await detail.getByRole('heading',{name:'材料中心',exact:true}).waitFor();
    assert.match(await detail.innerText(),/SSH 认证主连接[\s\S]*私有作业服务[\s\S]*托管 Shell 容量 2\/4/);
    assert.match(await detail.innerText(),/材料结构分析[\s\S]*Codex · 材料项目[\s\S]*已分配/);
    assert.match(await detail.innerText(),/相变数据核验[\s\S]*Kimi · 未绑定项目[\s\S]*释放中/);
    assert.equal(await page.locator('.agent-panel:visible').count(),0);
    await capture('compute-resource-console-dark');

    const serviceLease=detail.locator('li').filter({hasText:'相变数据核验'});
    await page.waitForFunction(()=>!document.querySelector('[data-testid="compute-console-refresh"]')?.disabled);
    const showServiceWithTerminal=terminalStatus=>page.evaluate(status=>{
      const f=window.__test,resource=f.consoleSnapshot.resources[0];
      const allocation=resource.channels.find(channel=>channel.leaseId==='lease-k');
      f.originalServiceVerification??=structuredClone(allocation);
      if(status==='restore')Object.assign(allocation,f.originalServiceVerification,{serviceContext:false,terminalStatus:null});
      else Object.assign(allocation,{status:'assigned',serviceOnly:true,serviceContext:true,sessionId:null,terminalStatus:status});
      f.events.forEach(listener=>listener({method:'studio/managedActivity'}));
    },terminalStatus);
    await showServiceWithTerminal('preparing');
    await serviceLease.getByText('托管 Shell · 准备中',{exact:true}).waitFor();
    assert.match(await serviceLease.locator('.compute-console-channel-type').innerText(),/^服务上下文\s+托管 Shell · 准备中$/);
    await serviceLease.getByText('已分配',{exact:true}).waitFor();
    await showServiceWithTerminal('lost');
    await serviceLease.getByText('托管 Shell · 失联',{exact:true}).waitFor();
    await serviceLease.getByText('已分配',{exact:true}).waitFor();
    assert.doesNotMatch(await serviceLease.innerText(),/terminal-lease-k/);
    await capture('compute-resource-console-service-with-lost-shell');
    await serviceLease.getByRole('button',{name:'释放',exact:true}).click();
    const serviceConfirmation=page.getByRole('dialog',{name:'释放会话通道'});
    await serviceConfirmation.getByText('此操作解除该会话的服务分配并关闭它的专属 Shell。已提交作业继续运行。',{exact:true}).waitFor();
    await capture('compute-resource-console-release-service-and-shell');
    await serviceConfirmation.getByRole('button',{name:'取消',exact:true}).click();
    await showServiceWithTerminal(null);
    await serviceLease.getByText('托管 Shell · 失联',{exact:true}).waitFor({state:'hidden'});
    await serviceLease.getByRole('button',{name:'释放',exact:true}).click();
    await serviceConfirmation.getByText('此操作解除该会话的服务分配。已提交作业继续运行。',{exact:true}).waitFor();
    await serviceConfirmation.getByRole('button',{name:'取消',exact:true}).click();
    await showServiceWithTerminal('restore');
    await serviceLease.getByText('释放中',{exact:true}).waitFor();

    await detail.getByText('项目的 SSH 终端授权',{exact:true}).click();
    await detail.getByRole('combobox',{name:'计算项目'}).selectOption('fixture-project');
    await detail.getByRole('button',{name:'禁止终端',exact:true}).click();
    await detail.getByText('项目已明确禁止',{exact:true}).waitFor();
    await detail.getByRole('button',{name:'允许终端',exact:true}).click();
    await detail.getByText('项目已明确允许',{exact:true}).waitFor();

    const original=detail.locator('li').filter({hasText:'材料结构分析'});
    await original.getByRole('button',{name:'释放',exact:true}).click();
    const confirm=page.getByRole('dialog',{name:'释放会话通道'});
    await confirm.getByText('材料中心 · connection-a / 材料结构分析',{exact:true}).waitFor();
    await confirm.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(await original.count(),1);
    await original.getByRole('button',{name:'释放',exact:true}).click();
    await page.getByTestId('compute-console-confirm').click();
    await original.waitFor({state:'hidden'});
    assert.equal(await detail.getByText('相变数据核验',{exact:true}).count(),1);

    await console.locator('[data-resource-key="wsl:profile-local:3"]').click();
    await detail.getByText('本地 WSL 作业服务',{exact:true}).waitFor();
    await detail.getByText('服务上下文',{exact:true}).waitFor();
    assert.doesNotMatch(await detail.innerText(),/SSH 认证主连接|托管 Shell 容量/);
    await detail.getByRole('button',{name:'断开服务连接',exact:true}).click();
    await page.getByTestId('compute-console-confirm').click();
    await detail.getByText('未连接',{exact:true}).waitFor();
    await detail.getByRole('button',{name:'连接现有服务',exact:true}).click();
    await detail.getByText('在线',{exact:true}).waitFor();
    await console.locator('[data-resource-key="connection-b"]').click();
    await detail.getByText('未配置',{exact:true}).waitFor();
    await capture('compute-resource-console-human-terminals');
    await detail.getByRole('button',{name:'交给工作台管理',exact:true}).click();
    await page.getByTestId('resource-workspace-confirm').click();
    await detail.getByText('工作台托管中',{exact:true}).waitFor();
    await detail.getByRole('button',{name:'准备作业服务',exact:true}).click();
    await detail.getByText('在线',{exact:true}).nth(3).waitFor();

    const absentTerminal=page.getByText('原终端当前不可用，请核对连接。',{exact:true});
    const openHumanB=detail.locator('li').filter({hasText:'human-b'}).getByRole('button',{name:'打开原终端',exact:true});
    const terminalMethods=['compute.sshConnection.open','compute.sshConnection.authRead','compute.sshConnection.openShell','sharedTerminal.open','sharedTerminal.read','compute.resource.activate'];
    const terminalCalls=()=>page.evaluate(methods=>window.__test.consoleCalls.filter(row=>methods.includes(row.method)),terminalMethods);
    await page.evaluate(()=>{window.__test.humanBOverride={owner:'agent',ownerEpoch:2};});
    await openHumanB.click();
    await absentTerminal.waitFor();
    assert.deepEqual(await terminalCalls(),[]);
    await capture('compute-resource-console-stale-terminal');

    await page.evaluate(()=>{
      const f=window.__test;
      f.plainTerminal={alive:false};
      f.consoleSnapshot.standalone=[{sessionId:'plain-human',mode:'interactive',kind:'local',owner:'human',status:'online',checkedAt:Date.now()}];
      f.events.forEach(listener=>listener({method:'studio/managedActivity'}));
    });
    await console.locator('.compute-console-standalone').getByRole('button',{name:'打开原终端',exact:true}).click();
    await absentTerminal.waitFor();
    assert.deepEqual(await terminalCalls(),[]);

    await page.evaluate(()=>{window.__test.humanBOverride=undefined;});
    await openHumanB.click();
    await page.waitForFunction(()=>window.__test.consoleCalls.some(row=>row.method==='sharedTerminal.read'&&row.data.sessionId==='human-b'));
    const opened=await terminalCalls();
    assert.ok(opened.length>0);
    assert.ok(opened.every(row=>row.method==='sharedTerminal.read'&&row.data.sessionId==='human-b'));

    await detail.getByRole('button',{name:'断开主连接',exact:true}).click();
    await page.getByTestId('compute-console-confirm').click();
    await detail.getByText('未连接',{exact:true}).waitFor();
    assert.equal(await console.locator('[data-resource-key="ssh:profile-b:7"]').getAttribute('aria-current'),'true');
    await detail.getByRole('heading',{name:'图形中心',exact:true}).waitFor();
    await console.locator('[data-resource-key="connection-a"]').click();
    await detail.getByText('在线',{exact:true}).first().waitFor();

    await console.getByRole('button',{name:'添加或配置连接',exact:true}).click();
    await page.getByTestId('open-compute-resource-console').click();
    await console.getByRole('heading',{name:'计算资源',exact:true}).waitFor();
    await page.locator('nav:visible').getByRole('button',{name:'设置',exact:true}).click();
    await page.getByRole('dialog',{name:'工作台设置'}).getByRole('button',{name:'计算连接',exact:true}).click();
    await page.getByTestId('settings-connect-resources').click();
    await page.getByRole('dialog',{name:'工作台设置'}).waitFor({state:'hidden'});
    await console.getByRole('heading',{name:'计算资源',exact:true}).waitFor();
    await detail.locator('li').filter({hasText:'相变数据核验'}).getByRole('button',{name:'打开会话',exact:true}).click();
    await page.waitForFunction(()=>window.__test.consoleCalls.some(row=>row.method==='conversation.select'&&row.data.id==='kimi:kimi-thread'));
    const writes=await page.evaluate(()=>window.__test.consoleCalls.filter(row=>['compute.console.release','compute.console.disconnectSsh','compute.console.projectAccess','compute.console.attachLocal','compute.console.detachLocal','compute.managed.publish','compute.managed.configureService','conversation.select'].includes(row.method)));
    assert.deepEqual(writes,[
      {method:'compute.console.projectAccess',data:{profileId:'profile-a',profileVersion:2,connectionId:'connection-a',projectId:'fixture-project',allowed:false}},
      {method:'compute.console.projectAccess',data:{profileId:'profile-a',profileVersion:2,connectionId:'connection-a',projectId:'fixture-project',allowed:true}},
      {method:'compute.console.release',data:{resourceId:'ssh:profile-a',connectionId:'connection-a',source:'managed',leaseId:'lease-a',provider:'codex',threadId:'codex-thread'}},
      {method:'compute.console.detachLocal',data:{profileId:'profile-local',profileVersion:3,generation:'wsl-generation',foregroundEpoch:null}},
      {method:'compute.console.attachLocal',data:{profileId:'profile-local',profileVersion:3}},
      {method:'compute.managed.publish',data:{profileId:'profile-b',profileVersion:7,connectionId:'connection-b'}},
      {method:'compute.managed.configureService',data:{profileId:'profile-b',profileVersion:7,connectionId:'connection-b'}},
      {method:'compute.console.disconnectSsh',data:{profileId:'profile-b',profileVersion:7,connectionId:'connection-b'}},
      {method:'conversation.select',data:{id:'kimi:kimi-thread'}}
    ]);
  });

  await check('resource-console-compact',async(page,capture)=>{
    await mount(page,{theme:'light',language:'en'});
    const console=page.getByTestId('compute-resource-console');
    await page.locator('.navigation-rail:visible').getByRole('button',{name:'Compute resources',exact:true}).click();
    await console.getByRole('heading',{name:'Compute resources',exact:true}).waitFor();
    await console.getByText('Managed shell capacity',{exact:false}).waitFor();
    assert.equal(await console.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);
    await page.mouse.move(700,20);
    await capture('compute-resource-console-light-compact');
    await page.evaluate(()=>{
      const f=window.__test;
      f.consoleSnapshot.observation='partial';
      const a=f.consoleSnapshot.resources[0];a.master.status='lost';a.service.status='lost';a.capacity=null;a.channels[0].status='lost';
    });
    await console.getByTestId('compute-console-refresh').click();
    await console.getByText('Some terminal states could not be verified.',{exact:true}).waitFor();
    const detail=page.getByTestId('compute-console-detail');
    assert.equal(await console.locator('[data-resource-key="connection-a"]').getAttribute('aria-current'),'true');
    await detail.getByRole('heading',{name:'材料中心',exact:true}).waitFor();
    assert.equal(await detail.getByText('Online',{exact:true}).count(),0);
    assert.equal(await detail.getByText('Connection lost',{exact:true}).count(),3);
    await page.mouse.move(700,20);
    await capture('compute-resource-console-refresh-retained');
  },{width:760,height:850});
}
