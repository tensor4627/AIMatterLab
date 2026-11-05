"""Deploy worker source to an immutable Linux runtime before starting a daemon."""
import argparse,json,shutil,uuid
from pathlib import Path
from runtime_resources import worker_files,verify_tool_contract,runtime_identity
p=argparse.ArgumentParser();p.add_argument("--source",required=True);p.add_argument("--root",required=True);a=p.parse_args()
source=Path(a.source).resolve();root=Path(a.root).expanduser().resolve()
verify_tool_contract(source)
names=worker_files(source)
version=runtime_identity(source,names)
runtime=root/"runtimes"/version
root.mkdir(parents=True,exist_ok=True);root.chmod(0o700)
runtime.parent.mkdir(exist_ok=True)
if not runtime.exists():
 temporary=runtime.parent/("staging-"+uuid.uuid4().hex);temporary.mkdir()
 for name in names:
  target=temporary/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source/name,target)
 (temporary/"runtime.json").write_text(json.dumps({"id":version,"files":len(names)}))
 try:temporary.rename(runtime)
 except FileExistsError:shutil.rmtree(temporary)
print(json.dumps({"path":str(runtime),"id":version}))
