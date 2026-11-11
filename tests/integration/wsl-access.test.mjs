import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import path from 'node:path';
import {decodeWslOutput,isWslAccessDenied,probeWslAccess} from '../../desktop/platform/wsl-access.mjs';
import {runWorkerTests,workerTestPreflight} from '../../scripts/test-worker.mjs';

const marker='Wsl/EnumerateDistros/Service/E_ACCESSDENIED';
function utf16be(text){const bytes=Buffer.from(text,'utf16le');bytes.swap16();return Buffer.concat([Buffer.from([0xfe,0xff]),bytes]);}

test('WSL output decoder preserves UTF8 and UTF16 names without weakening string validation',()=>{
 for(const value of ['Ubuntu\r\nDebian\n',Buffer.from('Ubuntu\r\nDebian\n'),Buffer.from('Ubuntu\r\nDebian\n','utf16le'),Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('Ubuntu\r\nDebian\n','utf16le')]),utf16be('Ubuntu\r\nDebian\n')])assert.equal(decodeWslOutput(value),'Ubuntu\r\nDebian\n');
 assert.equal(decodeWslOutput('Ubun\0tu'),'Ubun\0tu');
 assert.throws(()=>decodeWslOutput(Buffer.from([0xfe,0xff,1])),/encoding/);
});

test('WSL denial recognizes stdout, stderr and message in Windows encodings but no generic Linux file denial',()=>{
 for(const code of [marker,'Wsl/E_ACCESSDENIED'])for(const field of ['stdout','stderr','message'])for(const value of [code,Buffer.from(code,'utf16le'),utf16be(code),Buffer.from(code,'utf16le').toString('utf8')])assert.equal(isWslAccessDenied({[field]:value}),true);
 for(const error of [{message:'Permission denied: /private/data'},{code:'EACCES',stderr:'permission denied'},{message:'unrelated 0x80070005'},{stdout:Buffer.from([0xfe,0xff,1])},null])assert.equal(isWslAccessDenied(error),false);
});

test('WSL capability probe reports a bounded private-safe category before a worker can start',()=>{
 let call;
 const result=probeWslAccess({platform:'win32',probe:(...args)=>{call=args;return {status:-1,stdout:Buffer.from('secret-token\n'+marker,'utf16le')};}});
 assert.equal(result.status,'blocked');assert.equal(result.reason,'wsl_access_denied');assert(!JSON.stringify(result).includes('secret-token'));
 assert.deepEqual(call.slice(0,2),['wsl.exe',['--list','--quiet']]);
 assert.deepEqual(call[2],{windowsHide:true,timeout:6000,maxBuffer:65536,encoding:'buffer'});
 let spawns=0;const messages=[];
 assert.equal(runWorkerTests({platform:'win32',args:[],preflight:()=>result,spawnTarget:()=>{spawns++;},write:value=>messages.push(value)}).exitCode,2);
 assert.equal(spawns,0);assert.deepEqual(messages,[result]);
});

test('missing WSL, timeout, unknown failure and empty or malformed inventories remain blocked',()=>{
 for(const [response,reason]of [[{error:{code:'ENOENT'}},'wsl_unavailable'],[{error:{code:'ETIMEDOUT'}},'wsl_probe_timeout'],[{status:1,stdout:'unknown private error'},'wsl_probe_failed'],[{status:0,stdout:''},'wsl_distribution_missing'],[{status:0,stdout:'bad/name'},'wsl_probe_failed'],[{status:0,stdout:'A'.repeat(32769)},'wsl_probe_failed']]){
  const result=probeWslAccess({platform:'win32',probe:()=>response});assert.equal(result.status,'blocked');assert.equal(result.reason,reason);
 }
 assert.equal(probeWslAccess({platform:'win32',probe:()=>{throw Object.assign(Error('private'),{code:'ENOENT'});}}).reason,'wsl_unavailable');
});

test('normal Windows context uses the explicitly selected installed distro without fallback or extra workers',()=>{
 let calls=0;
 const preflight=options=>workerTestPreflight({...options,probe:()=>({status:0,stdout:Buffer.from('Ubuntu\nDebian\n','utf16le')})});
 const env={STUDIO_WSL_DISTRO:'Debian'},child=new EventEmitter();
 let invocation;
 const result=runWorkerTests({platform:'win32',env,args:[],cwd:'D:\\studio',preflight,spawnTarget:(...args)=>{calls++;invocation=args;return child;}});
 assert.equal(result.child,child);assert.equal(calls,1);
 assert.equal(invocation[0],'wsl.exe');assert.deepEqual(invocation[1].slice(0,5),['-d','Debian','--','python3','-m']);
 assert.equal(invocation[2].env,env);assert.equal(invocation[2].windowsHide,true);
 const blocked=workerTestPreflight({platform:'win32',env:{STUDIO_WSL_DISTRO:'Missing'},probe:()=>({status:0,stdout:'Ubuntu\n'})});
 assert.equal(blocked.reason,'wsl_distribution_missing');
});

test('native Linux test path stays native and preflight-only never invokes Python',()=>{
 let probes=0,spawns=0,invocation;
 assert.deepEqual(probeWslAccess({platform:'linux',probe:()=>{probes++;}}),{status:'allowed',reason:'not_windows'});
 assert.equal(probes,0);
 const child=new EventEmitter();
 assert.equal(runWorkerTests({platform:'linux',args:[],cwd:process.cwd(),spawnTarget:(...args)=>{spawns++;invocation=args;return child;}}).child,child);
 assert.equal(invocation[0],'python3');assert.equal(invocation[1][4],path.resolve('backend/worker/tests'));
 const messages=[];
 assert.equal(runWorkerTests({platform:'linux',args:['--preflight-only'],spawnTarget:()=>{spawns++;},write:value=>messages.push(value)}).exitCode,0);
 assert.equal(spawns,1);assert.equal(messages[0].reason,'not_windows');
 assert.equal(runWorkerTests({args:['--preflight-only','--anything'],preflight:()=>{throw Error('must not probe');},write:()=>{}}).exitCode,2);
});
