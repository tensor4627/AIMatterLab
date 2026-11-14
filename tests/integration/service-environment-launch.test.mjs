import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {serviceLaunch,validateServiceEnvironment} from '../../desktop/platform/terminal-service/service-launch.mjs';
const nonce='a'.repeat(64),command="python3 -I -u -c 'fixed fixture' '"+nonce+"'";
const shell=process.platform==='win32'?process.env.STUDIO_TEST_WSL?script=>spawnSync((process.env.SystemRoot||'C:\\Windows')+'\\System32\\wsl.exe',['--distribution',process.env.STUDIO_TEST_WSL,'--exec','/bin/sh','-s'],{input:script,encoding:'utf8',windowsHide:true,timeout:15000}):null:script=>spawnSync('/bin/sh',['-s'],{input:script,encoding:'utf8',timeout:15000});
test('default profiles retain their existing exact launch command',()=>assert.equal(serviceLaunch(command,nonce),command+'\r'));
test('saved recipe inputs are bounded and never become unquoted executable selectors',()=>{
 for(const value of [null,{python:'python3',activation:'x\0y'},{python:'python3\nother',activation:''},{python:'python3',activation:'x'.repeat(8193)},{python:'relative/path',activation:''}])assert.throws(()=>validateServiceEnvironment(value));
 const lines=serviceLaunch(command,nonce,{python:'/owned/environment with space/bin/python',activation:('# line\n'.repeat(900))}).split('\r');assert(lines.length>10);assert(lines.every(line=>Buffer.byteLength(line)<2048));assert(!lines.some(line=>line.includes('__STUDIO_SERVICE_V1__:'+nonce+':')));
 const quotes=serviceLaunch(command,nonce,{python:'python3',activation:"'".repeat(8000)});assert(quotes.split('\r').every(line=>Buffer.byteLength(line)<2048));
});
function run(script){const result=shell(script);assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);return result.stdout;}
function errors(text){return text.replaceAll('\x1b[2J\x1b[3J\x1b[H','').split(/\r?\n/).filter(line=>line.startsWith('__STUDIO_SERVICE_V1__:'+nonce+':')).map(line=>{const fields=line.split(':');return {kind:fields[2],value:JSON.parse(Buffer.from(fields[4],'base64'))};});}
test('real POSIX shell activates long multiline recipe and selects the exact spaced interpreter',{skip:!shell},()=>{
 const dir='/tmp/studio-service-launch-'+randomUUID(),python=dir+'/selected python';
 const setup='task_dir='+JSON.stringify(dir)+'\nmkdir "$task_dir"\ntrap \'rm -rf -- "$task_dir"\' EXIT\ncat > "$task_dir/selected python" <<\'PY\'\n#!/bin/sh\nprintf "ACTIVATED:%s\\n" "$STUDIO_TEST_MARKER"\nPY\nchmod 700 "$task_dir/selected python"\n';
 const script=serviceLaunch(command,nonce,{python,activation:'# unchanged fixture\n'.repeat(300)+'export STUDIO_TEST_MARKER=expected_中文_😀'}).replaceAll('\r','\n');
 assert.equal(run(setup+script).trim(),'ACTIVATED:expected_中文_😀');
});
test('real shell activation failure returns exact authenticated error and exit barriers',{skip:!shell},()=>{
 const text=run(serviceLaunch(command,nonce,{python:'/missing/python',activation:'false'}).replaceAll('\r','\n'));
 assert.deepEqual(errors(text),[{kind:'ERROR',value:{code:'environment_activation_failed',phase:'preparing_environment'}},{kind:'EXITED',value:{reason:'failed'}}]);
});
test('real shell missing interpreter reports Python startup failure without evaluating its path',{skip:!shell},()=>{
 const text=run(serviceLaunch(command,nonce,{python:'/missing/$(printf INJECTED)',activation:''}).replaceAll('\r','\n'));
 assert(!text.includes('INJECTED'));assert.deepEqual(errors(text),[{kind:'ERROR',value:{code:'python_start_failed',phase:'waiting_python'}},{kind:'EXITED',value:{reason:'failed'}}]);
});
