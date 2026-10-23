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
 if name=='read_runtime_guide':return guide_for_agent(result)
 if name=='probe_environment':
  return {'runtime_guide':guide_for_agent(result['runtime_guide']),'scope':'Actual selected probe performed in its registered runtime; see its observed, stale or blocked receipt. This does not install or authorize a calculation.'}
 return result
