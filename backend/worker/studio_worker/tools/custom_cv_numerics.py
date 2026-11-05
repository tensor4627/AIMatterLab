"""Private CV numerical check; executed only by a human-gated worker runner.
Checks a saved primitive, not a whole pyGAS bias or consuming MD implementation.
"""
def bounded_bytes(path,limit):
 import os,stat
 from pathlib import Path
 path=Path(path).absolute()
 if path.is_symlink()or path.resolve()!=path:raise ValueError('Linked numerical input refused')
 descriptor=os.open(path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
 try:
  before=os.fstat(descriptor)
  if not stat.S_ISREG(before.st_mode)or before.st_size>limit:raise ValueError('Numerical input exceeds bounded regular-file scope')
  with os.fdopen(descriptor,'rb',closefd=False)as stream:raw=stream.read(limit+1)
  after=os.fstat(descriptor);current=path.stat()
  if len(raw)>limit or path.is_symlink()or path.resolve()!=path or (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns)or(after.st_dev,after.st_ino)!=(current.st_dev,current.st_ino):raise ValueError('Numerical input changed during bounded read')
 finally:os.close(descriptor)
 return raw


def check(payload):
 import hashlib,json,sys,types,linecache
 from pathlib import Path
 import torch,numpy as np
 from ase.io import read
 path=Path(payload['code_path']);raw=bounded_bytes(path,65536)
 if path.is_symlink() or len(raw)>65536 or hashlib.sha256(raw).hexdigest()!=payload['code_sha256']:raise ValueError('Approved implementation snapshot changed')
 structure_raw=bounded_bytes(payload['structure_file'],4*1024*1024)
 atoms=read(payload['structure_file'],index=0)
 if bounded_bytes(payload['structure_file'],4*1024*1024)!=structure_raw:raise ValueError('Reference structure changed during ASE read')
 if not 1<=len(atoms)<=256:raise ValueError('Primitive numerical examples support1..256 atoms')
 spec=payload['spec']
 from studio_worker.tools.custom_formula import referenced_atoms,fd_atoms,expression_type,schema,sha,parameter_values,module_source
 spec=schema(spec);values,_=parameter_values(spec,payload['parameter_values'])
 generated=module_source(spec)
 if sha(spec)!=payload['spec_sha256']or sha(values)!=payload['parameters_sha256']or generated['code_sha256']!=payload['code_sha256']or generated['class_name']!=payload['class_name']:raise ValueError('Numerical payload differs from the approved specification, values or deterministic implementation')
 if payload.get('structure_sha256')and hashlib.sha256(structure_raw).hexdigest()!=payload['structure_sha256']:raise ValueError('Numerical reference structure snapshot changed')
 expression_type(spec,values)
 indices=referenced_atoms(spec,payload['parameter_values'],len(atoms))
 if not indices:indices=list(spec['atom_selection'])
 if any(not 0<=i<len(atoms)for i in indices):raise ValueError('Formula atom group exceeds actual reference structure')
 if abs(np.linalg.det(atoms.cell.array))<1e-9:raise ValueError('Generated primitive affine-cell AD needs a nonsingular reference cell; prepare a reviewed vacuum box for a nonperiodic molecule')
 if spec['pbc']=='row_mic' and not all(atoms.pbc):raise ValueError('This explicit row_mic definition needs full periodicity')
 selected=fd_atoms(indices)
 device=torch.device(payload.get('device','cpu'))
 if str(device)not in ('cpu','cuda'):raise ValueError('Explicit cpu/cuda primitive check only')
 if device.type=='cuda'and not torch.cuda.is_available():raise ValueError('Selected runtime CUDA unavailable')
 name='studio_private_check_'+payload['code_sha256'][:16];module=types.ModuleType(name);virtual=str(Path(payload['output_dir'])/'approved_primitive.py');module.__file__=virtual;sys.modules[name]=module
 # Execute only the bytes already checked against the deterministic generator.
 # A disk change between read and import cannot substitute another module.
 linecache.cache[virtual]=(len(raw),None,raw.decode('utf8').splitlines(keepends=True),virtual)
 try:
  exec(compile(raw.decode('utf8'),virtual,'exec'),module.__dict__)
  model=getattr(module,payload['class_name'])(**payload['parameter_values']).to(device=device,dtype=torch.float64).eval()
  artifact=Path(payload['output_dir'])/'primitive.pt';artifact.parent.mkdir(parents=True,exist_ok=True);torch.jit.script(model).save(str(artifact));loaded=torch.jit.load(str(artifact),map_location=device).eval()
  positions=torch.tensor(atoms.positions,device=device,dtype=torch.float64);cell=torch.tensor(atoms.cell.array,device=device,dtype=torch.float64);edges=torch.empty((0,2),device=device,dtype=torch.long)
  def value(pos,box):
   output=loaded(pos,box,edges)
   if output.shape!=(spec['output_size'],)or not torch.isfinite(output).all():raise ValueError('Primitive output shape/finiteness differs from the confirmed definition')
   return output
  eager=model(positions,cell,edges);baseline=value(positions,cell);reload_error=float((baseline-eager).abs().max())
  step=1e-5;atol=1e-5;force_errors=[];cell_errors=[];fractions=torch.matmul(positions,torch.linalg.inv(cell))
  for component in range(spec['output_size']):
   pos=positions.detach().clone().requires_grad_(True);box=cell.detach().clone().requires_grad_(True);out=value(pos,box)[component]+0*pos.sum()+0*box.sum();dp,dh=torch.autograd.grad(out,(pos,box))
   for index in selected:
    for axis in range(3):
     plus,minus=positions.clone(),positions.clone();plus[index,axis]+=step;minus[index,axis]-=step
     numeric=(value(plus,cell)[component]-value(minus,cell)[component])/(2*step);force_errors.append(abs(float(numeric)-float(dp[index,axis])))
   for row in range(3):
    for column in range(3):
     plus,minus=cell.clone(),cell.clone();plus[row,column]+=step;minus[row,column]-=step
     numeric=(value(torch.matmul(fractions,plus),plus)[component]-value(torch.matmul(fractions,minus),minus)[component])/(2*step);cell_errors.append(abs(float(numeric)-float(dh[row,column])))
  force_error=max(force_errors,default=0.);cell_error=max(cell_errors,default=0.)
  checks=[{'name':'serialized_primitive_reload','status':'passed'if reload_error<=atol else'failed','max_error':reload_error},{'name':'finite_fixed_size','status':'passed'},{'name':'coordinate_finite_difference','status':'passed'if force_error<=atol else'failed','max_error':force_error,'atom_indices':selected},{'name':'fixed_fractional_cell_total_derivative','status':'passed'if cell_error<=atol else'failed','max_error':cell_error,'scope':'Generated primitive affine-cell total derivative on the recorded example; full pyGAS bias virial and actual consuming target remain separate checks'}]
  if 'translation'in spec.get('invariances',[]):
   shift=torch.tensor([.013,-.017,.023],device=device,dtype=torch.float64);error=float((value(positions+shift,cell)-baseline).abs().max());checks.append({'name':'declared_translation','status':'passed'if error<=atol else'failed','max_error':error})
  if 'rotation'in spec.get('invariances',[]):
   angle=torch.tensor(.17,device=device,dtype=torch.float64);c,s=torch.cos(angle),torch.sin(angle);R=torch.stack([torch.stack([c,-s,c*0]),torch.stack([s,c,c*0]),torch.stack([c*0,c*0,c*0+1])]);error=float((value(positions@R,cell@R)-baseline).abs().max());checks.append({'name':'declared_rotation','status':'passed'if error<=atol else'failed','max_error':error})
  if 'periodic_translation'in spec.get('invariances',[]):
   errors=[]
   for index in selected:
    for row in range(3):
     moved=positions.clone();moved[index]+=cell[row];errors.append(float((value(moved,cell)-baseline).abs().max()))
   error=max(errors,default=0.);checks.append({'name':'declared_periodic_translation','status':'passed'if error<=atol else'failed','max_error':error,'atom_indices':selected})
  independent=payload.get('cv_reference');reference_provenance=payload.get('reference_provenance')
  if payload.get('reference_kind')=='ase-distance':
   from studio_worker.tools.custom_reference import ase_reference
   observed=ase_reference(spec,values,atoms);independent=observed['values'];reference_provenance=observed['provenance']
  if independent is not None:
   reference=torch.tensor(independent,device=device,dtype=torch.float64)
   if reference.shape!=baseline.shape:raise ValueError('Independent reference shape differs')
   error=float((reference-baseline).abs().max());checks.append({'name':'independent_CV_reference','status':'passed'if error<=atol else'failed','max_error':error})
  else:checks.append({'name':'independent_CV_reference','status':'not_run','reason':'No independently justified reference values were supplied'})
  self_status='failed'if any(c['status']=='failed'for c in checks if c['name']!='independent_CV_reference')else'passed'
  reference_status=next(c['status']for c in checks if c['name']=='independent_CV_reference')
  return {'status':'failed'if self_status=='failed'or reference_status=='failed'else'blocked'if reference_status!='passed'else'passed','numerical_self_consistency':{'status':self_status},'independent_reference':{'status':reference_status,'provenance':reference_provenance},'reusable_primitive':{'status':'passed'if self_status=='passed'and reference_status=='passed'else'blocked','scope':'Requires saved primitive self-consistency plus independently justified reference. Full consuming pyGAS bias/target gates are still mandatory.'},'device':str(device),'torch_version':str(torch.__version__),'cv':baseline.detach().cpu().tolist(),'checks':checks,'fd_step':step,'atol':atol,'serialized_sha256':hashlib.sha256(artifact.read_bytes()).hexdigest(),'structure_sha256':hashlib.sha256(structure_raw).hexdigest(),'code_sha256':payload['code_sha256'],'spec_sha256':payload['spec_sha256'],'parameters_sha256':payload['parameters_sha256'],'stable_phase':{'status':'not_run','scope':'Optional separately approved stable-phase/reference comparison; local numerical checks do not establish discrimination or physical suitability'},'target_bias_and_MD':{'status':'not_run'},'scope':'Saved primitive/derivative/reference checks only on the recorded example, not full pyGAS ABI, physical virial or production validation'}
 finally:
  sys.modules.pop(name,None);linecache.cache.pop(virtual,None)
if __name__=='__main__':
 import sys,json
 print(json.dumps(check(json.load(sys.stdin)),allow_nan=False))
