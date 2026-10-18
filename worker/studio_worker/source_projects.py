"""Bounded source inspection without importing or executing a project."""
import ast
import hashlib
from pathlib import Path

ALLOWED={"pygas":("base/colvar.py","base/bias.py","base/switch.py","base/neighbor.py","base/utils.py","tools/graph_workflow.py","tools/compile_workflow.py","agents/skills/pygas-workflow/SKILL.md","agents/skills/pygas-build-cv-model/SKILL.md"),"pydyn":("pyproject.toml",),"gpumd":("src/main_gpumd/run.cu",),"hotpp":("setup.py",),"torchnep":("pyproject.toml",)}
def inspect_source(source):
 root=Path(source["root"]).resolve();name=source["id"]
 if name not in ALLOWED:raise ValueError("Unsupported scientific source")
 report={**source,"files":[],"catalog":{},"status":"passed","validation":"not_run","scope":"Source inspection only; no runtime or serialized-artifact validation"}
 for relative in ALLOWED[name]:
  path=root/relative
  if not path.is_file():continue
  if not path.resolve().is_relative_to(root) or path.stat().st_size>2*1024*1024:raise ValueError("Unsafe source file")
  data=path.read_bytes();report["files"].append({"name":relative,"sha256":hashlib.sha256(data).hexdigest()})
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
   report['catalog'][relative]=entries
 report['capabilities']={k:(root/p).is_file() for k,p in {'graph_renderer':'tools/graph_workflow.py','graph_compiler':'tools/compile_workflow.py','cv_only':'base/utils.py','contract_validator':'agents/skills/pygas-check-gpumd-contract/scripts/validate_model.py'}.items()} if name=='pygas' else {}
 return report
