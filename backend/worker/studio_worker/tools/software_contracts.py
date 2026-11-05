"""Private read-only prototype for exact public API parameter signatures."""
import ast
import re
import hashlib,json,math
from studio_worker.tools.pygas_catalog import _read
FILES={"pydyn":("pydyn/dynamics/driver.py","pydyn/dynamics/ensembles/nvt.py","pydyn/dynamics/ensembles/npt.py","pydyn/context.py","pydyn/state.py","pydyn/forces/base.py"),"hotpp":("hotpp/entrypoints/train.py","hotpp/entrypoints/eval.py","hotpp/entrypoints/freeze.py")}
SYMBOLS={"pydyn":{"Simulation","SimulationContext","TargetStress","State","ForceModel","NVTBerendsen","NVTNoseHoover","MTTKNPT"},"hotpp":{"main"}}
HOTPP_TRAIN_FILE="hotpp/entrypoints/train.py"
HOTPP_HELPERS={"get_stats","get_cutoff","get_radial","get_model"}

def default_tree(node,code):
 # AST descriptions only: never import/eval/literal_eval expressions or stringify dictionary keys.
 common={"line":node.lineno,"end_line":node.end_lineno}
 if isinstance(node,ast.Constant) and (node.value is None or isinstance(node.value,(str,bool,int)) or isinstance(node.value,float) and math.isfinite(node.value)):
  return {**common,"kind":"literal","value":node.value}
 if isinstance(node,ast.UnaryOp) and isinstance(node.op,(ast.USub,ast.UAdd)) and isinstance(node.operand,ast.Constant) and type(node.operand.value) in (int,float) and (not isinstance(node.operand.value,float) or math.isfinite(node.operand.value)):
  return {**common,"kind":"literal","value":-node.operand.value if isinstance(node.op,ast.USub) else node.operand.value,"source_expression":ast.get_source_segment(code,node)}
 if isinstance(node,ast.Dict):return {**common,"kind":"dict","entries":[{"key":default_tree(k,code) if k is not None else {"kind":"expression","expression":"** unpack","evaluation":"not_evaluated"},"value":default_tree(v,code)}for k,v in zip(node.keys,node.values)]}
 if isinstance(node,(ast.List,ast.Tuple)):return {**common,"kind":"list" if isinstance(node,ast.List) else "tuple","items":[default_tree(v,code)for v in node.elts]}
 return {**common,"kind":"expression","expression":ast.get_source_segment(code,node),"evaluation":"not_evaluated"}

def signature(code,method):
 args=method.args;pos=args.posonlyargs+args.args;defaults={a.arg:v for a,v in zip(pos[len(pos)-len(args.defaults):],args.defaults)}
 result=[]
 for arg in pos+args.kwonlyargs:
  if arg.arg in ("self","cls"):continue
  default=defaults.get(arg.arg)
  if arg in args.kwonlyargs:default=args.kw_defaults[args.kwonlyargs.index(arg)]
  result.append({"name":arg.arg,"required":default is None,"default":ast.get_source_segment(code,default) if default else None,"annotation":ast.get_source_segment(code,arg.annotation) if arg.annotation else None})
 return result
class ApiExcerptInputError(ValueError):
 source_api_input_error=True

def inspect_contract(source,api_symbols=None):
 kind=source["id"]
 if api_symbols is not None:
  if kind not in FILES:raise ApiExcerptInputError("api_symbols supports only advertised HotPP/PyDyn public API identities")
  if not isinstance(api_symbols,list) or not api_symbols or len(api_symbols)>4 or any(not isinstance(item,str) or len(item)>256 or re.fullmatch(r'[A-Za-z0-9_/-]+\.py::[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?',item) is None or '..' in item.split('::')[0].split('/') for item in api_symbols) or len(set(api_symbols))!=len(api_symbols):raise ApiExcerptInputError("Choose1..4 unique exact advertised public_api_contract symbol_id values; no arbitrary paths")
 if kind not in FILES:raise ValueError("No additional public API manifest for this source")
 from pathlib import Path
 root=Path(source["root"]).resolve();files=[];api=[];excerpts={}
 for relative in FILES[kind]:
  if not (root/relative).is_file():files.append({"name":relative,"status":"blocked","reason":"Not present in registered version"});continue
  try:code,digest=_read(root,relative)
  except (ValueError,OSError,UnicodeError) as error:
   if api_symbols is not None:raise ApiExcerptInputError("Unsafe or unavailable advertised public API source") from error
   raise
  files.append({"name":relative,"sha256":digest,"status":"passed"})
  for node in ast.parse(code).body:
   if kind=="hotpp" and relative==HOTPP_TRAIN_FILE and isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=="DefaultPara" for t in node.targets):
    identifier=relative+"::DefaultPara"
    if identifier in excerpts:raise ApiExcerptInputError("Ambiguous advertised public API identity")
    excerpt=''.join(code.splitlines(keepends=True)[node.lineno-1:node.end_lineno])
    excerpts[identifier]={"symbol_id":identifier,"source":{"name":relative,"line":node.lineno,"end_line":node.end_lineno,"sha256":digest},"excerpt_sha256":hashlib.sha256(excerpt.encode("utf-8")).hexdigest(),"code":excerpt,"default_tree":{"source":{"name":relative,"line":node.lineno,"end_line":node.end_lineno,"sha256":digest},"excerpt_sha256":hashlib.sha256(excerpt.encode("utf-8")).hexdigest(),"source_default_present":True,"partial":True,"evaluation":"not_evaluated","scope":"Source defaults/expressions only, not complete YAML/schema, resolved runtime values or required scientific inputs","tree":default_tree(node.value,code)}}
    api.append({"symbol_id":identifier,"display_name":"DefaultPara","kind":"source_default_tree","parameters":[],"source_default_present":True,"partial":True,"source":{"name":relative,"line":node.lineno,"sha256":digest}})
    continue
   if not isinstance(node,(ast.ClassDef,ast.FunctionDef)) or node.name not in SYMBOLS[kind] and not (kind=="hotpp" and relative==HOTPP_TRAIN_FILE and isinstance(node,ast.FunctionDef) and node.name in HOTPP_HELPERS):continue
   methods=[node] if isinstance(node,ast.FunctionDef) else [item for item in node.body if isinstance(item,ast.FunctionDef) and item.name in ("__init__","run","from_ase","to_ase")]
   for method in methods:
    identifier=relative+"::"+node.name+('.'+method.name if isinstance(node,ast.ClassDef) else '')
    if identifier in excerpts:raise ApiExcerptInputError("Ambiguous advertised public API identity")
    lines=code.splitlines(keepends=True);start=min([method.lineno]+[d.lineno for d in method.decorator_list]);excerpt=''.join(lines[start-1:method.end_lineno])
    excerpts[identifier]={"symbol_id":identifier,"source":{"name":relative,"line":start,"end_line":method.end_lineno,"sha256":digest},"code":excerpt,"excerpt_sha256":hashlib.sha256(excerpt.encode("utf-8")).hexdigest()}
    api.append({"symbol_id":relative+"::"+node.name+('.'+method.name if isinstance(node,ast.ClassDef) else ''),"display_name":node.name+"."+method.name if isinstance(node,ast.ClassDef) else node.name,"parameters":signature(code,method),"documentation":(ast.get_docstring(method) or ast.get_docstring(node) or '')[:1600],"source":{"name":relative,"line":method.lineno,"sha256":digest}})
 result={"partial":True,"status":"passed" if api else "blocked","source_id":kind,"api":api,"files":files,"validation":"not_run","scope":"Public API signature metadata only by default. Not a complete CLI/YAML schema or imported runtime signatures. Defaults are source descriptions, never evaluated.","api_excerpt_request":{"tool":"inspect_source_project","arguments":{"source_id":kind,"api_symbols":[api[0]["symbol_id"]] if api else []},"max_symbols":4,"max_total_utf8_bytes":16384,"scope":"Exact advertised methods and approved HotPP train.py DefaultPara/helper identities only. Default trees are partial unevaluated descriptions; other helpers/constants and complete configuration semantics are not included. Do not use read_project_input on source repositories."}}
 if api_symbols is not None:
  if any(item not in excerpts for item in api_symbols):raise ApiExcerptInputError("Unknown, unsupported or stale public API identity; read the current public_api_contract and use its exact symbol_id")
  selected=[excerpts[item] for item in api_symbols];size=sum(len(item["code"].encode("utf-8"))+len(json.dumps(item["default_tree"],ensure_ascii=False,separators=(",",":")).encode("utf-8")) if "default_tree" in item else len(item["code"].encode("utf-8")) for item in selected)
  if size>16384:raise ApiExcerptInputError("Requested public API code/default descriptions exceed16KiB; request fewer IDs. Nothing truncated or executed")
  result["api_excerpts"]={"status":"passed","validation":"not_run","bytes":size,"symbols":selected,"scope":"Bounded original AST methods/default tree only; integer dictionary keys and explicit None defaults retained, dynamic expressions never evaluated. Partial source-derived fields, not complete YAML/runtime schema; no import/eval/target execution or numerical validation"}
 return result
