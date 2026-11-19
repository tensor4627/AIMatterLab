import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmFreshSshShell} from '../../desktop/platform/terminal-service/session.mjs';

// Drive the terminal at the same waitRead/typed-input boundary as the broker,
// with a controlled clock so stalled terminals never cost a real 15 seconds.
function terminal({output=()=>'',onWrite=()=>{},alive=()=>true,current=()=>{}}={}){
 let time=0,lastCursor=0,pending='';
 const writes=[];
 const confirm=()=>confirmFreshSshShell({clock:()=>time,assertCurrent:()=>current(time),
  async read(cursor){
   assert.equal(cursor,lastCursor);
   time+=250;
   const data=pending+output(time);pending='';
   if(data)lastCursor++;
   return {state:{alive:alive(time)},cursor:lastCursor,chunks:data?[{data}]:[]};
  },
  write(data){
   const parts=/'(__STUDIO_FRESH_SHELL_)' '([a-f0-9]+__)'/.exec(data);
   assert.ok(parts);const proof=parts[1]+parts[2];
   assert.ok(!data.includes(proof),'the challenge echo cannot contain the proof');
   writes.push({time,data});pending+=onWrite({time,data,proof})||'';
  }
 });
 return {confirm,writes};
}

test('a delayed login discards early input; the first managed challenge waits for the remote prompt',async()=>{
 const setup=terminal({output:t=>t===250?'Welcome to the fixture\r\n':t===1500?'\x1b[?2004hfixture$ ':'',
  onWrite:({time,proof})=>time>=1500?'\r\n'+proof+'\r\n':''});
 await setup.confirm();
 assert.deepEqual(setup.writes.map(x=>x.time),[1500]);
});

test('a silent startup can discard the first harmless challenge and later answer from the same private PTY',async()=>{
 const setup=terminal({output:t=>t===6750?'fixture% ':'',
  onWrite:({time,data,proof})=>time<6750?data+'\r\n':'\x1b[12;1H'+proof+'\x1b[13;1Hfixture% '});
 await setup.confirm();
 assert.equal(setup.writes.length,2);
 assert.equal(setup.writes[0].data,setup.writes[1].data);
});

test('wrapped echoes and ANSI prompts alone never grant a terminal',async()=>{
 const setup=terminal({output:t=>t===250?'fixture$ ':'',
  onWrite:({data})=>'\r\n'+data.replace("' '","'\r\n'")+'\r\nfixture$ '});
 await assert.rejects(setup.confirm(),{code:'ssh_shell_readiness_timeout'});
 assert.equal(setup.writes.length,2);
});

test('an upstream selection or authentication prompt stays private and receives no typed challenge',async()=>{
 for(const screen of ['目标资产列表\r\n请输入资产序号：','Choose an asset: ','Verification code: ','Password: ','login as: ','用户名：']){
  const setup=terminal({output:t=>t===250?screen:''});
  await assert.rejects(setup.confirm(),{code:'ssh_shell_interaction_required'});
  assert.equal(setup.writes.length,0);
 }
});

test('a server channel refusal and a revoked open have distinct results',async()=>{
 const refused=terminal({output:()=> 'mux_client_request_session: session request failed: Session open refused by peer\r\n',alive:()=>false});
 await assert.rejects(refused.confirm(),{code:'ssh_channel_refused'});
 assert.equal(refused.writes.length,0);
 const revoked=terminal({output:()=> 'fixture$ ',current:t=>{if(t>=250)throw Error('revoked');}});
 await assert.rejects(revoked.confirm(),/revoked/);
 assert.equal(revoked.writes.length,0);
});
