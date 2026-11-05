"""Bounded source inspection without importing or executing a project."""
import ast
import hashlib
import re
from pathlib import Path

ALLOWED={"pygas":("base/colvar.py","base/bias.py","base/switch.py","base/neighbor.py","base/utils.py","tools/graph_workflow.py","tools/compile_workflow.py","agents/skills/pygas-workflow/SKILL.md","agents/skills/pygas-build-cv-model/SKILL.md"),"pydyn":("pyproject.toml",),"gpumd":("src/main_gpumd/run.cu",),"hotpp":("setup.py",),"torchnep":("pyproject.toml",)}
GRAPH_ENTRYPOINTS=("_mode","_node_ports","_edge_endpoint","validate_graph","_reduce_expression")

def graph_authoring_contract(code, source_hash):
 """Expose actual public graph rules without importing target source or evaluating it."""
 if __package__:from studio_worker.tools.pygas_values import studio_graph_input_contract
 else:from studio_worker.tools.pygas_values import studio_graph_input_contract
 result={"studio_graph_input":studio_graph_input_contract(),"status":"blocked","validation":"not_run","source":{"name":"tools/graph_workflow.py","sha256":source_hash},"scope":"Read-only AST/source excerpts. Only render_pygas_workflow checks a concrete graph; no artifact or target validation."}
 try:
  tree=ast.parse(code)
  functions={n.name:n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
  missing=[name for name in GRAPH_ENTRYPOINTS if name not in functions]
  if missing:return {**result,"reason":"Graph authoring entrypoints unavailable: "+", ".join(missing)}
  excerpts={name:ast.get_source_segment(code,functions[name]) for name in GRAPH_ENTRYPOINTS}
  if any(not value for value in excerpts.values()) or sum(len(value.encode("utf-8")) for value in excerpts.values())>24000:return {**result,"reason":"Graph contract exceeds bounded source excerpt size"}
  ports=next((n.value for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=="RUNTIME_PORTS" for t in n.targets)),None)
  # literal_eval permits data literals only; no import, eval or target code execution.
  runtime_ports=ast.literal_eval(ports) if ports is not None else None
  if runtime_ports is not None and (not isinstance(runtime_ports,dict) or any(not isinstance(k,str) or not isinstance(v,str) for k,v in runtime_ports.items())):return {**result,"reason":"Graph runtime port table is not a string mapping"}
  renderer=functions.get('render_workflow_script');collector=[]
  if renderer:
   for node in ast.walk(renderer):
    if isinstance(node,ast.Call) and any(isinstance(value,ast.Constant) and isinstance(value.value,str) and 'now_cv = torch.cat' in value.value for value in ast.walk(node)):
     excerpt=ast.get_source_segment(code,node)
     if excerpt and len(excerpt)<2000:collector.append(excerpt)
  return {**result,"status":"passed","collector_source":collector[:1],"shape_guidance":"Inspect actual CV method output rank. A scalar cannot be concatenated directly: use an explicit supported reduce/reshape node only when it preserves the intended CV. Never select the first component of a vector merely to make a build pass.","studio_io":studio_render_contract(),"runtime_ports":runtime_ports,"entrypoints":excerpts,"read_order":list(GRAPH_ENTRYPOINTS),"guidance":"Read these registered renderer rules before assembling a graph. In this source family nodes use kind/class_name and edges carry structured node/port endpoints; verify the excerpts for the installed version. Class signatures are in catalog. Never guess required graph nodes, ports or input settings; render validates the actual assembled graph."}
 except (SyntaxError,ValueError,TypeError) as error:return {**result,"reason":"Graph contract cannot be inspected: "+str(error)}

def studio_render_contract():
 path=Path(__file__).with_name('structure_tools.py');data=path.read_bytes();code=data.decode('utf-8');functions={node.name:node for node in ast.parse(code).body if isinstance(node,ast.FunctionDef)}
 names=('portable_graph','graph_snapshot_io')
 if any(name not in functions for name in names):return {'status':'blocked','reason':'Studio render wrapper interface is unavailable'}
 if sum(len((ast.get_source_segment(code,functions[name]) or '').encode('utf-8')) for name in names)>8192:return {'status':'blocked','reason':'Studio render wrapper exceeds source excerpt budget'}
 return {'status':'passed','source':{'name':'studio_worker/tools/structure_tools.py','sha256':hashlib.sha256(data).hexdigest()},'required_settings':['atoms_path','pt_path'],'workflow_path':'workflow.json','scope':'Studio snapshot I/O only; graph rendering never builds or validates the serialized artifact','entrypoints':{name:ast.get_source_segment(code,functions[name]) for name in names},'guidance':"atoms_path is the actual authorized structure input; pt_path is the requested output artifact filename. Studio normalizes them to immutable run basenames and sets workflow_path=workflow.json. Include the structure, graph and build source in the reviewed task files. Version2 TorchScript-only requires artifact_formats=['torchscript'] and deployment_backend='torchscript'; AOTI/dual selection requires the matching explicit artifact formats and actual target/toolchain preflight, with no backend fallback."}

def inspect_source(source,symbols=None,api_symbols=None,read_guard=None):
 if symbols is not None and (not isinstance(symbols,list) or len(symbols)>4 or any(not isinstance(name,str) or len(name)>128 or re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',name) is None for name in symbols) or len(set(symbols))!=len(symbols)):raise ValueError('Choose up to four unique public catalog class names')
 if api_symbols is not None and source.get("id") not in ("hotpp","pydyn"):
  from studio_worker.tools.software_contracts import ApiExcerptInputError
  raise ApiExcerptInputError("api_symbols is available only for advertised HotPP/PyDyn public API identities; use symbols for pyGAS classes")
 requested=set(symbols or []);selected={};excerpt_bytes=0
 root=Path(source["root"]).resolve();name=source["id"]
 if name not in ALLOWED:raise ValueError("Unsupported scientific source")
 report={**source,"files":[],"catalog":{},"status":"passed","validation":"not_run","scope":"Source inspection only; no runtime or serialized-artifact validation"}
 for relative in ALLOWED[name]:
  path=root/relative
  if read_guard is not None and not read_guard(path):
   report['files'].append({'name':relative,'status':'archived','scope':'Use the authoritative execution skill; guidance content was not inspected'})
   continue
  if not path.is_file():continue
  if not path.resolve().is_relative_to(root) or path.stat().st_size>2*1024*1024:raise ValueError("Unsafe source file")
  data=path.read_bytes();report["files"].append({"name":relative,"sha256":hashlib.sha256(data).hexdigest()})
  if name=="pygas" and relative=="tools/graph_workflow.py":report["graph_contract"]=graph_authoring_contract(data.decode("utf-8"),hashlib.sha256(data).hexdigest())
  if relative.endswith('.py') and relative.startswith('base/'):
   code=data.decode('utf-8');entries=[]
   for node in ast.parse(code).body:
    if not isinstance(node,ast.ClassDef):continue
    methods={m.name:m for m in node.body if isinstance(m,ast.FunctionDef)}
    if '__init__' not in methods:continue
    def signature(fn):
     args=fn.args.args;offset=len(args)-len(fn.args.defaults)
     return [{"name":a.arg,"default":ast.get_source_segment(code,fn.args.defaults[i-offset]) if i>=offset else None} for i,a in enumerate(args) if a.arg!='self']
    entries.append({"name":node.name,"constructor":signature(methods['__init__']),"forward":signature(methods['forward']) if 'forward' in methods else [],"documentation":(ast.get_docstring(node) or '')[:1800]})
    if node.name in requested:
     if node.name in selected:raise ValueError('Ambiguous public catalog class')
     excerpts={key:{'decorators':[ast.unparse(value) for value in method.decorator_list],'source':ast.get_source_segment(code,method)} for key,method in methods.items()}
     excerpt_bytes+=sum(len((item['source'] or '').encode('utf-8')) for item in excerpts.values())
     selected[node.name]={'name':node.name,'source':{'name':relative,'sha256':hashlib.sha256(data).hexdigest()},'methods':excerpts}
   report['catalog'][relative]=entries
 if symbols is not None:
  missing=sorted(requested-set(selected))
  report['symbol_excerpts']={'status':'blocked','validation':'not_run','reason':'Unknown public catalog class: '+', '.join(missing)} if missing else {'status':'blocked','validation':'not_run','reason':'Requested method excerpts exceed 16 KiB; request fewer classes'} if excerpt_bytes>16384 else {'status':'passed','validation':'not_run','scope':'Read-only AST method bodies from the registered public catalog only; no import, execution or runtime shape validation','bytes':excerpt_bytes,'symbols':list(selected.values())}
 if name in ('pydyn','hotpp'):
  from studio_worker.tools.software_contracts import inspect_contract
  report['public_api_contract']=inspect_contract(source,api_symbols=api_symbols)
 report['capabilities']={k:(root/p).is_file() for k,p in {'graph_renderer':'tools/graph_workflow.py','graph_compiler':'tools/compile_workflow.py','cv_only':'base/utils.py','contract_validator':'agents/skills/pygas-check-gpumd-contract/scripts/validate_model.py'}.items()} if name=='pygas' else {}
 return report
