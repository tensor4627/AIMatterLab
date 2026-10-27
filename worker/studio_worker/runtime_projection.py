"""Concise selected-runtime tool replies, preserving full HTTP evidence."""
import copy
FACTS={'schema_version','environment_id','engine','configuration_sha256','observed_at','state','probe_status','probe_attempted_at','failure_type','reason','python','executables','modules','repositories','native_runtime','capabilities','cuda','source_build_relation','scientific_status','scope','file_observations_status'}
def guide_for_agent(value):
 result={key:copy.deepcopy(value[key])for key in('status','environment_id','engine','receipt','skill_sha256','reason','scope')if key in value}
 facts=value.get('facts')
 if isinstance(facts,dict):result['facts']={key:copy.deepcopy(facts[key])for key in sorted(FACTS)if key in facts}
 result['evidence_scope']='Compact projection of the actual selected-runtime receipt. File-watch inventories and installer body are omitted; full evidence remains worker-owned. No artifact, target, scientific or execution permission is inferred.'
 return result

def result_for_agent(name,result):
 if name in ('compute_readiness','discover_local_environments'):
  def compact(entry):
   observed=entry.get('observation') or entry.get('discovery',{}).get('observation',{})
   return {key:value for key,value in {'id':entry.get('id'),'name':entry.get('name') or entry.get('spec',{}).get('name'),'status':entry.get('status'),'python':entry.get('python') or entry.get('executables',{}).get('python'),'cuda':observed.get('cuda',{}),'modules':{key:item.get('available') for key,item in observed.get('modules',{}).items()},'scientific_status':'not_run','reason':entry.get('reason')}.items() if value is not None}
  if name=='discover_local_environments':return {key:result[key] for key in ('identity','observed_at','cached','scope')}|{'entries':[compact(entry) for entry in result['entries']]}
  return {'environments':[compact(entry) for entry in result['environments']],'clusters':[{key:entry.get(key) for key in ('id','name','scheduler','version','queue','connection_check')} for entry in result['clusters']],'scope':result['scope']}
 if name=='read_runtime_guide':return guide_for_agent(result)
 if name=='probe_environment':
  return {'runtime_guide':guide_for_agent(result['runtime_guide']),'scope':'Actual selected probe performed in its registered runtime; see its observed, stale or blocked receipt. This does not install or authorize a calculation.'}
 return result
