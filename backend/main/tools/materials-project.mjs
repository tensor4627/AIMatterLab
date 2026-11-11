/** Materials Project REST client. Secrets remain in the main process. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
export const MP_ENDPOINT='https://api.materialsproject.org/materials/summary/';
// MP AlphaID uses lowercase base26 (a=0); leading a padding preserves identity.
function materialIdValue(id){if(typeof id!=='string'||id.length>80||!/^mp-(?:[0-9]+|[a-z]+)$/.test(id))return null;const value=id.slice(3);return /^[0-9]+$/.test(value)?BigInt(value):[...value].reduce((n,c)=>n*26n+BigInt(c.charCodeAt(0)-97),0n);}
export function mpQuery(query,structure=false){
 if(typeof query!=='string'||query.length>80||!query.trim())throw Error('Enter a material ID or formula');
 query=query.trim();if(materialIdValue(query)===null&&!/^([A-Z][a-z]?[0-9.]*)+$/.test(query))throw Error('Use an exact formula or mp-ID');
 const url=new URL(MP_ENDPOINT);url.searchParams.set(/^mp-/.test(query)?'material_ids':'formula',query);url.searchParams.set('_limit',structure?'1':'10');url.searchParams.set('_fields','material_id,formula_pretty,nsites,symmetry,energy_above_hull,is_stable,origins,last_updated'+(structure?',structure':''));return url;
}
export function mpRecipe(doc){
 const s=doc.structure,m=s?.lattice?.matrix,sites=s?.sites;if(!Array.isArray(m)||m.length!==3||m.some(row=>!Array.isArray(row)||row.length!==3||row.some(v=>!Number.isFinite(v)))||!Array.isArray(sites)||!sites.length||sites.length>20000)throw Error('MP structure has invalid cell or atom count');
 const symbols=[],positions=[];for(const site of sites){if(site.species?.length!==1||site.species[0].occu!==1||!/^([A-Z][a-z]?)$/.test(site.species[0].element))throw Error('Disordered or partially occupied MP sites require an explicit scientific treatment');const f=site.abc;if(!Array.isArray(f)||f.length!==3||f.some(v=>!Number.isFinite(v)))throw Error('Invalid fractional coordinates');symbols.push(site.species[0].element);positions.push([0,1,2].map(j=>f.reduce((sum,x,i)=>sum+x*m[i][j],0)));}
 return {kind:'explicit',symbols,positions,cell:m,pbc:[true,true,true]};
}
function importBinding(worker,scope){
 const assertScope=()=>{if(scope!==undefined&&scope?.checkCurrent?.()!==true)throw Error('Materials Project import conversation changed');};
 assertScope();
 if(!worker?.connection||worker.connecting||worker.restoring)throw Error('Connect the selected worker before importing a material');
 const connection=worker.connection,epoch=worker.connectionEpoch,identity=structuredClone(worker.identity),target=structuredClone(worker.connectionTarget),source=worker.connectedSource;
 return ()=>{assertScope();if(worker.connection!==connection||worker.connectionEpoch!==epoch||worker.connecting||worker.restoring||!equal(worker.identity,identity)||!equal(worker.connectionTarget,target)||worker.connectedSource!==source)throw Error('Materials Project import worker changed');};
}
export class MaterialsProject{
 constructor({root,encryption,fetchApi=fetch,worker}){Object.assign(this,{root,encryption,fetchApi,worker});}
 get file(){return path.join(this.root,'materials-project.bin');}
 key(){if(fs.existsSync(this.file)){if(!this.encryption.isEncryptionAvailable())throw Error('System credential encryption unavailable');return this.encryption.decryptString(fs.readFileSync(this.file));}return process.env.MP_API_KEY||process.env.PMG_MAPI_KEY||'';}
 status(){return {configured:fs.existsSync(this.file)||!!(process.env.MP_API_KEY||process.env.PMG_MAPI_KEY),source:fs.existsSync(this.file)?'system-encrypted':'environment',endpoint:MP_ENDPOINT,validation:'not_run'};}
 save(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(value))throw Error('Enter a valid Materials Project key');if(!this.encryption.isEncryptionAvailable())throw Error('System credential encryption unavailable');fs.mkdirSync(this.root,{recursive:true});fs.writeFileSync(this.file+'.tmp',this.encryption.encryptString(value),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);return this.status();}
 clear(){if(fs.existsSync(this.file))fs.unlinkSync(this.file);return this.status();}
 async query(query,structure=false){
  const key=this.key();if(!key)throw Error('Materials Project is blocked: configure its API key in Settings > Data sources');
  let response;try{response=await this.fetchApi(mpQuery(query,structure).href,{headers:{'X-API-KEY':key,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw Error('Materials Project request failed or timed out');}
  if(!response.ok)throw Error('Materials Project returned HTTP '+response.status);
  const chunks=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.byteLength;if(bytes>8*1024*1024)throw Error('Materials Project response exceeds 8 MiB');chunks.push(Buffer.from(chunk));}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Invalid Materials Project response');}
  if(!Array.isArray(body.data)||body.data.length>(structure?1:10))throw Error('Unexpected Materials Project result size');return {documents:body.data,meta:body.meta||{},query,retrieved_at:new Date().toISOString(),endpoint:MP_ENDPOINT};
 }
 async search(query){const result=await this.query(query);return {...result,documents:result.documents.map(d=>({material_id:d.material_id,formula:d.formula_pretty,n_atoms:d.nsites,symmetry:d.symmetry,energy_above_hull:d.energy_above_hull,is_stable:d.is_stable})),scope:'Candidate database structures; select the intended phase before import. MP DFT geometry does not establish compatibility with your MD potential.'};}
 async import({project_id,environment_id,material_id},scope){
  if(materialIdValue(material_id)===null)throw Error('Select a Materials Project ID');
  const assertCurrent=importBinding(this.worker,scope);
  const result=await this.query(material_id,true),doc=result.documents[0];if(!doc||materialIdValue(doc.material_id)!==materialIdValue(material_id))throw Error('Exact MP structure not found');
  const receipt={provider:'Materials Project',material_id:doc.material_id,requested_material_id:material_id,formula:doc.formula_pretty,origins:doc.origins,last_updated:doc.last_updated,retrieved_at:result.retrieved_at,endpoint:result.endpoint,response_sha256:createHash('sha256').update(JSON.stringify(doc)).digest('hex')};
  const data={project_id,environment_id,recipe:mpRecipe(doc),external_provenance:receipt};
  // The database lookup is asynchronous; its result cannot authorize a write on
  // a revoked provider lease or a worker selected while that lookup was pending.
  assertCurrent();
  const imported=await this.worker.request('POST','/api/structures/import-material',data);
  assertCurrent();return imported;
 }
 tools(){return [
  {name:'search_materials_project',description:'Search Materials Project by exact formula or mp-ID using the privately configured key. Returns real candidates (up to 10), never guesses IDs. If no key, report blocked and use ASE or user files. Choose the intended phase before import.',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false},annotations:{readOnlyHint:true}},
  {name:'import_materials_project',description:'Import a selected mp-ID as an ASE-validated extxyz asset with provenance and preview. Requires an authorized local project/environment. Does not relax, run MD or validate the potential.',inputSchema:{type:'object',properties:{project_id:{type:'string'},environment_id:{type:'string'},material_id:{type:'string'}},required:['project_id','environment_id','material_id'],additionalProperties:false},annotations:{readOnlyHint:false}}
 ];}
 async call(name,args,scope){if(name==='search_materials_project')return this.search(args.query);if(name!=='import_materials_project')throw Error('Unknown Materials Project tool');if(scope?.localReaders!==true||scope.checkCurrent?.()!==true)throw Error('Materials Project import requires the current provider conversation');return this.import(args,scope);}
}
