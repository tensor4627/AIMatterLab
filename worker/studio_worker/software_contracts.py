"""Private read-only prototype for exact public API parameter signatures."""
import ast
from .pygas_catalog import _read
FILES={"pydyn":("pydyn/dynamics/driver.py","pydyn/dynamics/ensembles/nvt.py","pydyn/dynamics/ensembles/npt.py","pydyn/context.py","pydyn/state.py","pydyn/forces/base.py"),"hotpp":("hotpp/entrypoints/train.py","hotpp/entrypoints/eval.py","hotpp/entrypoints/freeze.py")}
SYMBOLS={"pydyn":{"Simulation","SimulationContext","TargetStress","State","ForceModel","NVTBerendsen","NVTNoseHoover","MTTKNPT"},"hotpp":{"main"}}
def signature(code,method):
 args=method.args;pos=args.posonlyargs+args.args;defaults={a.arg:v for a,v in zip(pos[len(pos)-len(args.defaults):],args.defaults)}
 result=[]
 for arg in pos+args.kwonlyargs:
  if arg.arg in ("self","cls"):continue
  default=defaults.get(arg.arg)
  if arg in args.kwonlyargs:default=args.kw_defaults[args.kwonlyargs.index(arg)]
  result.append({"name":arg.arg,"required":default is None,"default":ast.get_source_segment(code,default) if default else None,"annotation":ast.get_source_segment(code,arg.annotation) if arg.annotation else None})
 return result
def inspect_contract(source):
 kind=source["id"]
 if kind not in FILES:raise ValueError("No additional public API manifest for this source")
 from pathlib import Path
 root=Path(source["root"]).resolve();files=[];api=[]
 for relative in FILES[kind]:
  if not (root/relative).is_file():files.append({"name":relative,"status":"blocked","reason":"Not present in registered version"});continue
  code,digest=_read(root,relative);files.append({"name":relative,"sha256":digest,"status":"passed"})
  for node in ast.parse(code).body:
   if not isinstance(node,(ast.ClassDef,ast.FunctionDef)) or node.name not in SYMBOLS[kind]:continue
   methods=[node] if isinstance(node,ast.FunctionDef) else [item for item in node.body if isinstance(item,ast.FunctionDef) and item.name in ("__init__","run","from_ase","to_ase")]
   for method in methods:api.append({"symbol_id":relative+"::"+node.name+('.'+method.name if isinstance(node,ast.ClassDef) else ''),"display_name":node.name+"."+method.name if isinstance(node,ast.ClassDef) else node.name,"parameters":signature(code,method),"documentation":(ast.get_docstring(method) or ast.get_docstring(node) or '')[:1600],"source":{"name":relative,"line":method.lineno,"sha256":digest}})
 return {"partial":True,"status":"passed" if api else "blocked","source_id":kind,"api":api,"files":files,"validation":"not_run","scope":"Selected registered public API excerpts, not a complete CLI/API schema. Exact source-qualified signatures, not imported runtime signatures. Installed SDK and native binary compatibility require selected-environment probing. Defaults are source descriptions, never evaluated."}
