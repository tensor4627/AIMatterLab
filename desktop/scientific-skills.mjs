import path from 'node:path';
import {PublicRuleEvidence} from './public-rule-evidence.mjs';
import {ScientificSkillRouter} from './scientific-skill-router.mjs';
import {ScientificSkillContext} from './scientific-context.mjs';
const SOURCES=new Set(['gpumd','pydyn','hotpp','torchnep']);
export function validateScientificConsent(value){
 if(value===undefined)return;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(source=>!SOURCES.has(source)))throw Error('Invalid public scientific skill source scope');
 for(const providers of Object.values(value))if(!Array.isArray(providers)||providers.some(p=>!['codex','kimi','qwen','deepseek'].includes(p))||new Set(providers).size!==providers.length)throw Error('Invalid scientific skill provider scope');
}
export class ScientificSkills{
 constructor({map,bundledRoot,sources,settings,setupAllowed,studioRoot}){
  this.map=structuredClone(map);this.sources=sources;this.settings=settings;
  this.ruleEvidence=new PublicRuleEvidence(source=>source==='studio'?studioRoot:sources().find(item=>item.id===source)?.root);
  this.router=new ScientificSkillRouter({ruleEvidence:document=>this.ruleEvidence.inspect(document),map,sourceRoot:source=>source==='studio'?bundledRoot:(()=>{const item=sources().find(item=>item.id===source);return item?path.join(item.root,'agents','skills'):undefined;})(),consent:(provider,source)=>source==='pygas'?(settings().pygasSkillProviders||[]).includes(provider):(settings().scientificSkillProviders?.[source]||[]).includes(provider),setupAllowed});
  this.context=new ScientificSkillContext(this.router);
 }
 async catalog(provider){
  const catalog=await this.router.catalog(provider),registered=new Set(this.sources().map(s=>s.id));
  return {...catalog,functions:catalog.functions.map(route=>({...route,source_status:route.sources.every(source=>source==='studio'||registered.has(source))?'registered':'unregistered',title:this.map.functions.find(r=>r.id===route.id)?.title||route.id})),sharing:{...this.settings().scientificSkillProviders||{},pygas:[...(this.settings().pygasSkillProviders||[])]},source_scope:'Sharing covers only whitelisted public agents/skills; private user skills, custom CV code, credentials and SSH details are excluded.'};
 }
 tools(){return [{name:'scientific_skill_catalog',description:'List exact task/function-to-public-skill routes, provider sharing and source registration. Registration/guidance is not runtime capability. No installation bodies are read.',annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},inputSchema:{type:'object',properties:{},additionalProperties:false}},{name:'read_scientific_skill',description:'Read only the chosen function route from the actual registered public software skill source, with SHA256 receipts. Use the route for current intent, not the full installation/build/analysis stack. Installation/setup is blocked outside the desktop setup stage.',annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},inputSchema:{type:'object',properties:{function_id:{type:'string',enum:this.map.functions.map(r=>r.id)}},required:['function_id'],additionalProperties:false}}];}
 async call(name,args,{provider}){if(name==='scientific_skill_catalog')return this.catalog(provider);if(name==='read_scientific_skill')return this.router.read(provider,args.function_id);throw Error('Unknown scientific skill tool');}
}
