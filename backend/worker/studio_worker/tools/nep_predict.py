"""NEP prediction mode consumes train.xyz; normalize an explicitly labelled evaluation input."""
import hashlib,json,shutil,subprocess,sys
from pathlib import Path
source=Path("evaluation.xyz")
role=sys.argv[2]
if role not in ("independent_test","validation","train"):raise ValueError("Explicit dataset role required")
for name in ("train.xyz","test.xyz"):shutil.copyfile(source,name)
result=subprocess.run([sys.argv[1]])
if result.returncode:sys.exit(result.returncode)
suffix="test" if role=="independent_test" else role
outputs=[]
for kind in ("energy","force","virial","stress"):
 original=Path(kind+"_train.out")
 if original.exists():
  target=Path(kind+"_"+suffix+".out")
  if target!=original:shutil.copyfile(original,target)
  outputs.append({"source":str(original),"alias":str(target),"sha256":hashlib.sha256(original.read_bytes()).hexdigest()})
Path("evaluation.json").write_text(json.dumps({"dataset_role":role,"dataset_input":"evaluation.xyz",
 "dataset_sha256":hashlib.sha256(source.read_bytes()).hexdigest(),"native_prediction_split":"train",
 "analysis_split":suffix,"outputs":outputs,
 "scope":"Explicit evaluation input. Independence from model fitting must be verified with model dataset provenance."},indent=2))
