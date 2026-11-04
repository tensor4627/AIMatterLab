"""Finite-difference evidence for serialized dictionary-ABI biases, not engine parity."""
def check(payload):
 import torch
 import numpy as np
 from ase.io import read
 from ase.neighborlist import neighbor_list
 from pathlib import Path
 if payload.get("engine")=="pydyn.sampling":
  from pydyn.sampling.base.artifact import ArtifactRunner
 else:
  from base.artifact import ArtifactRunner
 if str(payload["bias_file"]).endswith(".pt2"):
  raise ValueError("AOTI finite differences require an explicit fixed-capacity target preflight")
 atoms=read(payload["structure_file"])
 device=torch.device("cuda")
 runner=ArtifactRunner(payload["bias_file"],device=device)
 positions=torch.tensor(atoms.positions,device=device,dtype=torch.float64)
 cell=torch.tensor(atoms.cell.array,device=device,dtype=torch.float64)
 i,j=neighbor_list("ij",atoms,payload["cutoff"],self_interaction=False)
 edges=torch.as_tensor(np.stack((i,j),axis=1),device=device,dtype=torch.int64)
 cv_size=int(payload["cv_size"])
 history=np.loadtxt(payload["validation_history"],ndmin=2) if payload.get("validation_history") else np.zeros((0,cv_size+1))
 if history.shape[1]!=cv_size+1:raise ValueError("History columns must be bias followed by CV order")
 def evaluate(pos,box):
  return runner({"positions":pos,"cell":box,"side_array":edges,
   "cv_traj":torch.tensor(history[:,1:],device=device,dtype=torch.float64),
   "bias_traj":torch.tensor(history[:,0],device=device,dtype=torch.float64),
   "saved_cv_nums":torch.tensor(len(history),device=device,dtype=torch.int32)})
 output=evaluate(positions,cell)
 if __package__:
  from .tools.derivative_selection import selection,validate_controls,validate_cell_group
 else:
  from tools.derivative_selection import selection,validate_controls,validate_cell_group
 coverage=selection(payload,len(atoms));indices=coverage['indices'];controls=validate_controls(payload)
 step=float(controls.get("fd_step",payload.get("fd_step",1e-5)));tolerance=float(controls.get("fd_atol",payload.get("fd_atol",1e-4)))
 if not 0<step<.01 or not 0<tolerance<.1:raise ValueError("Invalid finite-difference tolerances")
 # Capture bounded CPU primitives before any later forward may reuse an output buffer.
 response_evidence={"bias_sum":float(output["bias"].sum()),"force_atom_indices":list(indices),
  "force_vectors":[[float(output["forces"][index,axis])for axis in range(3)]for index in indices],
  "force_max_abs":max(abs(float(output["forces"][index,axis]))for index in indices for axis in range(3)),
  "virial":[float(output["virial"].flatten()[component])for component in range(9)],
  "virial_max_abs":max(abs(float(output["virial"].flatten()[component]))for component in range(9)),
  "validation_history_rows":int(len(history)),
  "scope":"Initial unperturbed serialized output copied before finite differences; only the listed force atoms and all nine ABI virial components. Actual response values, not reference values. No minimum-response, engine-parity or physical-validity criterion is inferred."}
 errors=[]
 for index in indices:
  for axis in range(3):
   plus,minus=positions.clone(),positions.clone();plus[index,axis]+=step;minus[index,axis]-=step
   gradient=(float(evaluate(plus,cell)["bias"].sum())-float(evaluate(minus,cell)["bias"].sum()))/(2*step)
   errors.append(abs(gradient+float(output["forces"][index,axis])))
 contract=payload.get('_studio_cell_contract')
 convention='fixed_cartesian_positions_legacy_literal_ABI'
 if contract is not None:
  from hashlib import sha256
  if contract.get('schema')!='studio.cell-derivative/1' or contract.get('convention')!='fixed_fractional_positions' or sha256(Path(payload['bias_file']).read_bytes()).hexdigest()!=contract.get('artifact_sha256') or sha256(Path(payload['structure_file']).read_bytes()).hexdigest()!=contract.get('structure_sha256'):raise ValueError('Worker-derived cell derivative contract does not match actual serialized inputs')
  validate_cell_group(contract,payload,len(atoms))
  for key in ('bias_file','structure_file','validation_history'):
   if payload.get(key) and sha256(Path(payload[key]).read_bytes()).hexdigest()!=contract.get('run_snapshot_sha256',{}).get(Path(payload[key]).name):raise ValueError('Worker cell contract differs from current validation input: '+key)
  convention='fixed_fractional_positions';fractional=torch.matmul(positions.detach(),torch.linalg.inv(cell.detach()))
 gradient=torch.zeros_like(cell)
 for row in range(3):
  for column in range(3):
   plus,minus=cell.clone(),cell.clone();plus[row,column]+=step;minus[row,column]-=step
   plus_positions=torch.matmul(fractional,plus) if contract is not None else positions
   minus_positions=torch.matmul(fractional,minus) if contract is not None else positions
   gradient[row,column]=(evaluate(plus_positions,plus)["bias"].sum()-evaluate(minus_positions,minus)["bias"].sum())/(2*step)
 expected=(cell.T@(-gradient)).flatten()[torch.tensor([0,4,8,1,2,5,3,6,7],device=device)]
 virial_error=float((expected-output["virial"]).abs().max())
 force_error=max(errors)
 if not np.isfinite(force_error+virial_error) or max(force_error,virial_error)>tolerance:
  raise ValueError(f"Finite differences failed: force={force_error}, virial={virial_error}, atol={tolerance}")
 if "cv_reference" in payload:
  if not np.allclose(output["cv_now"].cpu().numpy(),payload["cv_reference"],atol=tolerance,rtol=0):
   raise ValueError("Declared CV reference does not match serialized model")
 return {"status":"passed","device":"cuda","force_max_abs_error":force_error,"virial_max_abs_error":virial_error,
  "response_evidence":{**response_evidence,"cell_derivative_convention":convention},
  "cell_derivative_convention":convention,"cell_derivative_contract":contract,"fd_step":step,"atol":tolerance,"force_checked_atom_indices":indices,"force_check_coverage":coverage,"cv":output["cv_now"].cpu().tolist(),
  "scope":"Fixed real neighbor graph and listed sampled forces. Cell FD convention is explicitly reported: source-proven affine strain for the narrow matched graph, otherwise only the legacy literal fixed-Cartesian ABI derivative. No universal physical-virial, dynamics or restart proof"}
