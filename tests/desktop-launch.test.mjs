import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {launchPreflight,requireLaunchContext,launchDesktop,childExitCode,desktopRoot} from '../scripts/desktop-launch.mjs';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {runDevelopment} from '../scripts/dev.mjs';
import {runStart} from '../scripts/start.mjs';
const child=()=>Object.assign(new EventEmitter(),{kill(){this.killed=true;}});
const probe=(status,value)=>()=>({status,stdout:JSON.stringify(value)});
test('restricted and failed probes fail closed; normal non-admin token is accepted',()=>{
 assert.equal(launchPreflight({platform:'win32',probe:probe(2,{reason:'restricted_token'})}).status,'blocked');
 for(const p of [()=>{throw Error('unavailable');},()=>({status:0,stdout:'invalid'}),probe(0,{status:'allowed',restricted:true}),()=>({status:1,stdout:''})]) assert.equal(launchPreflight({platform:'win32',probe:p}).reason,'token_probe_failed');
 assert.equal(requireLaunchContext({platform:'win32',probe:probe(0,{status:'allowed',restricted:false})}).status,'allowed');
});
test('blocked launch resolves no binary and spawns zero targets',async()=>{
 let effects=0;
 for(const reason of ['restricted_token','token_probe_failed']) await assert.rejects(launchDesktop({preflight:()=>requireLaunchContext({platform:'win32',probe:probe(2,{reason})}),resolveBinary:()=>{effects++;},spawnTarget:()=>{effects++;}}));
 assert.equal(effects,0);
});
test('normal launch preserves argument/env/cwd and one target',async()=>{
 const env={SAMPLE:'value'};let seen;
 const target=child();
 assert.equal(await launchDesktop({preflight:()=>{},resolveBinary:async()=> 'electron',spawnTarget:(...args)=>{seen=args;return target;},args:['--flag','a b'],cwd:'fixture',env}),target);
 assert.deepEqual(seen,['electron',['.','--flag','a b'],{cwd:'fixture',env,stdio:'inherit'}]);
 assert.equal(childExitCode(7),7);assert.equal(childExitCode(null,'SIGTERM'),143);assert.equal(childExitCode(null),1);
});
test('development rejects before Vite and Electron; never retries launch',async()=>{
 let effects=0;
 await assert.rejects(runDevelopment({preflight:()=>{throw Error('blocked');},spawnVite:()=>{effects++;},launch:()=>{effects++;}}));
 assert.equal(effects,0);
 const vite=child(),electron=child();let launches=0,options;
 await runDevelopment({preflight:()=>{},spawnVite:()=>vite,fetchReady:async()=>({ok:true}),launch:async value=>{launches++;options=value;return electron;},env:{A:'b'},cwd:'fixture'});
 assert.equal(launches,1);assert.deepEqual(options.env,{A:'b',STUDIO_DEV_URL:'http://127.0.0.1:5173'});assert.equal(options.cwd,'fixture');
 electron.emit('exit',9);assert.equal(vite.killed,true);assert.equal(launches,1);
});
test('development readiness failure cleans Vite without Electron launch',async()=>{
 const vite=child();let launches=0;
 await assert.rejects(runDevelopment({preflight:()=>{},spawnVite:()=>vite,fetchReady:async()=>({ok:false}),wait:async()=>{},launch:()=>{launches++;}}),/did not become ready/);
 assert.equal(vite.killed,true);assert.equal(launches,0);
});
test('Vite abnormal exit retains original code while Electron is stopped once',async()=>{
 const vite=child(),electron=child();let kills=0;
 electron.kill=()=>{kills++;};
 const running=await runDevelopment({preflight:()=>{},spawnVite:()=>vite,fetchReady:async()=>({ok:true}),launch:async()=>electron});
 vite.emit('exit',17,null);
 assert.equal(kills,1);assert.equal(running.exitCode(null,'SIGTERM'),17);
 electron.emit('exit',null,'SIGTERM');
 assert.equal(running.exitCode(null,'SIGTERM'),17);
});
test('probe has a ten-second bounded timeout; timeout cannot spawn a target',async()=>{
 let calls=0,options;
 const timedOut=(_binary,_args,value)=>{options=value;return {error:Object.assign(new Error('timeout'),{code:'ETIMEDOUT'}),status:null,stdout:''};};
 await assert.rejects(launchDesktop({preflight:()=>requireLaunchContext({platform:'win32',probe:timedOut}),resolveBinary:()=>{calls++;},spawnTarget:()=>{calls++;}}));
 assert.equal(calls,0);assert.equal(options.timeout,10000);assert.equal(options.maxBuffer,65536);
});
test('default desktop and development cwd resolve from script location, not caller cwd',async()=>{
 const expected=fileURLToPath(new URL('../',import.meta.url));
 assert.equal(desktopRoot,expected);
 const previous=process.cwd();process.chdir(fileURLToPath(new URL('../../',import.meta.url)));
 try {
 let seen;
 await launchDesktop({preflight:()=>{},resolveBinary:async()=> 'electron',spawnTarget:(_binary,_args,options)=>{seen=options;return child();}});
 assert.equal(seen.cwd,expected);
 const vite=child(),electron=child();let viteCwd,electronCwd;
 await runDevelopment({preflight:()=>{},spawnVite:(_binary,_args,options)=>{viteCwd=options.cwd;return vite;},fetchReady:async()=>({ok:true}),launch:async options=>{electronCwd=options.cwd;return electron;}});
 assert.equal(viteCwd,expected);assert.equal(electronCwd,expected);
 } finally {process.chdir(previous);}
});
test('command-mode probe receives only fixed local source with no file or policy override',()=>{
 let captured;
 const result=launchPreflight({platform:'win32',probe:(binary,args,options)=>{captured={binary,args,options};return {status:0,stdout:JSON.stringify({status:'allowed',restricted:false})};}});
 assert.equal(result.status,'allowed');assert.equal(captured.binary,'powershell.exe');
 assert.deepEqual(captured.args,['-NoLogo','-NoProfile','-NonInteractive','-Command','-']);
 assert.equal(captured.options.input,readFileSync(new URL('../scripts/windows-launch-preflight.ps1',import.meta.url),'utf8')+'\n\n');
 assert.equal(captured.options.timeout,10000);assert.equal(captured.options.maxBuffer,65536);
 assert.equal(captured.args.some(arg=>/^-?(file|executionpolicy|encodedcommand|bypass)$/i.test(arg)),false);
});
test('preflight-only allowed CLI emits JSON/zero without resolving or spawning Electron',async()=>{
 let launches=0;const output=[];
 const value={status:'allowed',reason:'normal_token',restricted:false};
 const result=await runStart({args:['--preflight-only'],preflight:()=>value,launch:()=>{launches++;},write:text=>output.push(JSON.parse(text))});
 assert.equal(result.exitCode,0);assert.equal(launches,0);assert.deepEqual(output,[value]);
 // Other flags retain the ordinary Electron path and exact argument list.
 const args=['--studio-install-verify'];let received;
 await runStart({args,launch:async options=>{received=options.args;return child();}});
 assert.deepEqual(received,args);
});
test('preflight-only blocked CLI returns two and rejects mixed flags with zero target launches',async()=>{
 let launches=0,probes=0;const output=[];
 const options={preflight:()=>{probes++;return {status:'blocked',reason:'restricted_token'};},launch:()=>{launches++;},write:text=>output.push(JSON.parse(text))};
 assert.equal((await runStart({...options,args:['--preflight-only']})).exitCode,2);
 assert.equal((await runStart({...options,args:['--preflight-only','--studio-install-verify']})).exitCode,2);
 assert.equal(launches,0);assert.equal(probes,1);
 assert.deepEqual(output,[{status:'blocked',reason:'restricted_token'},{status:'blocked',reason:'invalid_preflight_arguments'}]);
});
