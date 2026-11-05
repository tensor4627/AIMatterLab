// Explicit Linux integration runner; intentionally excluded from automatic node --test discovery.
// Starts only an owned loopback worker with a new Store and the fixed CPU engineering reference.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync, spawn} from 'node:child_process';
import {Catalog} from "../backend/main/workspace/catalog.mjs";
import {createToolPackageRegistry} from '../backend/main/tools/package-registry.mjs';
import {createToolConfigurationController} from '../backend/main/compute/tool-configurations.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const write = (file, value) => {fs.mkdirSync(path.dirname(file), {recursive:true});fs.writeFileSync(file, value);};
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const scope = 'Actual Node registry/controller to Python HTTP/Service/fixed child process; engineering only. No native UI, model, cluster or scientific validation.';

function fixture(root, repositoryRoot) {
  const packageRoot = path.join(root, 'author', 'worker-reference-package');
  const repo = path.join(packageRoot, 'repo'), template = path.join(root, 'empty-git-template');
  fs.mkdirSync(repo, {recursive:true});fs.mkdirSync(template);
  const code = fs.readFileSync(path.join(repositoryRoot, 'installation/examples/worker-smoke.py'));
  write(path.join(repo, 'run.py'), code);
  const env = {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:'/dev/null', GIT_TERMINAL_PROMPT:'0'};
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', repo, ...args], {env, encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim();
  git(['init', '--quiet', '--template='+template]);git(['add', 'run.py']);
  git(['-c', 'user.name=Engineering fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '--no-gpg-sign', '-m', 'Fixed engineering reference']);
  for (const name of ['manual.md', 'setup/install.md', 'setup/configure.md', 'worker-reference-tests/README.md', 'worker-reference-tests/process/README.md']) write(path.join(packageRoot, name), '# CPU engineering reference\n\nRun only the shipped worker lifecycle case; no scientific claim.\n');
  write(path.join(packageRoot, 'SKILL.md'), '---\nname: worker-reference\ndescription: Operate the fixed CPU worker infrastructure reference and inspect actual receipts.\n---\nUse explicit project authorization and real process evidence. Scientific validation is not provided.\n');
  write(path.join(packageRoot, 'worker-reference-tests/process/run.py'), code);
  const manifest = {
    schema_version:1, id:'worker-reference', name:'CPU worker infrastructure reference',
    repository:{path:'repo', commit:git(['rev-parse','HEAD'])}, manual:'manual.md',
    guidance:{delivery:'SKILL.md', installation:['setup/install.md'], configuration:['setup/configure.md']},
    environment:{hardware:'cpu', requirements:['Python 3.10+ standard library'], parallelism:{supported:['serial']}},
    functions:[{id:'process', name:'Process lifecycle', description:'Engineering-only fixed child process', engine:'installation.check', entrypoint:'repo/run.py', inputs:[],
      outputs:[{id:'result',type:'file',format:'json',description:'Real lifecycle receipt',required:true,display:{priority:100,advanced:false,reason:'Actual output'}}],
      operation:{command:['{python}','{entrypoint}'], failure_handling:'Inspect original run; never retry unknown automatically'}, tests:['process-smoke']}],
    tests:{directory:'worker-reference-tests', introduction:'worker-reference-tests/README.md', cases:[{id:'process-smoke',function_id:'process',directory:'worker-reference-tests/process',instructions:'worker-reference-tests/process/README.md',entrypoint:'worker-reference-tests/process/run.py',resources:[],expected_outputs:[{path:'smoke-result.json',format:'json',description:'Actual child-process report'}],pass_criteria:['Worker independently verifies exit, child PID, marker and fixed JSON']}]}
  };
  write(path.join(packageRoot, 'tool.json'), JSON.stringify(manifest, null, 2)+'\n');
  return packageRoot;
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const {port} = server.address();await new Promise((resolve,reject) => server.close(error=>error?reject(error):resolve()));
  return port;
}

/** Must be invoked explicitly in an isolated ignored evidence directory. Never reuses a worker root. */
export async function runToolConfigurationIntegration({repositoryRoot, evidenceRoot, python='/usr/bin/python3'}) {
  assert.equal(process.platform, 'linux', 'This integration requires Linux process identity');
  repositoryRoot=fs.realpathSync(repositoryRoot);evidenceRoot=path.resolve(evidenceRoot);
  const allowed=path.join(repositoryRoot,'.studio'),relative=path.relative(allowed,evidenceRoot);
  assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Evidence must be inside ignored repository .studio');
  fs.mkdirSync(evidenceRoot,{recursive:true});
  assert.equal(fs.realpathSync(evidenceRoot),evidenceRoot,'Linked evidence roots are forbidden');
  assert(path.isAbsolute(python)&&fs.statSync(python).isFile(),'Use an explicit existing system interpreter');
  const root=fs.mkdtempSync(path.join(evidenceRoot,'wire-')),runId=randomUUID(),stateRoot=path.join(root,'backend','worker');
  write(path.join(root,'integration-root.json'),JSON.stringify({schema_version:1,kind:'tool-configuration-integration',run_id:runId,scope},null,2));
  const trace=[],checks=[],catalogs=[];let child,tokens,stage='setup',port,worker,started=false,terminal=false;
  const report={schema_version:1,scope,status:'running',root,run_id:runId,node:process.version,python,checks,trace};
  const check=(name,details={})=>checks.push({name,...details,status:'passed'});
  const safe=value=>{let text=String(value);for(const token of Object.values(tokens||{}))text=text.replaceAll(token,'[redacted]');return text;};
  const catalogAt=name=>{const catalog=new Catalog(path.join(root,name));catalogs.push(catalog);return catalog;};
  async function http(method,route,data,{credential='admin',status=200}={}) {
    assert(/^\/(api\/[a-z0-9\/-]+|mcp)$/.test(route),'Only fixed local worker routes');
    const headers={'Content-Type':'application/json'};if(credential)headers.Authorization='Bearer '+tokens[credential];
    const response=await fetch(`http://127.0.0.1:${port}${route}`,{method,headers,...method==='POST'?{body:JSON.stringify(data)}:{},signal:AbortSignal.timeout(10000)});
    const value=await response.json();trace.push({stage,method,route,status:response.status});
    if(response.status!==status)throw Error(`${method} ${route} expected ${status}, received ${response.status}: ${safe(JSON.stringify(value))}`);
    return value;
  }
  try {
    const packageRoot=fixture(root,repositoryRoot),catalog=catalogAt('desktop');
    const packages=createToolPackageRegistry({catalog,storeRoot:path.join(root,'package-store')});
    stage='register-definition';const registered=packages.register({package_root:packageRoot});
    assert.equal(registered.scope,'definition_checked');assert.equal(registered.tests.status,'not_run');
    check('Actual Git package registered and immutable snapshot created',{package_id:registered.package_id,package_version:registered.package_version,source_commit:registered.source_commit});
    report.package={id:registered.package_id,version:registered.package_version,snapshot_root:registered.snapshot_root};
    port=await unusedPort();const log=fs.openSync(path.join(root,'server.log'),'a');
    child=spawn(python,['-B','-m','studio_worker.server','--root',stateRoot,'--port',String(port)],{cwd:repositoryRoot,env:{...process.env,PYTHONPATH:path.join(repositoryRoot,'backend','worker'),PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore',log,log]});
    fs.closeSync(log);let spawnError;child.once('error',error=>{spawnError=error;});
    report.server_pid=child.pid;report.port=port;
    stage='worker-start';let health;const deadline=Date.now()+15000;
    while(Date.now()<deadline) {
      if(spawnError)throw spawnError;if(child.exitCode!==null)throw Error('Owned worker exited before health');
      try {tokens=json(path.join(stateRoot,'connection.json'));health=await http('GET','/api/health');break;}catch {await delay(100);}
    }
    assert(health,'Owned worker did not become healthy');assert.equal(health.root,stateRoot);assert.equal(health.tool_configuration_schema,1);
    check('Actual loopback worker health and fresh empty Store');
    assert.deepEqual(await http('GET','/api/projects'),[]);assert.deepEqual(await http('GET','/api/environments'),[]);assert.deepEqual(await http('GET','/api/runs'),[]);
    worker={identity:{distribution:'Ubuntu',root:health.root},connectionTarget:{port},connectionEpoch:1,connection:{health},request:(method,route,data)=>http(method,route,data)};
    const settings={distribution:'Ubuntu',workerRoot:health.root,workerPort:port,agentProvider:'codex'};
    let confirmationAllowed=false,confirmCalls=0;
    const confirm=async(plan,event)=>{confirmCalls++;assert.equal(event?.integration_request_id,runId);assert.equal(plan.status,'planned');assert.equal(plan.package_version,registered.package_version);return confirmationAllowed;};
    const options={catalog,packages,worker,getSettings:()=>settings,current:()=>null,currentTarget:()=>null,assertIdle:()=>{},confirm,toWorkerPath:value=>value};
    const controller=createToolConfigurationController(options);
    assert.equal(controller.context({}).hasConversation,false);
    const environment=await http('POST','/api/environments',{id:'c17-system-python',name:'Explicit existing system Python; engineering reference only',executables:{python}});
    stage='explicit-project';const project=await controller.createProject({environment_id:environment.id,name:'C17 explicit fresh engineering project',request_id:'project-'+runId});
    assert.deepEqual(project.policy.engines,['installation.check']);assert.deepEqual(project.policy.environments,[environment.id]);assert.deepEqual(project.policy.input_roots,[path.join(stateRoot,'projects',project.id,'inputs')]);
    const originalProjects=await http('GET','/api/projects');assert.equal(originalProjects.length,1);
    assert(trace.some(item=>item.method==='POST'&&item.route==='/api/tool-configuration/project/create'&&item.status===200));assert(!trace.some(item=>item.method==='POST'&&item.route==='/api/projects'));
    check('Explicit controller createProject grants only new engineering project',{project_id:project.id,environment_id:environment.id});
    stage='plan';const plan=await controller.plan({package_id:registered.package_id,package_version:registered.package_version,project_id:project.id,environment_id:environment.id,request_id:'configure-'+runId});
    assert.equal(plan.status,'planned');assert.equal(plan.scientific_status,'not_run');assert(plan.tests.every(test=>test.status==='not_run'&&typeof test.reason==='string'&&test.reason));assert.equal(fs.existsSync(plan.installed_prefix),false);assert.deepEqual(await http('GET','/api/runs'),[]);
    report.configuration_id=plan.configuration_id;check('Real worker independently registers snapshot and plans without install or execution');
    const mutation=value=>({configuration_id:value.configuration_id,expected_revision:value.revision,plan_sha256:value.plan_sha256});
    stage='confirmation-declined';const declined=await controller.execute(mutation(plan),{integration_request_id:runId});
    assert.equal(declined.cancelled,true);assert.deepEqual(await http('GET','/api/runs'),[]);assert.equal(fs.existsSync(plan.installed_prefix),false);
    check('Actual controller confirmation callback decline prevents execution');
    stage='confirm-execute';confirmationAllowed=true;let result=await controller.execute(mutation(plan),{integration_request_id:runId});started=true;
    assert.equal(confirmCalls,2);const completion=Date.now()+40000;
    while(result.status==='testing'&&Date.now()<completion){await delay(100);result=await controller.status({configuration_id:plan.configuration_id});}
    assert.equal(result.status,'tested',JSON.stringify(result));terminal=true;
    assert.equal(result.install.status,'passed');assert.equal(result.install.method,'private-copy-sha256');assert(result.tests.length&&result.tests.every(test=>test.status==='passed'&&test.run_id&&test.reason===null));
    check('Confirmed real private installation and fixed subprocess functional tests passed',{tests:result.tests.map(({id,function_id,run_id,status,reason})=>({id,function_id,run_id,status,reason}))});
    const runs=await http('GET','/api/runs');assert.equal(runs.length,1);const run=runs[0];
    assert.equal(run.id,result.tests[0].run_id);assert.equal(run.status,'succeeded');assert.equal(run.engine,'installation.check');assert.equal(run.project_id,project.id);assert.equal(run.environment_id,environment.id);
    assert(path.relative(stateRoot,run.directory)&&!path.relative(stateRoot,run.directory).startsWith('..'));
    const output=json(path.join(run.directory,'results','smoke-result.json')),exit=json(path.join(run.directory,'exit.json')),processReceipt=json(path.join(run.directory,'child.json'));
    assert.equal(output.status,'passed');assert.equal(output.scope,'infrastructure only');assert.equal(output.case,'worker');assert.equal(output.pid,processReceipt.pid);assert(output.pid>0);assert.equal(exit.exit_code,0);assert.equal(exit.cancelled,false);assert.equal(exit.reason,null);assert.deepEqual(exit,run.exit);
    assert(fs.readFileSync(path.join(run.directory,'console.log'),'utf8').split(/\r?\n/).includes('STUDIO_WORKER_SMOKE_OK'));
    report.run={id:run.id,status:run.status,exit_code:exit.exit_code,child_pid:processReceipt.pid,output_sha256:sha(fs.readFileSync(path.join(run.directory,'results','smoke-result.json')))};
    check('Independent real run, exit, child PID, output and console receipts agree',report.run);
    stage='activate-read';const activated=await controller.activate(mutation(result));assert.equal(activated.status,'active');
    const read=await controller.read({configuration_id:plan.configuration_id});assert.equal(read.status,'active');assert.equal(sha(read.execution_skill.body),read.execution_skill.sha256);assert.equal(read.execution_skill.facts.scientific_status,'not_run');assert(read.execution_skill.facts.tests.every(test=>test.reason===null));assert.equal(read.package_version,registered.package_version);assert.equal(read.source_commit,registered.source_commit);
    check('Worker-authoritative activation and trusted body snapshot read',{skill_id:read.execution_skill.id,sha256:read.execution_skill.sha256});
    stage='body-only-normal-operation';
    const bodyFacts=JSON.parse(read.execution_skill.body.split('```json\n')[1].split('\n```')[0]);assert.deepEqual(bodyFacts,read.execution_skill.facts);
    const recipe=bodyFacts.functions[0],criteria=bodyFacts.reference_criteria;
    assert.equal(recipe.input_files[0].name,'run.py');assert.equal(recipe.output_files[0].name,'smoke-result.json');assert.equal(recipe.output_files[0].format,'json');assert.equal(recipe.parameter_policy.user_adjustable,false);assert.deepEqual(recipe.parameter_policy.optional_parameters,[]);assert.equal(recipe.resources.gpus,0);
    for(const archived of ['SKILL.md','setup/install.md','setup/configure.md'])assert(!read.execution_skill.body.includes(archived));
    // A fresh explicit engineering request uses only the trusted body, never the package guidance.
    assert.equal(confirmationAllowed,true);const newSpec={...structuredClone(recipe.run_spec),idempotency_key:'body-operation-'+runId};terminal=false;
    let operation=await http('POST','/api/runs/prepare',{spec:newSpec});assert.deepEqual(operation.command,recipe.worker_argv);assert.notEqual(operation.id,run.id);
    assert.equal((await http('POST','/api/run/validate',{run_id:operation.id})).validation.status,criteria.run.validation_status);
    operation=await http('POST','/api/run/submit',{run_id:operation.id});const operationDeadline=Date.now()+40000;
    while(['queued','running'].includes(operation.status)&&Date.now()<operationDeadline){await delay(100);operation=await http('POST','/api/run/status',{run_id:operation.id});}
    assert.equal(operation.status,criteria.run.status);terminal=true;
    const actualOutput=JSON.parse((await http('POST','/api/run/file',{run_id:operation.id,name:recipe.output_files[0].name})).text);
    for(const [key,value]of Object.entries(criteria.output.required_fields))assert.equal(actualOutput[key],value);
    const actualChild=json(path.join(operation.directory,criteria.child.run_path)),actualExit=json(path.join(operation.directory,criteria.supervisor.run_path));assert(Number.isInteger(actualOutput.pid)&&actualOutput.pid>0);assert.equal(actualOutput.pid,actualChild.pid);assert.deepEqual(actualExit,operation.exit);
    for(const key of ['exit_code','cancelled','reason'])assert.equal(actualExit[key],criteria.supervisor[key]);
    assert(fs.readFileSync(path.join(operation.directory,criteria.console.run_path),'utf8').split(/\r?\n/).includes(criteria.console.required_line));
    assert(JSON.stringify(await http('POST','/api/run/collect',{run_id:operation.id})).includes(recipe.output_files[0].name));
    report.normal_operation={run_id:operation.id,status:operation.status,exit_code:actualExit.exit_code,child_pid:actualChild.pid,output_name:recipe.output_files[0].name,body_only:true};
    check('Self-contained body recipe runs a fresh real task and supplies independently checked product/exit/PID/marker criteria',report.normal_operation);
    stage='global-archive';const global=await http('POST','/api/tool-guidance/state',{});
    assert.equal(global.configurations.length,1);assert.equal(global.configurations[0].has_activation,true);assert.equal(global.configurations[0].execution_skill.sha256,read.execution_skill.sha256);assert(!JSON.stringify(global).includes('"body":'));assert(global.archived_resources.length>0);
    const facts=await controller.resolveGuidance({provider:'codex',threadId:'unbound-integration',checkCurrent:()=>true});assert.equal(facts.state,'legacy_unconfigured');assert(facts.archivedResources.length);assert.equal(facts.executionSkill,undefined);
    // A second empty desktop index reproduces a missing activation reply / desktop receipt after worker commit.
    const recoveredCatalog=catalogAt('desktop-recovery'),recoveredPackages=createToolPackageRegistry({catalog:recoveredCatalog,storeRoot:path.join(root,'unused-recovery-store')});
    const recovered=createToolConfigurationController({...options,catalog:recoveredCatalog,packages:recoveredPackages});
    const recovery=await recovered.resolveGuidance({provider:'codex',threadId:'unbound-recovery',checkCurrent:()=>true});
    assert.equal(recovery.state,'legacy_unconfigured');assert.deepEqual(recovery.archivedResources.flatMap(item=>item.paths).sort(),facts.archivedResources.flatMap(item=>item.paths).sort());assert.equal(recovery.executionSkill,undefined);
    assert(recoveredCatalog.get('tool-configuration-index',plan.configuration_id).has_execution);
    check('Persisted global metadata restores archives into empty desktop Catalog without body or consent');
    stage='authority-boundaries';await http('POST','/api/tool-guidance/state',{}, {credential:null,status:401});
    for(const route of ['/api/tool-guidance/state','/api/tool-execution-skill/read','/api/projects','/api/tool-configuration/project/create','/api/tool-configuration/execute'])await http('POST',route,{}, {credential:'mcp',status:403});
    const listed=await http('POST','/mcp',{jsonrpc:'2.0',id:1,method:'tools/list'}, {credential:'mcp'});
    assert(!listed.result.tools.some(tool=>/tool_configuration|tool_guidance_state|tool_execution_skill/.test(tool.name)));
    const denied=await http('POST','/mcp',{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'tool_guidance_state',arguments:{}}},{credential:'mcp'});assert.equal(denied.result.isError,true);assert(!JSON.stringify(denied).includes(read.execution_skill.body));
    await http('POST','/api/workspace/read',{project_id:project.id,name:path.join(packageRoot,'SKILL.md')},{status:403});
    await http('POST','/api/tool-configuration/plan',{package_id:registered.package_id,package_version:registered.package_version,target:{target:'local',project_id:project.id,environment_id:environment.id},request_id:'forged-'+runId,passed:true},{status:400});
    assert.equal((await http('GET','/api/runs')).length,2);assert.deepEqual(await http('GET','/api/projects'),originalProjects);
    check('HTTP unauthenticated/MCP/admin boundaries reject mutations, body access, archived raw guidance and caller passed');
    report.status='passed';report.native_ui='not_run';report.scientific_status='not_run';
  } catch(error) {
    report.status='failed';report.failure={stage,name:error.name,message:safe(error.message),stack:safe(error.stack)};
    throw error;
  } finally {
    if(started&&!terminal&&worker&&tokens)try{for(const run of await http('GET','/api/runs'))if(!['succeeded','failed','cancelled','unknown'].includes(run.status))await http('POST','/api/run/cancel',{run_id:run.id});}catch(error){report.cleanup_warning=safe(error.message);}
    const running=()=>child&&child.exitCode===null&&child.signalCode===null;
    if(running()){child.kill('SIGTERM');const stopped=Date.now()+5000;while(running()&&Date.now()<stopped)await delay(50);if(running()){child.kill('SIGKILL');await delay(100);}}
    report.owned_server_stopped=!child||child.exitCode!==null||child.signalCode!==null;
    for(const catalog of catalogs)catalog.db.close();
    report.finished_at=new Date().toISOString();write(path.join(root,'report.json'),JSON.stringify(report,null,2)+'\n');
    write(path.join(evidenceRoot,'latest.json'),JSON.stringify({status:report.status,root,report:path.join(root,'report.json'),scope,checks:checks.length},null,2)+'\n');
  }
  return {status:report.status,root,report:path.join(root,'report.json'),checks:checks.length};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const args=process.argv.slice(2),value=flag=>{const index=args.indexOf(flag);assert(index>=0&&args[index+1],`Explicit ${flag} required`);return args[index+1];};
  try{const result=await runToolConfigurationIntegration({repositoryRoot:value('--repo-root'),evidenceRoot:value('--evidence-root'),python:value('--python')});console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;}
  catch(error){console.error(error.name+': '+error.message);process.exitCode=1;}
}
