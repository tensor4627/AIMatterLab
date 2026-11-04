import rawFs from 'node:fs';
import {createReadPolicy,legacyGuidanceFacts} from './read-policy.mjs';
import {policyIo} from './policy-io.mjs';
import {selectScientificFunctions} from './scientific-context.mjs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=text=>createHash('sha256').update(text).digest('hex');
export function pygasRoutes(text='',parameters={}){
 const value=text+' '+JSON.stringify(parameters);if(!/pygas|metad|增强采样|偏置|\bbias\b|\bcvs?\b|collective.variable|umbrella|opes/i.test(value))return [];
 const bias=/metad|偏置|\bbias\b|umbrella|opes/i.test(value),cv=/\bcvs?\b|collective.variable|增强采样|metad|偏置|\bbias\b|umbrella|opes/i.test(value);
 return ['pygas-workflow',...(cv?['pygas-build-cv-model']:[]),...(bias?['pygas-build-bias-model']:[]),...(/opes/i.test(value)?['pygas-opes']:[]),'pygas-compile-workflow','pygas-check-gpumd-contract'];
}
export function loadPygasSkills({sources,text,parameters={},consented=false,limits={},policy=createReadPolicy(legacyGuidanceFacts())}){
 const fs=policyIo(rawFs,policy);policy.assertCurrent();
 const routes=pygasRoutes(text,parameters);if(!routes.length)return {status:'not_run',routes,attachments:[],text:''};
 // No local contents are read or attached without explicit desktop-user consent.
 if(consented!==true)return {status:'permission_required',routes,attachments:[],text:''};
 if(!policy.hasReadGrant()&&selectScientificFunctions({text,parameters}).some(id=>policy.appliesTo({id,engines:parameters.engine?[parameters.engine]:[]})))return {...policy.executionResult(routes[0]),routes};
 const source=sources.find(s=>s.id==='pygas');if(!source)return {status:'blocked',routes,attachments:[],text:'Local pyGAS source is not bound; report this limitation instead of inventing CV/bias code.'};
 const root=path.resolve(source.root,'agents','skills'),attachments=[];let bytes=0;
 const maxBytes=limits.maxBytes??112*1024,maxFileBytes=limits.maxFileBytes??48*1024;
 function read(file){
  const relative=path.relative(root,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Skill attachment outside portable root');
  if(!fs.existsSync(file))throw Error('Missing pyGAS skill attachment: '+relative);
  if(fs.realpathSync(file)!==path.resolve(file)||!fs.statSync(file).isFile())throw Error('Linked pyGAS skill attachment refused');
  const size=fs.statSync(file).size;if(size>maxFileBytes||bytes+size>maxBytes)throw Error('pyGAS skill context exceeds bounded size');
  const content=fs.readFileSync(file,'utf8');if(content.includes('\0'))throw Error('Invalid pyGAS skill encoding');bytes+=size;attachments.push({path:file,name:relative.split(path.sep).join('/'),sha256:hash(content),bytes:size,content});
 }
 try{
  for(const name of routes)read(path.join(root,name,'SKILL.md'));
  const extras=['pygas-workflow/references/workflow-map.md'];
  if(routes.includes('pygas-build-cv-model'))extras.push('pygas-build-cv-model/references/cvonly-contract.md','pygas-build-cv-model/assets/build_cvonly_cn.py');
  if(routes.includes('pygas-build-bias-model'))extras.push('pygas-build-bias-model/references/bias-model-contract.md','pygas-build-bias-model/assets/build_wtmetad_cn.py','pygas-build-bias-model/assets/build_umbrella_cn.py');
  for(const file of extras)read(path.join(root,file));
 }catch(error){return {status:'blocked',routes,attachments:[],text:error.message};}
 const digest=hash(attachments.map(a=>a.name+':'+a.sha256).join('\n'));
 const preface='[Automatically selected pyGAS skills from the user-approved local source]\nThese portable project instructions and examples guide CV/bias AUTHORING. Studio human review is mandatory: do not build, validate, execute MD/training, submit jobs or bypass the Execute button. Reuse established scientific intent; adapt example atoms, units and bias values rather than copying unrelated choices. Use inspect_source_project and render_pygas_workflow for runnable saved inputs. Studio defaults to .pt; honor explicit full-v2 dual/AOTI selections and fail incompatible .pt2 without fallback. In present_task put critical parameters first, use advanced:true for details, and supply default/default_source only when verified in actual source/config. Display defaults do not rewrite input files. Keep one workflow per conversation. Use the desktop-provided authoring project even if old history says Unknown project or read-only filesystem. Actual file writes must use Studio authoring tools. Source, graph, output names, dtype, CV count and structure-derived facts are Agent responsibilities, not blank user inputs. Preserve human temperature and atom choices. For phi/psi, inspect the actual structure topology with suggest_parameters and use real periodic torsion classes; never substitute distance-only templates or guess indices from molecule names. Save generated files, not source text fields. Ask only for unresolved physical intent, then finish all independent authoring work.\n';
 policy.assertReadsCurrent();
 return {status:'passed',routes,source:source.root,digest,attachments:attachments.map(({content,...a})=>a),text:preface+attachments.map(a=>'\n[pyGAS attachment: '+a.name+'; SHA256 '+a.sha256+']\n'+a.content).join('\n'),bytes};
}
export class PygasSkillContext{
 constructor(){this.loaded=new Map();}
 prepare(key,args){const context=loadPygasSkills(args);return {...context,attach:context.status==='passed'&&this.loaded.get(key)!==context.digest};}
 accept(key,context){if(context.status==='passed')this.loaded.set(key,context.digest);}
 forget(key){this.loaded.delete(key);}
}
