"""Concise selected-runtime metadata views; raw HTTP receipts stay unchanged."""
import copy
import hashlib
import json
import math
import re

FACTS={'schema_version','environment_id','engine','configuration_sha256','observed_at','state','probe_status','probe_attempted_at','failure_type','reason','python','executables','modules','repositories','native_runtime','capabilities','cuda','source_build_relation','scientific_status','scope','file_observations_status'}
KNOWN_SOFTWARE={'pydyn','pygas','hotpp','gpumd','torchnep'}
KNOWN_MODULES={'torch','cupy','ase','pydyn','pygas','hotpp'}
KNOWN_EXECUTABLES={'python','gpumd','gpu-sampling','nep','hotpp'}
PYGAS_FLAGS={'CVOnlyProcedure','MetaDProcedure','WTMetaDProcedure','OPESProcedure','export_model_bundle'}


def _text(value,limit=4096):
    if value is not None and (not isinstance(value,str) or '\0' in value or len(value.encode('utf-8'))>limit):
        raise ValueError('Runtime metadata requires a bounded string or null')
    return value


def _flag(value):
    if value is not None and type(value)is not bool:
        raise ValueError('Runtime metadata flag requires boolean or null')
    return value


def _hash(value):
    if value is not None and (not isinstance(value,str)or re.fullmatch(r'[a-f0-9]{64}',value)is None):
        raise ValueError('Runtime metadata requires SHA256 or null')
    return value


def _commit(value):
    if value is not None and (not isinstance(value,str)or re.fullmatch(r'[a-f0-9]{40}|[a-f0-9]{64}',value)is None):
        raise ValueError('Runtime metadata requires commit identity or null')
    return value


def _number(value):
    if value is not None and (type(value)not in(int,float)or not math.isfinite(value)or value<0):
        raise ValueError('Runtime metadata requires a finite nonnegative number or null')
    return value


def _roles(value):
    if not isinstance(value,list)or len(value)>256:
        raise ValueError('Runtime metadata requires a bounded role list')
    return [_text(item,128)for item in value]


def _record(value,fields):
    if not isinstance(value,dict):
        raise ValueError('Runtime metadata record must be an object')
    return {key:check(value[key])for key,check in fields.items()if key in value}


def _source_path(item,key,role):
    if key not in item:return
    path=item[key]
    if path is None:
        # Missing optional module/sampling origin remains genuine unavailability.
        item[key+'_identity']={'role':role,'available':False,'redacted':False}
        return
    del item[key]
    item[key+'_identity']={'role':role,'available':True,'path_sha256':hashlib.sha256(path.encode('utf-8')).hexdigest(),'redacted':True}


def _identity(value,arguments):
    if not isinstance(value,dict):raise ValueError('Runtime guide must be an object')
    facts=value.get('facts')
    if arguments is not None:
        if value.get('status')not in('observed','blocked','stale','not_run'):raise ValueError('Invalid runtime guide status')
        if value.get('status')=='observed'and not isinstance(facts,dict):raise ValueError('Observed runtime guide requires receipt facts')
        for key,expected in(('environment_id',arguments.get('environment_id')),('engine',arguments.get('engine','pydyn.md'))):
            if key in value and value[key]!=expected:raise ValueError('Runtime metadata differs from selected identity')
            if isinstance(facts,dict)and facts.get(key)!=expected:raise ValueError('Runtime metadata facts differ from selected identity')
        if isinstance(facts,dict):
            receipt=_hash(value.get('receipt'))
            if receipt is None or hashlib.sha256((json.dumps(facts,ensure_ascii=False,indent=2)+'\n').encode('utf-8')).hexdigest()!=receipt:
                raise ValueError('Runtime metadata raw receipt identity differs')
            if facts.get('state')!=value.get('status'):raise ValueError('Runtime metadata state differs from raw receipt')
    if isinstance(facts,dict):
        for key in('environment_id','engine'):
            if key in value and key in facts and value[key]!=facts[key]:raise ValueError('Runtime metadata outer identity differs')


def _facts(value):
    # Known scalar leaves only. Unknown future keys do not expose new bodies.
    result=_record(value,{
        'schema_version':_number,'environment_id':lambda v:_text(v,128),'engine':lambda v:_text(v,128),
        'configuration_sha256':_hash,'observed_at':_number,'state':lambda v:_text(v,64),
        'probe_status':lambda v:_text(v,64),'probe_attempted_at':_number,'failure_type':lambda v:_text(v,128),
        'reason':_text,'scientific_status':lambda v:_text(v,64),'scope':_text})
    for group,fields in{
        'python':{'executable':_text,'version':lambda v:_text(v,2048),'registration_match':_flag},
        'native_runtime':{'status':lambda v:_text(v,64),'executable':_text,'sha256':_hash,'scope':_text},
        'cuda':{'available':_flag,'version':lambda v:_text(v,512),'gpu':lambda v:_text(v,512)},
        'source_build_relation':{'status':lambda v:_text(v,64),'scope':_text},
        'file_observations_status':{'status':lambda v:_text(v,64),'unavailable_roles':_roles,'scope':_text},
    }.items():
        if group in value:result[group]=_record(value[group],fields)
    if 'executables'in value:result['executables']=_record(value['executables'],{key:_text for key in sorted(KNOWN_EXECUTABLES)})
    for group,names,fields,path_key,role in(
        ('repositories',KNOWN_SOFTWARE,{'path':_text,'commit':_commit,'dirty':_flag,'status':lambda v:_text(v,64)},'path','registered_source:'),
        ('modules',KNOWN_MODULES,{'file':_text,'version':lambda v:_text(v,512),'source_sha256':_hash,'status':lambda v:_text(v,64),'registration_match':_flag},'file','imported_module:'),
    ):
        if group not in value:continue
        if not isinstance(value[group],dict):raise ValueError('Runtime metadata group must be an object')
        result[group]={name:_record(item,fields)for name,item in value[group].items()if name in names}
        for name,item in result[group].items():_source_path(item,path_key,role+name)
    if 'capabilities'in value:
        capabilities=value['capabilities']
        if not isinstance(capabilities,dict):raise ValueError('Runtime capabilities must be an object')
        result['capabilities']={}
        if 'pygas'in capabilities:result['capabilities']['pygas']=_record(capabilities['pygas'],{name:_flag for name in sorted(PYGAS_FLAGS)})
        if 'sampling'in capabilities:result['capabilities']['sampling']=_flag(capabilities['sampling'])
        if 'pydyn_sampling'in capabilities:
            source=capabilities['pydyn_sampling'];sampling=_record(source,{'available':_flag,'origin':_text})
            if 'upstream'in source:sampling['upstream']=_record(source['upstream'],{'commit':lambda v:_text(v,512),'version':lambda v:_text(v,512)})
            _source_path(sampling,'origin','sampling_module_origin');result['capabilities']['pydyn_sampling']=sampling
    return result


def guide_for_agent(value,arguments=None):
    _identity(value,arguments)
    result=_record(value,{'status':lambda v:_text(v,64),'environment_id':lambda v:_text(v,128),'engine':lambda v:_text(v,128),
                          'receipt':_hash,'skill_sha256':_hash,'reason':_text,'scope':_text})
    facts=value.get('facts')
    if facts is not None:
        result['facts']=_facts(facts)
        for key in('environment_id','engine'):
            if key in facts:result[key]=facts[key]
    result['projection']={'kind':'runtime-metadata-view-v1','source_path_fields_redacted':True,
        'path_redaction_scope':'Only registered source paths, imported module files and sampling origin. Interpreter/native/executable paths remain guarded.',
        'receipt_scope':'Identity of raw worker receipt; this metadata view does not hash to that receipt'}
    result['evidence_scope']='Compact selected-runtime metadata. File-watch inventories and installer body omitted; full paths/evidence remain worker-owned. No artifact, target, scientific or execution permission inferred.'
    return result


def result_for_agent(name,result,arguments=None):
 if name in ('compute_readiness','discover_local_environments'):
  def compact(entry):
   observed=entry.get('observation') or entry.get('discovery',{}).get('observation',{})
   return {key:value for key,value in {'id':entry.get('id'),'name':entry.get('name') or entry.get('spec',{}).get('name'),'status':entry.get('status'),'python':entry.get('python') or entry.get('executables',{}).get('python'),'cuda':observed.get('cuda',{}),'modules':{key:item.get('available') for key,item in observed.get('modules',{}).items()},'scientific_status':'not_run','reason':entry.get('reason')}.items() if value is not None}
  if name=='discover_local_environments':return {key:result[key] for key in ('identity','observed_at','cached','scope')}|{'entries':[compact(entry) for entry in result['entries']]}
  return {'environments':[compact(entry) for entry in result['environments']],'clusters':[{key:entry.get(key) for key in ('id','name','scheduler','version','queue','connection_check')} for entry in result['clusters']],'scope':result['scope']}
 if name=='read_runtime_guide':return guide_for_agent(result,arguments)
 if name=='probe_environment':
  return {'runtime_guide':guide_for_agent(result['runtime_guide'],arguments),'scope':'Actual selected probe performed in its registered runtime; see its observed, stale or blocked receipt. This does not install or authorize a calculation.'}
 return result
