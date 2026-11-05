"""Read the real pyGAS GUI parameter contract without importing its code."""
import ast
import hashlib
import re
import os
import json
from pathlib import Path

FILES={"cv":"base/colvar.py","bias":"base/bias.py","switch":"base/switch.py","neighbor":"base/neighbor.py"}
CONSTANTS=("EXCLUDED_CV","EXCLUDED_BIAS","EXCLUDED_SWITCH","EXCLUDED_NEIGHBOR","FORWARD_ARG_MAP","CV_OUTPUT_SIZES")

def _read(root,relative):
 path=root/relative;limit=2*1024*1024
 if path.is_symlink() or path.resolve()!=path or not path.is_file():raise ValueError("Unsafe or unavailable public catalog file")
 descriptor=os.open(path,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
 try:
  before=os.fstat(descriptor)
  if before.st_size>limit:raise ValueError("Oversized public catalog file")
  with os.fdopen(descriptor,"rb",closefd=False) as stream:data=stream.read(limit+1)
  after=os.fstat(descriptor);current=path.stat()
  if len(data)>limit or path.is_symlink() or path.resolve()!=path or (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns) or (after.st_dev,after.st_ino)!=(current.st_dev,current.st_ino):raise ValueError("Public catalog changed during read")
 finally:os.close(descriptor)
 return data.decode("utf-8"),hashlib.sha256(data).hexdigest()

def _literal(node):
 try:return True,ast.literal_eval(node)
 except (ValueError,TypeError,SyntaxError):return False,None

def catalog(source):
 root=Path(source["root"]).resolve();gui,gui_hash=_read(root,"tools/cv_bias_gui_server.py");constants={}
 for node in ast.parse(gui).body:
  target=node.targets[0] if isinstance(node,ast.Assign) and len(node.targets)==1 else node.target if isinstance(node,ast.AnnAssign) else None
  if isinstance(target,ast.Name) and target.id in CONSTANTS:
   if isinstance(node.value,ast.Call) and isinstance(node.value.func,ast.Name) and node.value.func.id=="set" and not node.value.args and not node.value.keywords:constants[target.id]=set()
   else:constants[target.id]=ast.literal_eval(node.value)
 if set(constants)!=set(CONSTANTS):raise ValueError("Registered GUI catalog constants are unsupported; inspect the actual source version")
 if not isinstance(constants["FORWARD_ARG_MAP"],dict) or not isinstance(constants["CV_OUTPUT_SIZES"],dict):raise ValueError("Unsupported catalog metadata")
 overlay_path=Path(__file__).resolve().parents[1]/"pygas-editor-hints.json"
 overlay=json.loads(overlay_path.read_text(encoding="utf-8")) if overlay_path.is_file() else {}
 result={};hashes={"tools/cv_bias_gui_server.py":gui_hash}
 for kind,relative in FILES.items():
  code,digest=_read(root,relative);hashes[relative]=digest;items=[]
  for node in ast.parse(code).body:
   if not isinstance(node,ast.ClassDef) or node.name in constants["EXCLUDED_"+kind.upper()]:continue
   methods={n.name:n for n in node.body if isinstance(n,ast.FunctionDef)};init=methods.get("__init__");forward=methods.get("forward")
   if init is None:continue
   args=[arg for arg in init.args.args if arg.arg!="self"];defaults={arg.arg:value for arg,value in zip(args[len(args)-len(init.args.defaults):],init.args.defaults)};params=[]
   for arg in args:
    default=defaults.get(arg.arg);raw=ast.get_source_segment(code,default) if default is not None else "";annotation=ast.get_source_segment(code,arg.annotation) if arg.annotation else "";annotation=annotation or "";hint="expr";lower=annotation.lower()
    if arg.arg=="n_atoms":hint="int"
    elif "tensor" in lower:hint="tensor"
    elif "int" in lower or "long" in lower:hint="int"
    elif "float" in lower or "double" in lower:hint="float"
    elif raw.startswith("torch.tensor"):hint="tensor"
    elif re.fullmatch(r"[-+]?\d+",raw):hint="int"
    elif re.fullmatch(r"[-+]?\d+(\.\d+)?([eE][-+]?\d+)?",raw):hint="float"
    literal,value=_literal(default) if default is not None else (False,None)
    params.append({"name":arg.arg,"default":raw,"required":arg.arg not in defaults,"annotation":annotation,"is_module_param":arg.arg in {"switch_func","cv"} or "Module" in annotation or annotation.endswith("CV"),"type_hint":hint,"default_is_literal":literal,"default_value":value if literal else None})
   forward_args=[arg.arg for arg in forward.args.args if arg.arg!="self"] if forward else []
   sections=sorted(set(re.findall(r'dicts\["([^\"]+)"\]',ast.get_source_segment(code,methods.get("from_dict")) or ""))) if methods.get("from_dict") else []
   entry={"kind":kind,"name":node.name,"params":params,"forward_args":forward_args,"from_dict_sections":[v for v in sections if v not in {"Settings","Info"}],"requires_switch":any(p["name"]=="switch_func" for p in params),"supports_pipeline":bool(forward_args),"unknown_forward_args":[arg for arg in forward_args if arg not in constants["FORWARD_ARG_MAP"]],"documentation":(ast.get_docstring(node) or "")[:1600],"source":{"name":relative,"line":node.lineno,"sha256":digest},"validation":"not_run"}
   if overlay.get("source_files",{}).get(relative)==digest:
    for param in params:
     hint=overlay.get("hints",{}).get(kind,{}).get(node.name,{}).get(param["name"])
     if hint:param["editor_hint"]={**hint,"provenance":{"kind":"Studio source-bound adapter","sha256":digest,"source":relative}}
    semantics=overlay.get("class_semantics",{}).get(kind,{}).get(node.name)
    if semantics:entry["semantics"]=semantics
   if kind=="cv":entry["output_size"]=constants["CV_OUTPUT_SIZES"].get(node.name)
   supported=bool(forward_args) and (not entry["unknown_forward_args"] if kind=="cv" else forward_args in (["cv","cv_traj"],["cv","cv_traj","bias_traj"]) if kind=="bias" else forward_args==["pos","cell","side_array"] if kind=="neighbor" else True)
   if supported:items.append(entry)
  result[kind]=sorted(items,key=lambda x:x["name"])
 graph_code,graph_hash=_read(root,"tools/graph_workflow.py") if (root/"tools/graph_workflow.py").is_file() else ("",None)
 hashes["tools/graph_workflow.py"]=graph_hash
 ports={"status":"blocked","source_sha256":graph_hash,"reason":"Registered graph renderer differs from the reviewed port adapter; inspect its real contract"}
 if graph_hash and overlay.get("source_files",{}).get("tools/graph_workflow.py")==graph_hash:
  runtime={}
  for node in ast.parse(graph_code).body:
   if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=="RUNTIME_PORTS" for target in node.targets):runtime=ast.literal_eval(node.value)
  entries={}
  for kind,items in result.items():
   for entry in items:
    inputs={};outputs={}
    if kind=="neighbor":inputs={name:name for name in ("pos","cell","side_array")};outputs={name:name for name in ("pcvector","side_array")}
    if kind=="switch":outputs={"switch":"switch"}
    if kind=="cv":
     inputs={runtime[arg]:runtime[arg] for arg in entry["forward_args"] if arg in runtime};outputs={"value":"value"}
     if entry["requires_switch"]:inputs["switch_func"]="switch"
    if kind=="bias":
     inputs={name:name for name in ("cv","cv_traj")};outputs={"bias":"bias"}
     if "bias_traj" in entry["forward_args"]:inputs["bias_traj"]="bias_traj"
    entries[kind+"."+entry["name"]]={"inputs":inputs,"outputs":outputs}
  templates={}
  for mode in ("metad","cvonly","opes"):
   input_ports={name:name for name in ("pos","cell","side_array")};output_ports={"cv":"cv"}
   if mode=="metad":input_ports.update(cv_traj="cv_traj",bias_traj="bias_traj");output_ports["bias"]="bias"
   templates[mode]={"input":{"inputs":{},"outputs":input_ports},"output":{"inputs":output_ports,"outputs":{}},"collect":{"inputs":{"value":"value"},"outputs":{"cv":"cv"}},"reduce":{"inputs":{"value":"value"},"outputs":{"value":"value"}}}
  ports={"status":"passed","source_sha256":graph_hash,"runtime_ports":runtime,"classes":entries,"templates":templates,"multiple_inputs":[["collect","value"],["output","cv"],["output","bias"]],"compatible_pairs":[["value","cv"],["cv","value"]],"reductions":["identity","mean","sum","first"],"scope":"Source-matched port adapter only; actual validate_graph still owns concrete graph legality"}
 settings_schema={"status":"blocked","fields":[],"reason":"Global settings source contract unavailable"}
 declaration=overlay.get("settings_schema",{})
 if declaration:
  observed={}
  for relative in declaration.get("source_files",{}):
   if relative not in ("tools/cv_bias_gui/graph.html","tools/graph_workflow.py","base/opes.py","tools/cv_bias_gui/index.html"):raise ValueError("Unknown settings source adapter")
   try:_,observed[relative]=_read(root,relative)
   except (ValueError,OSError):observed[relative]=None
  hashes.update(observed)
  if observed==declaration.get("source_files"):settings_schema={**declaration,"status":"passed"}
  else:settings_schema={"status":"blocked","fields":declaration.get("fields",[]),"source_files":observed,"reason":"Registered settings source differs from its reviewed adapter; existing settings remain inspectable, edits require the current actual contract"}
 if __package__:from studio_worker.tools.pygas_values import studio_graph_input_contract,studio_graph_parameter_policy
 else:from studio_worker.tools.pygas_values import studio_graph_input_contract,studio_graph_parameter_policy
 for entries in result.values():
  for entry in entries:
   for param in entry['params']:
    policy=studio_graph_parameter_policy(param)
    if policy:param['studio_graph_input']=policy
 return {"studio_graph_input":studio_graph_input_contract(),"settings_schema":settings_schema,"ports":ports,"schema_version":1,"status":"passed","scope":"Read-only AST contract matching the registered pyGAS GUI; catalog presence is not numerical/target validation. Raw expression defaults are source descriptions, not executable user input.","source":{"id":source.get("id"),"commit":source.get("commit"),"dirty":source.get("dirty"),"files":hashes},"catalog":result,"validation":"not_run"}
