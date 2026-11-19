import path from 'node:path';
import {resolveReadPolicy} from './read-policy.mjs';
import {PublicRuleEvidence} from './public-rule-evidence.mjs';
import {ScientificSkillRouter} from './scientific-skill-router.mjs';
import {ScientificSkillContext} from './scientific-context.mjs';
import {SelectedManagedGuidance,SELECTED_MANAGED_FUNCTION} from './selected-managed-guidance.mjs';
const SOURCES=new Set(['gpumd','pydyn','hotpp','torchnep']);
// v0.18.7 compatible-login wrote a redundant pyGAS entry into this map.
// The separate pygasSkillProviders remains authoritative; never merge grants.
export function normalizeScientificSharing(settings){
 const scope=settings.scientificSkillProviders;
 if(!scope||typeof scope!=='object'||Array.isArray(scope)||!Object.hasOwn(scope,'pygas'))return settings;
 const {pygas:legacy,...scientificSkillProviders}=scope;
 return {...settings,scientificSkillProviders};
}
export function validateScientificConsent(value){
 if(value===undefined)return;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(source=>!SOURCES.has(source)))throw Error('Invalid public scientific skill source scope');
 for(const providers of Object.values(value))if(!Array.isArray(providers)||providers.some(p=>!['codex','kimi','qwen','deepseek','compatible'].includes(p))||new Set(providers).size!==providers.length)throw Error('Invalid scientific skill provider scope');
}
export class ScientificSkills{
 constructor({map,bundledRoot,sources,settings,setupAllowed,studioRoot,workerSource,resolveGuidance,assertScope,registeredSources,providerConsent=()=>true}){
  this.resolveGuidance=resolveGuidance;this.assertScope=assertScope;
  this.map=structuredClone(map);this.sources=sources;this.settings=settings;this.registeredSources=registeredSources;
  this.sourcesForPolicy=policy=>policy&&(policy.state!=='legacy_unconfigured'||policy.facts.archivedResources.length)?(registeredSources?.()||[]):sources();
  this.ruleEvidence=new PublicRuleEvidence((source,{policy}={})=>source==='studio'?studioRoot:source==='studio-worker'?workerSource:this.sourcesForPolicy(policy).find(item=>item.id===source)?.root);
  this.router=new ScientificSkillRouter({ruleEvidence:(document,options)=>this.ruleEvidence.inspect(document,options),resolveGuidance,assertScope,map,sourceRoot:(source,{policy}={})=>source==='studio'?bundledRoot:(()=>{const item=this.sourcesForPolicy(policy).find(item=>item.id===source);return item?path.join(item.root,'agents','skills'):undefined;})(),consent:(provider,source)=>providerConsent(provider,source)&&(source==='pygas'?(settings().pygasSkillProviders||[]).includes(provider):(settings().scientificSkillProviders?.[source]||[]).includes(provider)),setupAllowed});
  this.context=new ScientificSkillContext(this.router);
  this.selectedManaged=new SelectedManagedGuidance();
 }
 clearManagedSelection(provider,threadId){this.selectedManaged.clear(provider,threadId);}
 bindManagedSelection(value){return this.selectedManaged.bind(value);}
 async resolvePolicy(scope){return resolveReadPolicy({resolveGuidance:this.resolveGuidance,assertScope:this.assertScope},scope);}
 async catalog(provider,scope={provider}){
  const withSelected=value=>{const selected=this.selectedManaged.catalog(scope,policy);return selected?{...value,selected_skill:{...selected,function_id:SELECTED_MANAGED_FUNCTION}}:value;};
  const policy=await this.resolvePolicy(scope),registered=new Set(this.sourcesForPolicy(policy).map(s=>s.id)),sourceStatus=route=>route.sources.every(source=>source==='studio'||registered.has(source))?'registered':'unregistered';
  if(policy.state!=='legacy_unconfigured'){const catalog=await this.router.catalog(provider);await policy.revalidate();return withSelected({...catalog,guidanceState:policy.state,execution:policy.catalogEntry(),functions:catalog.functions.map(route=>({...route,source_status:sourceStatus(route),title:this.map.functions.find(item=>item.id===route.id)?.title||route.id,document_ids:policy.appliesTo(route)&&!policy.hasReadGrant()?(policy.catalogEntry()?[policy.facts.executionSkill.id,...policy.facts.executionSkill.resources.map(item=>item.id)]:[]):this.router.documentIds(route.id),guidanceState:policy.appliesTo(route)?policy.state:'legacy_unconfigured'})),sharing:{...this.settings().scientificSkillProviders||{},pygas:[...(this.settings().pygasSkillProviders||[])]}});}
  const catalog=await this.router.catalog(provider);
  await policy.revalidate();
  return withSelected({...catalog,functions:catalog.functions.map(route=>({...route,source_status:sourceStatus(route),title:this.map.functions.find(r=>r.id===route.id)?.title||route.id})),sharing:{...this.settings().scientificSkillProviders||{},pygas:[...(this.settings().pygasSkillProviders||[])]},source_scope:'Sharing covers only whitelisted public agents/skills and delivery packages explicitly selected in this current conversation; private user skills, custom CV code, credentials and SSH details are excluded.'});
 }
 tools(){return [{name:'scientific_skill_catalog',description:'List exact task/function-to-public-skill routes, provider sharing and source registration. Registration/guidance is not runtime capability. No installation bodies are read.',annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},inputSchema:{type:'object',properties:{},additionalProperties:false}},{name:'read_scientific_skill',description:'Read only SKILL.md entries for the chosen function route with SHA256 receipts. Supporting references are listed but not preloaded. When a specific detail is needed, for a complete bounded document, pass document_id exactly as advertised in document_ids or attachment name; only documents belonging to that function are accepted. Explicitly selected registered delivery packages use function_id selected.managed with their advertised opaque document_id; this does not accept paths or package overrides. Focused reads return one full body or explicit blocked, with a serialized MCP 24 KiB limit. Use the route for current intent, not the full installation/build/analysis stack. Installation/setup guidance requires the current trusted setup or repair delegation and existing project/resource authorization.',annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},inputSchema:{type:'object',properties:{function_id:{type:'string',enum:[...this.map.functions.map(r=>r.id),SELECTED_MANAGED_FUNCTION]},document_id:{type:'string',description:'Exact advertised document ID belonging to function_id; not a filesystem path.'}},required:['function_id'],additionalProperties:false}}];}
 async call(name,args,scope){const {provider}=scope;if(name==='scientific_skill_catalog')return this.catalog(provider,scope);if(name==='read_scientific_skill'){if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!['function_id','document_id'].includes(key)))throw Error('Invalid scientific skill arguments');if(args.function_id===SELECTED_MANAGED_FUNCTION)return this.selectedManaged.read(args.document_id,scope);return this.router.read(provider,args.function_id,args.document_id,{scope});}throw Error('Unknown scientific skill tool');}
}
