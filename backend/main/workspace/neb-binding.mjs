import {isDeepStrictEqual} from 'node:util';
import {inputControlParameters} from "../../../contracts/compute/deployment.mjs";

// Pre-0.17 unstarted drafts could anchor aliases which the NEB checker rejected.
// Correct only that exact invalid schema; never drop arbitrary unknown controls.
export function legacyNebCorrection(task,prior,next){
 const binding=task.inputBinding;if(!binding||task.parameters?.engine!=='gpumd.neb'||binding.contractVersion||!prior||prior.engine!=='gpumd.neb'||prior.status!=='draft'||prior.validation?.status!=='failed'||prior.identity||prior.started_at||prior.exit_code!==undefined&&prior.exit_code!==null)return false;
 if(!/^Declared NEB parameter differs from run.in or is unsupported: (driver|fixed_cell|intermediate_images|total_images)$/.test(prior.validation.message||''))return false;
 if(Object.values(task.manualEdits||{}).some(revision=>revision>(binding.parameterRevision||0)))return false;
 const old=inputControlParameters(binding.parameters),current=inputControlParameters(next);
 if(Object.keys(old).some(key=>!['structure','potential','neb'].includes(key))||Object.keys(current).some(key=>key!=='neb'))return false;
 if(!old.structure||!old.potential||!old.neb||!current.neb||Object.keys(old.structure).some(key=>!['initial','final','atom_count','cell_A','pbc'].includes(key))||Object.keys(old.potential).some(key=>key!=='file'))return false;
 const snap=(prior.snapshots||[]).map(({name,sha256})=>({name,sha256})).sort((a,b)=>a.name.localeCompare(b.name));if(!isDeepStrictEqual(snap,binding.hashes))return false;
 const points=(value,name)=>typeof value==='string'&&(prior.snapshots||[]).some(file=>file.name===name&&value===file.source);
 if(!points(old.neb.driver,'run.in')||!points(old.structure.initial,'is.xyz')||!points(old.structure.final,'fs.xyz')||!points(old.potential.file,'nep.txt'))return false;
 const neb={...old.neb};delete neb.driver;
 if(typeof neb.fixed_cell!=='boolean'||!Number.isSafeInteger(neb.intermediate_images)||neb.intermediate_images<0||neb.total_images!==neb.intermediate_images+2)return false;
 const mode=neb.fixed_cell?'fixed':'variable';if(neb.cell_mode!==undefined&&neb.cell_mode!==mode||neb.interpolate!==undefined&&neb.interpolate!==neb.intermediate_images)return false;
 neb.cell_mode=mode;neb.interpolate=neb.intermediate_images;delete neb.fixed_cell;delete neb.intermediate_images;delete neb.total_images;
 return isDeepStrictEqual(neb,current.neb);
}
