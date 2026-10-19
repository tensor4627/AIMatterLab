"""Deploy worker source to an immutable Linux runtime before starting a daemon."""
import argparse,hashlib,json,shutil,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument("--source",required=True);p.add_argument("--root",required=True);a=p.parse_args()
source=Path(a.source).resolve();root=Path(a.root).expanduser().resolve()
files=sorted(x for x in source.rglob("*") if x.is_file() and (x.suffix in (".py",".toml") or x.relative_to(source).as_posix()=="studio_worker/engine_contracts.json") and not any(s in x.parts for s in ("__pycache__","tests")))
if not (source/"bootstrap.py").is_file():raise ValueError("Worker source unavailable")
h=hashlib.sha256()
for file in files:h.update(str(file.relative_to(source)).encode());h.update(file.read_bytes())
version=h.hexdigest()[:20]
runtime=root/"runtimes"/version
root.mkdir(parents=True,exist_ok=True);root.chmod(0o700)
runtime.parent.mkdir(exist_ok=True)
if not runtime.exists():
 temporary=runtime.parent/("staging-"+uuid.uuid4().hex);temporary.mkdir()
 for file in files:
  target=temporary/file.relative_to(source);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(file,target)
 (temporary/"runtime.json").write_text(json.dumps({"id":version,"files":len(files)}))
 try:temporary.rename(runtime)
 except FileExistsError:shutil.rmtree(temporary)
print(json.dumps({"path":str(runtime),"id":version}))
