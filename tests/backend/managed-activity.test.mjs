import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createConversationActivity} from '../../backend/main/compute/conversation-activity.mjs';
import {managedProjectAccess} from '../../backend/main/compute/managed-project-access.mjs';
import {createScheduleDelegations} from '../../backend/main/compute/schedule-delegation.mjs';
import {installManagedTray} from '../../desktop/platform/managed-tray.mjs';

function storage() {
 const data=new Map();
 const bucket=k=>{if(!data.has(k))data.set(k,new Map());return data.get(k);};
 return {get:(k,id)=>bucket(k).get(id),put:(k,id,value)=>{bucket(k).set(id,structuredClone(value));return value;},
   list:k=>[...bucket(k).values()].map(row=>structuredClone(row)),remove:(k,id)=>bucket(k).delete(id)};
}
const a={resourceId:'a',profileId:'alpha',kind:'ssh',name:'Center A'};
const b={resourceId:'b',profileId:'beta',kind:'ssh',name:'Center B'};
const local={resourceId:'l',profileId:'local1',kind:'wsl',name:'Developer workstation'};
const one={provider:'codex',threadId:'one',projectId:'p',taskId:'t1'};
const two={provider:'codex',threadId:'two',projectId:'p',taskId:'t2'};

test('persistent badges reflect only the exact source and conversation while turns and wake times update independently',()=>{
 const catalog=storage(),index=createConversationActivity({catalog});
 for(const p of [a,b,local]) index.style(p);
 for(const r of [a,b,local,a])index.acquired(one,r);
 index.acquired(two,a);
 const colors=catalog.list('compute-resource-style').map(row=>row.color);
 assert.equal(new Set(colors).size,3);
 index.recordRun({scope:one,sourceId:'s1',runId:'shared-id',kind:'cluster-run'});
 const input={resources:[a,b,local],sources:[{id:'s1',profileId:a.profileId,connected:true,observedAt:200,
   runs:[{id:'shared-id',status:'running',observedAt:190}],schedules:[{id:'wake1',kind:'wake_agent',status:'scheduled',scope:two,nextAt:400}]},
   {id:'s2',profileId:b.profileId,connected:true,observedAt:202,runs:[{id:'shared-id',status:'running',observedAt:201}],schedules:[]}],
   turns:[{...one,busy:true}]};
 const [r1,r2]=index.snapshot(input).conversations;
 assert.equal(r1.replying,true);assert.deepEqual(r1.badges.map(x=>[x.label,x.status]),[['Center A','running'],['Center B','idle'],['local','idle']]);
 assert.equal(r2.replying,false);assert.equal(r2.nextWakeAt,400);assert.equal(r2.badges[0].status,'idle');
 index.style({...a,name:'Renamed A'});
 const reloaded=createConversationActivity({catalog}).snapshot({resources:[],turns:[]}).conversations[0];
 assert.equal(reloaded.badges[0].label,'Renamed A');assert.equal(reloaded.badges[0].color,colors[0]);assert.equal(reloaded.badges[0].status,'offline');
 assert.equal(index.runKind(two,'s1','shared-id'),undefined);
});
test('terminal grant follows the verified project and target, schedule delegation originates in the original user turn',()=>{
 const catalog=storage(),access=managedProjectAccess({catalog}),grants=createScheduleDelegations(catalog),resource={...a,targetFingerprint:'target'};
 access.set('p',resource,true);assert.equal(access.includes('p',resource),true);assert.equal(access.includes('other',resource),false);assert.equal(access.includes('p',{...resource,targetFingerprint:'changed'}),false);
 access.set('p',resource,false);assert.equal(access.includes('p',resource),false);
 grants.record({...one,text:'每半小时用脚本监控并唤醒我',turnId:'user-1'});
 assert.equal(grants.assert(one,'upsert',{kind:'script'}),'user-1');assert.equal(grants.assert(one,'upsert',{kind:'wake_agent'}),'user-1');
 assert.throws(()=>grants.assert(two,'upsert',{kind:'poll'}));assert.throws(()=>grants.assert({...one,projectId:'elsewhere'},'upsert',{kind:'script'}));
});
test('closing window hides it, reopening retains the same owner and explicit tray quit enters app cleanup',()=>{
 const app=new EventEmitter(),window=new EventEmitter();let visible=true,quit=false,menu;
 Object.assign(window,{isDestroyed:()=>false,isMinimized:()=>false,show(){visible=true;},hide(){visible=false;},focus(){}});
 app.quit=()=>{quit=true;};
 class Tray extends EventEmitter{setToolTip(){}setContextMenu(value){menu=value;}isDestroyed(){return false;}destroy(){}}
 const tray=installManagedTray({app,window,Tray,Menu:{buildFromTemplate:value=>value},icon:{},language:()=>'en',isQuitting:()=>quit});
 let prevented=false;
 window.emit('close',{preventDefault(){prevented=true;}});
 assert(prevented);assert(!visible);assert(!quit);
 tray.show();assert(visible);menu.at(-1).click();assert(quit);
 window.emit('close',{preventDefault(){assert.fail('explicit quit was intercepted');}});
 app.emit('will-quit');
});
