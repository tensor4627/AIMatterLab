import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {normalizeSettings,SETTINGS_KEYS} from '../../desktop/settings-schema.mjs';

const base = {
 distribution:'Ubuntu', workerRoot:'~/.local/state/gpu-sampling-studio', workerPort:8767,
 codexPath:'codex', kimiPath:'kimi', qwenPath:'qwen', cwd:'/home/user/work',
 sourceRoots:[], sourceIds:['pygas'], skillRoots:[], theme:'dark',
 agentProvider:'codex', agentLayout:'right', language:'zh-CN', fontSize:14,
 minimumFontSize:12, chatFontSize:14, editorFontSize:14, terminalFontSize:14,
 pygasSkillProviders:[], projectAgents:{}
};

test('known settings keys are accepted and merged over the current settings',()=>{
 assert.deepEqual(normalizeSettings(base,{}),base);
 assert.equal(normalizeSettings(base,{developerComputeWorkspaceId:'a'.repeat(64)}).developerComputeWorkspaceId,'a'.repeat(64));
 assert.equal(normalizeSettings(base,{developerComputeWorkspaceId:null}).developerComputeWorkspaceId,null);
 for(const invalid of [true,'all','/home/test'])assert.throws(()=>normalizeSettings(base,{developerComputeWorkspaceId:invalid}),/developer compute workspace/);
 assert(SETTINGS_KEYS.includes('resourceBadgeMotion'));
 for(const mode of ['wave','breathe'])assert.equal(normalizeSettings(base,{resourceBadgeMotion:mode}).resourceBadgeMotion,mode);
 assert.throws(()=>normalizeSettings(base,{resourceBadgeMotion:'unknown'}),/badge motion/);
 const cache=path.resolve('cache','skills');
 assert.equal(normalizeSettings(base,{userCacheDirectory:cache}).userCacheDirectory,cache);
 for(const value of ['relative',null,path.parse(cache).root,'//server/share/skills','/invalid\ncache']){
  assert.throws(()=>normalizeSettings(base,{userCacheDirectory:value}),/local absolute/);
 }
 assert.equal(normalizeSettings(base,{terminalIdleMinutes:60}).terminalIdleMinutes,60);
 for(const value of [0,1441,1.5,null])assert.throws(()=>normalizeSettings(base,{terminalIdleMinutes:value}),/idle timeout/);
 const next = normalizeSettings(base,{theme:'light', fontSize:18, autoDiscoverCompute:true, projectAgents:{project: 'kimi'}, agentProviders:{codex:{contextWindow:200000}}});
 assert.equal(next.theme,'light');
 assert.equal(next.fontSize,18);
 assert.equal(next.autoDiscoverCompute,true);
 assert.deepEqual(next.projectAgents,{project:'kimi'});
 assert.deepEqual(next.agentProviders,{codex:{contextWindow:200000}});
 assert.equal(next.distribution,base.distribution);
});

test('unknown settings keys are rejected instead of being persisted',()=>{
 for (const patch of [{unknownKey:true},{theme:'light',evil:{nested:true}},{distribution:'Ubuntu',__proto__x:1}]) {
  assert.throws(()=>normalizeSettings(base,patch),/Unknown settings/);
 }
 assert.throws(()=>normalizeSettings(base,'light'),/Invalid settings update/);
 assert.throws(()=>normalizeSettings(null,{theme:'light'}),/Invalid current settings/);
});

test('invalid known settings values keep their existing validation',()=>{
 const cases = [
  [{distribution:'Ubuntu\nrm'},/Invalid WSL settings/],
  [{workerPort:80},/Invalid WSL settings/],
  [{workerRoot:'relative/root'},/Invalid WSL settings/],
  [{agentLayout:'top'},/Unsupported workspace layout/],
  [{agentProvider:'unknown'},/Unsupported Agent provider/],
  [{language:'fr'},/Unsupported language/],
  [{fontSize:11},/Invalid font size/],
  [{minimumFontSize:19},/Invalid font size/],
  [{fontFamily:'comic'},/Unsupported font/],
  [{pygasSkillProviders:['unknown']},/Invalid skill sharing/],
  [{scientificSkillProviders:{unknown:['codex']}},/Invalid public scientific skill/],
  [{scientificSkillProviders:{gpumd:['unknown']}},/Invalid scientific skill provider/],
  [{sourceIds:['unknown']},/Invalid source allowlist/],
  [{sourceRoots:['relative']},/Source roots must be absolute/],
  [{skillRoots:'not-an-array'},/Skill roots must be an array/],
  [{skillRoots:[' ']},/Skill roots must be non-empty/],
  [{cwd:''},/Invalid working directory/],
  [{projectAgents:{project:'unknown'}},/Invalid project agent/],
  [{theme:'blue'},/Unsupported theme/],
  [{agent:{contextWindow:10}},/Token budgets/]
 ];
 for (const [patch,pattern] of cases) assert.throws(()=>normalizeSettings(base,patch),pattern,JSON.stringify(patch));
});
