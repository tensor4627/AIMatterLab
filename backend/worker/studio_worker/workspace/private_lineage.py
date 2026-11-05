"""Conservative worker-owned private provenance across managed copies and runs."""
import copy,hashlib,json
from pathlib import Path



def current_rows(service):
 rows=service.store.list('private-cv-lineage')
 direct={(row['entry_id'],row['workspace_id'],row['project_id'])for row in rows if not row.get('source_project_id')}
 # Old same-project copy rows are redundant aliases of a mutable canonical pair,
 # not an independent grant. Keep them on disk for audit; never grant old runs.
 return [row for row in rows if not(not row.get('versioned_copy')and row.get('source_project_id')==row['project_id']and(row['entry_id'],row['workspace_id'],row['project_id'])in direct)]


def versions_for(service,paths):
 sources=[Path(value).expanduser().resolve()for value in paths];result=[];rows=current_rows(service)
 for source in sources:
  matched=False
  for run in service.store.runs():
   directory=Path(run['directory'])
   if source==directory or directory in source.parents:
    versions=run.get('private_cv_versions')
    if not versions:
     identifiers=run.get('private_cv_entries')or[row['entry_id']for row in rows if row['project_id']==run['project_id']]
     versions=[{'entry_id':entry,'version_status':'unknown'}for entry in identifiers]
    result.extend(copy.deepcopy(versions));matched=True
  if matched:continue
  for row in rows:
   root=service.root/'projects'/row['project_id']/'inputs'
   if source==root or root in source.parents or str(source)in row.get('paths',[]):result.append({'entry_id':row['entry_id'],**copy.deepcopy(row['bindings'])})
 unique={json.dumps(value,sort_keys=True):value for value in result}
 return [unique[key]for key in sorted(unique)]


def propagate(service,paths,target_project):
 rows=current_rows(service)
 if not rows:return []
 sources=[Path(value).expanduser().resolve()for value in paths];runs=service.store.runs();selected=[]
 for row in rows:
  own=service.root/'projects'/row['project_id']/'inputs'
  directories=[own,*[Path(run['directory'])for run in runs if run['project_id']==row['project_id']]]
  exact={Path(value).resolve()for value in row.get('paths',[])}
  if any(source in exact or any(source==base or base in source.parents for base in directories)for source in sources):selected.append(row)
 # Persist BEFORE copying any bytes. Keep these records if a later prepare fails.
 versions=versions_for(service,paths)
 for row in selected:
  actual=[{key:value for key,value in version.items()if key!='entry_id'}for version in versions if version['entry_id']==row['entry_id']]or[row['bindings']]
  for version in actual:
   if row['project_id']==target_project and version==row['bindings']:continue
   identifier=hashlib.sha256((row['entry_id']+'|'+row['workspace_id']+'|'+target_project+'|'+json.dumps(version,sort_keys=True)).encode()).hexdigest()[:24]
   service.store.put('private-cv-lineage',{**copy.deepcopy(row),'id':identifier,'project_id':target_project,'source_project_id':row['project_id'],'versioned_copy':True,'bindings':version,'scope':'Exact private source version propagated before managed input/adoption/run copy. Historical versions remain blocked unless separately authorized; no grant is inferred from newer sharing.'})
 return sorted({row['entry_id']for row in selected})


def check_producer(service,spec):
 """A copied custom build must retain its owned graph/source/module identities."""
 graph_file=spec.get('inputs',{}).get('workflow.json')
 if spec['engine']!='pygas.build'or not graph_file:return
 import json
 from studio_worker.tools.custom_cv_numerics import bounded_bytes
 graph=json.loads(bounded_bytes(graph_file,1024*1024))
 if not graph.get('metadata',{}).get('studio_custom_cvs'):return
 from studio_worker.workspace.custom_cv_graph import approved
 rows=service.store.list('private-cv-lineage');bindings=graph['metadata']['studio_custom_cvs']
 candidates=[row for row in rows if row['entry_id']in {b.get('id')for b in bindings}and row.get('attachment_binding')in bindings]
 own=next((row for row in candidates if (service.root/'projects'/row['project_id']/'inputs'/('cv-'+row['workspace_id'])/'workflow.json').is_file()),None)
 if not own:raise ValueError('Private build has no authoritative owned composition provenance')
 library=__import__('studio_worker.custom_cv_graph',fromlist=['controller']).controller(service).library
 environment_id=spec['environment_id']
 selected=approved(service,graph,own['project_id'],own['workspace_id'],environment_id)
 original=service.root/'projects'/own['project_id']/'inputs'/('cv-'+own['workspace_id'])
 for name in ['workflow.json','build_bias.py',*[entry['binding']['module_file']for entry in selected]]:
  chosen=spec['inputs'].get(name)
  if not chosen or hashlib.sha256(bounded_bytes(chosen,1024*1024)).digest()!=hashlib.sha256(bounded_bytes(original/name,1024*1024)).digest():raise ValueError('Private build input differs from its currently reviewed canonical composition: '+name)
