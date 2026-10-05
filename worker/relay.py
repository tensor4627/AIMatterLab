"""Authenticated stdio relay when Windows localhost forwarding is unavailable."""
import argparse, concurrent.futures, json, sys, threading, urllib.request, urllib.error
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument("--root",required=True);parser.add_argument("--port",type=int,required=True)
args=parser.parse_args()
tokens=json.loads((Path(args.root).expanduser()/"connection.json").read_text())
lock=threading.Lock()
def request(value):
 try:
  target=value["target"]
  if not target.startswith(("/api/","/mcp")) or target.startswith("//") or "\\x00" in target:
   raise ValueError("Unsupported target")
  body=json.dumps(value.get("data",{})).encode() if value["method"]=="POST" else None
  req=urllib.request.Request("http://127.0.0.1:"+str(args.port)+target,data=body,method=value["method"],
    headers={"Authorization":"Bearer "+tokens["mcp" if value.get("mcp") else "admin"],"Content-Type":"application/json"})
  try:
   with urllib.request.urlopen(req,timeout=240) as response:
    content=response.read();result={"status":response.status,"data":json.loads(content) if content else None}
  except urllib.error.HTTPError as exc:
   content=exc.read();result={"status":exc.code,"data":json.loads(content) if content else None}
 except Exception as exc:result={"status":502,"data":{"error":str(exc)}}
 with lock:print(json.dumps({"id":value["id"],**result}),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
 for line in sys.stdin:
  try:pool.submit(request,json.loads(line))
  except Exception:pass
