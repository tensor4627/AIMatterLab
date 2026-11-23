import {editJsonDraft,inspectJsonDraft,isJsonObject,jsonDraftIssue} from '../../ui/json-draft.mjs';

const issues={duplicate:'JSON 对象中有重复键。',number:'JSON 数值超出可保存的精度。'};

export function inspectResumeParameters(source){
 const document=inspectJsonDraft(source);
 if(!document){
  JSON.parse(source); // Keep the original syntax error for the editor.
  throw SyntaxError('JSON 语法有误。');
 }
 if(!isJsonObject(document.value))throw Error('续算参数必须是 JSON 对象');
 const issue=jsonDraftIssue(document);
 return {document,parameters:document.value,issue:issue?issues[issue]:null};
}

export function parseResumeParameters(source,{forSubmission=false,translate=value=>value}={}){
 const {parameters,issue}=inspectResumeParameters(source);
 if(forSubmission&&issue)throw Error(translate(issue));
 return parameters;
}

export function missingResumeInput(engine,parameters){
 const names=parameters.checkpoint_files;
 if(names==null||names===''||Array.isArray(names)&&(!names.length||names.some(name=>typeof name!=='string'||!name)))return '请填写 checkpoint_files 中的实际文件名。';
 const lacks=name=>Array.isArray(names)&&!names.includes(name);
 const empty=value=>value==null||value==='';
 if(engine==='gpumd.md'||engine==='gpumd.sampling'){
  if(lacks('restart.xyz'))return 'GPUMD 续算需要 restart.xyz。';
  if(empty(parameters.continuation_run_in))return '请填写续算 run.in 路径。';
 }
 if(engine==='hotpp.train'){
  if(empty(parameters.checkpoint)||lacks(parameters.checkpoint))return '请从 checkpoint_files 中指定 HotPP checkpoint。';
  if(empty(parameters.continuation_config))return '请填写续算配置文件路径。';
 }
 if(engine==='pydyn.md'||engine==='pydyn.sampling'){
  if(empty(parameters.continuation_script))return '请填写续算脚本路径。';
  if(engine==='pydyn.sampling'&&(empty(parameters.paired_manifest)||lacks(parameters.paired_manifest)))return '请从 checkpoint_files 中指定配对清单。';
 }
 return null;
}

export function replaceResumeParameter(sourceOrDocument,key,value){
 const document=typeof sourceOrDocument==='string'?inspectResumeParameters(sourceOrDocument).document:sourceOrDocument;
 return editJsonDraft(document,[key],JSON.stringify(value),{duplicateKeys:'last'});
}
