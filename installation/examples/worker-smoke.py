"""Actual child-process lifecycle case; this is infrastructure, not molecular dynamics."""
import json,os,time
from pathlib import Path
time.sleep(.15)
Path("smoke-result.json").write_text(json.dumps({"status":"passed","case":"worker","scope":"infrastructure only","pid":os.getpid()}))
print("STUDIO_WORKER_SMOKE_OK",flush=True)
