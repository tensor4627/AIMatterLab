"""Bounded CPU primitive-check command candidate, launched by the detached worker runner.
Only a main-process human action creates the exact one-use consent and snapshots.
"""
import hashlib,json,os,re,sys
from pathlib import Path
from .custom_cv_numerics import bounded_bytes


def atomic_json(path,value):
 raw=(json.dumps(value,ensure_ascii=False,allow_nan=False,indent=2)+'\n').encode('utf8')
 if len(raw)>256*1024:raise ValueError('Primitive report exceeds its bounded output scope')
 temporary=path.with_name(path.name+'.tmp')
 with temporary.open('xb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
 os.replace(temporary,path)


def main():
 if len(sys.argv)!=3 or not re.fullmatch('[0-9a-f]{64}',sys.argv[2]):raise ValueError('Exact payload snapshot identity required')
 payload_path=Path(sys.argv[1]).absolute();raw=bounded_bytes(payload_path,256*1024)
 if hashlib.sha256(raw).hexdigest()!=sys.argv[2]:raise ValueError('Primitive command payload changed after human approval')
 payload=json.loads(raw);directory=Path.cwd().resolve();attempt=directory.parent
 if directory.name!='results'or payload_path.parent!=attempt/'simulation':raise ValueError('Primitive command requires the owned snapshot/results layout')
 for key in ('code_path','structure_file'):
  target=Path(payload[key]).absolute()
  if target.parent!=attempt/'simulation'or target.resolve()!=target or target.is_symlink():raise ValueError('Primitive input is outside its exact owned snapshot')
 if Path(payload['output_dir']).resolve()!=directory or payload.get('device')!='cpu':raise ValueError('This explicit authoring consent permits bounded CPU primitive checks only')
 consent=payload.get('consent',{})
 expected={key:payload[key]for key in('spec_sha256','code_sha256','parameters_sha256','structure_sha256','runtime_receipt_sha256')}
 if consent.get('kind')!='human_custom_cv_cpu_check'or consent.get('bindings')!=expected or consent.get('max_seconds')!=60 or consent.get('device')!='cpu':raise ValueError('Numerical payload differs from its exact one-use human consent')
 if not re.fullmatch('[0-9a-f]{64}',consent.get('sha256','')):raise ValueError('Missing one-use consent identity')
 unsigned={k:v for k,v in consent.items()if k!='sha256'}
 canonical=(json.dumps(unsigned,ensure_ascii=False,sort_keys=True,allow_nan=False,indent=2)+'\n').encode('utf8')
 if hashlib.sha256(canonical).hexdigest()!=consent['sha256']:raise ValueError('One-use consent content changed')
 # The runner enforces the wall-clock/process-group lifetime; per-file output
 # limits and CPU selection apply even if the desktop or controller exits.
 import resource
 resource.setrlimit(resource.RLIMIT_FSIZE,(8*1024*1024,8*1024*1024))
 os.environ['CUDA_VISIBLE_DEVICES']='';os.environ['OMP_NUM_THREADS']='1';os.environ['MKL_NUM_THREADS']='1';os.environ['PYTHONDONTWRITEBYTECODE']='1'
 report_path=directory/'report.json'
 try:
  from .custom_cv_numerics import check
  report=check(payload)
  checked=next(check for check in report['checks']if check['name']=='coordinate_finite_difference')
  if checked['atom_indices']!=consent.get('fd_atom_indices'):raise ValueError('Actual finite-difference coverage differs from the human consent')
  report.update(consent_sha256=consent['sha256'],runtime_receipt_sha256=payload['runtime_receipt_sha256'],project_id=consent['project_id'],workspace_id=consent['workspace_id'],environment_id=consent['environment_id'],structure_asset_id=payload.get('structure_asset_id'))
 except Exception as error:
  report={'status':'failed','reason':str(error)[:2000],**expected,'consent_sha256':consent['sha256'],'scope':'Failed bounded primitive check; no reusable, physical or consuming-engine validation'}
 atomic_json(report_path,report);print(json.dumps({'status':report['status'],'report_sha256':hashlib.sha256(report_path.read_bytes()).hexdigest(),'scope':'CPU primitive only; see exact report checks'},allow_nan=False))
 return 0 if report['status']=='passed'else 1

if __name__=='__main__':sys.exit(main())
