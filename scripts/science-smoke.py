"""Real WSL integration evidence, with synthetic EMT Cu data. Never a quality benchmark."""
import json, os, sys, time, uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def configure(config):
  # CLI/config validation runs before these optional scientific imports or writes.
  global BASE,FIX,PY,service,REPORT,build_bias,bulk,EMT,SinglePointCalculator,write,np,yaml
  sys.path.insert(0,str(ROOT/"backend/worker"))
  from studio_worker.service import Service
  from studio_worker.templates import build_bias
  from studio_worker.adapters import ENGINES
  from ase.build import bulk
  from ase.calculators.emt import EMT
  from ase.calculators.singlepoint import SinglePointCalculator
  from ase.io import write
  import numpy as np
  import yaml
  BASE=Path(config["base_dir"])
  BASE.mkdir(parents=True,exist_ok=True)
  FIX=BASE/"inputs";FIX.mkdir(exist_ok=True)
  PY=config["python"]
  launcher=BASE/"hotpp"
  launcher.write_text("#!"+PY+"\nfrom hotpp.entrypoints.main import main\nmain()\n");launcher.chmod(0o755)
  repos=config["repositories"]
  sampling=config["sampling_repository"]
  pygas_cli=BASE/"pygas"
  pygas_cli.write_text("#!"+PY+"\nfrom entrypoints.cli import main\nraise SystemExit(main())\n");pygas_cli.chmod(0o755)
  service=Service(BASE/"sessions"/uuid.uuid4().hex)
  environment=service.register_environment({"id":"acceptance-core","name":"Independent acceptance CUDA environment",
   "skills":config["skills"],
   "executables":{"python":PY,"hotpp":str(launcher),"pygas":str(pygas_cli),**config["executables"]},
   "repositories":repos})
  env2=service.register_environment({**environment,"id":"acceptance-sampling","name":"Pinned PyDyn sampling",
   "repositories":{**repos,"pydyn":sampling}})
  service.register_project({"id":"acceptance","name":"Synthetic Cu integration acceptance",
   "policy":{"engines":list(ENGINES),"environments":[environment["id"],env2["id"]],"gpus":[0],
   "input_roots":[str(BASE)],"max_seconds":180,"max_concurrent":1}})
  REPORT={"worker_root":str(service.root),"scope":"Infrastructure and scientific engine integration only. Ten synthetic EMT Cu frames; separate six-frame training, two-frame validation and two-frame held-out test; no DFT and no model accuracy claim.","checks":{}}

def evidence():
 (ROOT/".studio/validation").mkdir(parents=True,exist_ok=True)
 (ROOT/".studio/validation/science.json").write_text(json.dumps(REPORT,indent=2))
def task(name,engine,inputs,p=None,env="acceptance-core"):
 spec={"project_id":"acceptance","environment_id":env,"name":name,"engine":engine,
 "inputs":{k:str(v) for k,v in inputs.items()},"parameters":p or {},"gpu":0,"max_seconds":180,
 "idempotency_key":str(uuid.uuid4())}
 run=service.prepare(spec);run=service.validate(run["id"])
 if run["validation"]["status"]=="passed":service.submit(run["id"])
 deadline=time.monotonic()+195
 while time.monotonic()<deadline and run["status"] in ("ready","queued","running","unknown"):
  time.sleep(.3);run=service.store.run(run["id"])
 REPORT["checks"][name]={"status":run["status"],"run_id":run["id"],"directory":run["directory"],
 "validation":run["validation"],"exit":run.get("exit"),"log":service.log(run["id"])["text"][-4000:]}
 evidence();print(name,run["status"],flush=True)
 if run["status"]!="succeeded":
  print(REPORT["checks"][name]["log"],flush=True)
  raise RuntimeError(name+" failed")
 return Path(run["directory"])/"results"
def source(name,text):
 p=FIX/name;p.write_text(text);return p

def main():
 rng=np.random.default_rng(20261004);frames=[]
 for n in range(10):
  a=bulk("Cu","fcc",a=3.61,cubic=True).repeat((2,2,2))
  a.positions+=rng.normal(0,.01,a.positions.shape)
  a.calc=EMT();e=a.get_potential_energy();f=a.get_forces();stress=a.get_stress()
  a.calc=SinglePointCalculator(a,energy=e,forces=f,stress=stress)
  a.info["virial"]=(-a.get_volume()*a.get_stress(voigt=False)).reshape(9)
  frames.append(a)
 write(FIX/"model.xyz",frames[0]);write(FIX/"train.xyz",frames[:6]);write(FIX/"validation.xyz",frames[6:8]);write(FIX/"test.xyz",frames[8:])
 inputs={"train.xyz":FIX/"train.xyz","test.xyz":FIX/"validation.xyz",
 "nep.in":source("nep.in","type 1 Cu\nversion 4\ncutoff 4 3\nn_max 2 2\nbasis_size 3 3\nl_max 2 0 0\nneuron 8\nbatch 6\npopulation 10\ngeneration 100\n")}
 train=task("nep-train","nep.train",inputs)
 pred=task("nep-independent-test","nep.eval",{"train.xyz":FIX/"test.xyz","nep.in":source("predict.in",(FIX/"nep.in").read_text()+"prediction 1\n"),"nep.txt":train/"nep.txt"})
 REPORT["nep_test_metrics"]=service.inspect("acceptance","acceptance-core",str(pred),"regression");evidence()
 task("nep-publication-figure","nep.analyze",{n:pred/n for n in ("energy_train.out","force_train.out")})
 inventories={k:service.inspect("acceptance","acceptance-core",str(FIX/(k+".xyz")),"dataset") for k in ("train","validation","test")}
 assert not set(inventories["train"]["structure_hashes"]) & set(inventories["test"]["structure_hashes"])
 assert not set(inventories["validation"]["structure_hashes"]) & set(inventories["test"]["structure_hashes"])
 REPORT["dataset_audit"]={"frames":{k:v["frames"] for k,v in inventories.items()},"train_validation_test_disjoint":True,"reference":"ASE EMT; synthetic smoke only"}

 cfg={"cutoff":3.0,"seed":20261004,"device":"cuda","precision":"float",
 "Data":{"type":"ase","path":".","trainSet":"train.xyz","testSet":"validation.xyz","trainBatch":2,"testBatch":2,"numWorkers":0,"pinMemory":False},
 "Model":{"nLayer":1,"nEmbedding":8,"nHidden":8,"maxRWay":1,"maxOutWay":1,"CutoffLayer":{"type":"poly","p":5},"RadialLayer":{"type":"besselMLP","nBasis":4,"nHidden":[8],"activateFn":"silu"}},
 "Train":{"warmupSteps":0,"allowMissing":False,"targetProp":["energy","forces"],"weight":[.5,1.0],"maxEpoch":1,"maxStep":3,"logInterval":1,"evalEpochInterval":1,"evalStepInterval":1.0,"Optimizer":{"type":"AdamW","learningRate":.001},"LrScheduler":{"type":"reduceOnPlateau","lrFactor":.9,"patience":10}}}
 ht=task("hotpp-train","hotpp.train",{"input.yaml":source("input.yaml",yaml.safe_dump(cfg)),"train.xyz":FIX/"train.xyz","validation.xyz":FIX/"validation.xyz"})
 print("HotPP products",list(ht.rglob("*.pt")),list(ht.rglob("*.ckpt")),flush=True)
 models=list(ht.rglob("model.pt"))
 if not models:models=[p for p in ht.rglob("*.pt") if "infer" not in p.name]
 model=models[0]
 task("hotpp-independent-test","hotpp.eval",{"model.pt":model,"test.xyz":FIX/"test.xyz"},{"model_file":"model.pt","dataset_file":"test.xyz"})
 exported=task("hotpp-export","hotpp.export",{"model.pt":model},{"model_file":"model.pt","symbols":["Cu"]})
 common={"model.xyz":FIX/"model.xyz","ase-infer.pt":exported/"ase-infer.pt"}
 script="""from pathlib import Path
import cupy as cp
from ase.io import read
from pydyn.state import State
from pydyn.context import SimulationContext
from pydyn.dynamics import Simulation, VelocityVerlet, MaxwellBoltzmannDistribution
from pydyn.forces import ForceEvaluator
from pydyn.forces.hotpp_force import MiaoForceModel
from pydyn.neighbors.cuda_neighbor import CudaNeighborList
from pydyn.observers import TableLogger, TrajectoryWriter
cp.random.seed(20261004)
atoms=read('model.xyz')
state=State().from_atoms(atoms)
physical=MiaoForceModel(CudaNeighborList(len(atoms),128,3.0),'ase-infer.pt')
evaluator=ForceEvaluator.from_model(physical)
EXTRA
sim=Simulation(state=state,context=SimulationContext(target_temp=300),dt=.0001,initializer=[MaxwellBoltzmannDistribution(target_temp=300)],ensemble=VelocityVerlet(evaluator),observers=[TableLogger('thermo.out',{'Temp':lambda s:s.conditions.get_temperature(s.state)},interval=1),TrajectoryWriter('dump.xyz',interval=5)],HOOK)
sim.run(10)
SAVE
sim.finalize()
print('Completed',sim.step_count)
"""
 normal=script.replace("EXTRA","").replace(",HOOK","").replace("SAVE","")
 task("pydyn-md","pydyn.md",{**common,"run.py":source("md.py",normal)},{"model_file":"ase-infer.pt"})
 gpcommon={"model.xyz":FIX/"model.xyz","nep.txt":train/"nep.txt"}
 runin="potential nep.txt\nvelocity 300\ntime_step 0.1\nensemble nve\ndump_thermo 1\ndump_restart 5\ndump_exyz 5\nrun 10\n"
 task("gpumd-md","gpumd.md",{**gpcommon,"run.in":source("run.in",runin)})
 bp={"family":"umbrella","atom_i":0,"atom_j":1,"center":2.6,"force_constant":.1,"structure_file":"model.xyz","output_file":"bias.pt"}
 bias=task("pygas-umbrella-build","pygas.build",{"build_bias.py":source("build_bias.py",build_bias(bp)),"model.xyz":FIX/"model.xyz"},
 {**bp,"cv_definition":"MIC distance(0,1)","cv_units":["Angstrom"],"atom_selection":[0,1],"pbc_convention":"full3D","cutoff":3.0})
 parameters={"bias_file":"bias.pt","structure_file":"model.xyz","cv_size":1,"cutoff":3.0,"mode":"static","atom_selection":[0,1],"cv_reference":[float(frames[0].get_distance(0,1,mic=True))],"model_file":"ase-infer.pt"}
 gas=source("GAScfg.yaml","cv_log_interval: 1\ncv_storage_interval: 10\ncv_size: 1\nneighbor_rc: 3.0\nmax_neighbors: 128\nmax_cv_nums: 32\ncv_change_interval: 1\nn_atoms: 32\ndebug_interval: 0\n")
 task("gpumd-sampling","gpumd.sampling",{**gpcommon,"bias.pt":bias/"bias.pt","GAScfg.yaml":gas,
 "run.in":source("sample.in",runin.replace("ensemble nve","GASMD bias.pt GAScfg.yaml\nensemble nve"))},parameters)
 extra="""from pydyn.sampling import SamplingConfig,PyGASForceModel,BiasedForceEvaluator,save_checkpoint
config=SamplingConfig('static',tuple(map(int,atoms.numbers)),1,3.0,128)
bias=PyGASForceModel('bias.pt',config,CudaNeighborList(len(atoms),128,3.0),log_dir=Path('bias-logs'))
evaluator=BiasedForceEvaluator(evaluator,bias)
"""
 sampled=script.replace("EXTRA",extra).replace("HOOK","hooks=[bias]").replace("SAVE","save_checkpoint(sim,bias,Path('checkpoint.json'),physical_id='acceptance-hotpp')")
 sampled_result=task("pydyn-sampling","pydyn.sampling",{**common,"bias.pt":bias/"bias.pt","run.py":source("sampling.py",sampled)},parameters,"acceptance-sampling")
 checkpoint=json.loads((sampled_result/"checkpoint.json").read_text())
 continuation=sampled.replace("initializer=[MaxwellBoltzmannDistribution(target_temp=300)]","initializer=[]").replace("sim.run(10)","from pydyn.sampling import load_checkpoint\nload_checkpoint(sim,bias,Path('checkpoint.json'),physical_id='acceptance-hotpp')\nsim.run(5)")
 restored=service.resume(next(v["run_id"] for k,v in REPORT["checks"].items() if k=="pydyn-sampling"),
 {"checkpoint_files":["checkpoint.json"],"paired_manifest":"checkpoint.json","continuation_script":str(source("resume-sampling.py",continuation)),"idempotency_key":str(uuid.uuid4())})
 service.validate(restored["id"]);service.submit(restored["id"])
 while service.store.run(restored["id"])["status"] in ("queued","running"):
  time.sleep(.3)
 restored=service.store.run(restored["id"])
 REPORT["checks"]["pydyn-paired-restart"]={"status":restored["status"],"run_id":restored["id"],"directory":restored["directory"],"log":service.log(restored["id"])["text"][-3000:]}
 assert restored["status"]=="succeeded",REPORT["checks"]["pydyn-paired-restart"]
 REPORT["checks"]["reproduction-export"]={"status":"passed","bytes":len(service.export(restored["id"])["base64"])}
 full=task("pydyn-uninterrupted-15","pydyn.sampling",{**common,"bias.pt":bias/"bias.pt","run.py":source("full-sampling.py",sampled.replace("sim.run(10)","sim.run(15)"))},parameters,"acceptance-sampling")
 import torch
 def state_from(directory):
  manifest=json.loads((directory/"checkpoint.json").read_text())
  return torch.load(directory/manifest["files"]["md"]["path"],map_location="cpu",weights_only=True)["state"]
 resumed_state=state_from(Path(restored["directory"])/"results");full_state=state_from(full)
 differences={k:float((resumed_state[k]-full_state[k]).abs().max()) for k in ("r","p","box")}
 assert max(differences.values())<1e-10,differences
 REPORT["checks"]["pydyn-restart-parity"]={"status":"passed","max_abs_errors":differences,"scope":"This static umbrella NVE fixture only"}
 for family,choices in (("wall",{"lower":2.3,"upper":2.8,"force_constant":.1}),("metad",{"sigma":.1,"height":.001}),("wtmetad",{"sigma":.1,"height":.001,"temperature":300.0,"bias_factor":10.0})):
  template={**bp,**choices,"family":family,"output_file":family+".pt"}
  built=task("pygas-"+family+"-build","pygas.build",{"build_bias.py":source("build-"+family+".py",build_bias(template)),"model.xyz":FIX/"model.xyz"},
   {**template,"cv_definition":"MIC distance(0,1)","cv_units":["Angstrom"],"atom_selection":[0,1],"pbc_convention":"full3D","cutoff":3.0})
  mode="static" if family=="wall" else family
  history=source("validation-history.txt","0.0 2.5\n")
  contract={**parameters,"mode":mode,"bias_file":family+".pt","validation_history":"validation-history.txt"}
  task("pygas-"+family+"-validate","bias.validate",{family+".pt":built/(family+".pt"),"model.xyz":FIX/"model.xyz","validation-history.txt":history},contract)
  if family=="wtmetad":
   wtgas=source("WTcfg.yaml",gas.read_text().replace("cv_storage_interval: 10","cv_storage_interval: 2"))
   wtrun=task("gpumd-wtmetad","gpumd.sampling",{**gpcommon,"wtmetad.pt":built/"wtmetad.pt","validation-history.txt":history,
    "GAScfg.yaml":wtgas,"run.in":source("wt.in",runin.replace("ensemble nve","GASMD wtmetad.pt GAScfg.yaml\nensemble nve"))},contract)
   task("wtmetad-reweight","pygas.reweight",{"wtmetad.pt":built/"wtmetad.pt","GASGaussian.txt":wtrun/"GASGaussian.txt",
    "fes.yaml":source("fes.yaml","grid_min: [2.0]\ngrid_max: [3.0]\ngrid_bins: [20]\ncv_labels: ['Distance (Angstrom)']\n")},{"bias_file":"wtmetad.pt","interpretation":"Short plumbing check, no convergence claim"})
 evidence()

if __name__=="__main__":
 from science_smoke_config import parse_config_args
 config=parse_config_args()
 configure(config)
 try:main()
 finally:service.close();evidence()
