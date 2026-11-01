import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
// Read-only stdlib helper: no mkdir, installer, bootstrap, SDK import or service launch.
export const EXISTING_WORKER_COMMON=String.raw`import json,sys,os,socket,http.client,time
from pathlib import Path
def owns_stream(root,port,stream):
 local="0100007F:"+format(port,"04X")
 peer="0100007F:"+format(stream.getsockname()[1],"04X")
 candidates=[]
 for process in Path("/proc").iterdir():
  if not process.name.isdigit(): continue
  try:
   argv=(process/"cmdline").read_bytes().decode().rstrip("\0").split("\0")
   if process.stat().st_uid!=os.getuid() or argv!=[argv[0],"-m","studio_worker.server","--root",str(root),"--port",str(port)]: continue
   candidates.append((process,argv,(process/"stat").read_text().rsplit(")",1)[1].split()[19]))
  except (OSError,UnicodeError,IndexError): continue
 for attempt in range(6):
  inodes=set()
  for row in Path("/proc/net/tcp").read_text().splitlines()[1:]:
   fields=row.split()
   if len(fields)>9 and fields[1]==local and fields[2]==peer and fields[3]=="01" and fields[7]==str(os.getuid()) and fields[9]!="0": inodes.add("socket:["+fields[9]+"]")
  for process,argv,start in candidates:
   try:
    matched=any(os.readlink(fd) in inodes for fd in (process/"fd").iterdir())
    if matched and process.stat().st_uid==os.getuid() and (process/"cmdline").read_bytes().decode().rstrip("\0").split("\0")==argv and (process/"stat").read_text().rsplit(")",1)[1].split()[19]==start: return True
   except OSError: continue
  time.sleep(.05)
 return False
def verified_connection(root,port,timeout=1.5):
 connection=http.client.HTTPConnection("127.0.0.1",port,timeout=timeout)
 try:
  connection.sock=socket.create_connection(("127.0.0.1",port),timeout=1.5)
  connection.sock.settimeout(timeout)
  connection.auto_open=0
  if not owns_stream(root,port,connection.sock): raise ValueError("Existing controller ownership unavailable")
  return connection
 except Exception:
  connection.close()
  raise
def descriptor_tokens(root):
 descriptor=root/"connection.json"
 if not descriptor.is_file() or descriptor.is_symlink(): raise ValueError("Descriptor unavailable")
 tokens=json.loads(descriptor.read_text())
 if not all(isinstance(tokens.get(key),str) and tokens[key] for key in ("admin","mcp")): raise ValueError("Invalid descriptor")
 return tokens
`;
export const EXISTING_WORKER_READ=EXISTING_WORKER_COMMON+String.raw`result={"status":"disconnected"}
connection=None
try:
 root=Path(sys.argv[1]).expanduser().resolve()
 descriptor=root/"connection.json"
 if descriptor.is_file() and not descriptor.is_symlink():
  connection=verified_connection(root,int(sys.argv[2]))
  tokens=descriptor_tokens(root)
  url="http://127.0.0.1:"+str(int(sys.argv[2]))
  connection.request("GET","/api/health",headers={"Authorization":"Bearer "+tokens["admin"]})
  response=connection.getresponse()
  if response.status!=200: raise ValueError("Health unavailable")
  health=json.loads(response.read(1024*1024))
  if health.get("name")!="gpu-sampling-studio" or health.get("root")!=str(root) or health.get("execution_policy")!="desktop-review-v1" or not isinstance(health.get("runtime"),str) or not health["runtime"].startswith("/"): raise ValueError("Identity mismatch")
  result={"status":"connected","connection":{"url":url,"tokens":tokens,"health":health}}
except Exception:
 result={"status":"unknown"}
finally:
 if connection is not None: connection.close()
print(json.dumps(result))`;
// Same-socket proof is repeated for EVERY forwarded request. Tokens keep their original privilege.
export const EXISTING_WORKER_RELAY=EXISTING_WORKER_COMMON+String.raw`import concurrent.futures,threading
root=Path(sys.argv[1]).expanduser().resolve()
port=int(sys.argv[2])
lock=threading.Lock()
def forward(value):
 connection=None
 try:
  target=value["target"]
  if value["method"] not in ("GET","POST") or not isinstance(target,str) or not (target.startswith("/api/") or target=="/mcp") or any(char in target for char in ("\r","\n","\0")): raise ValueError("Unsupported target")
  connection=verified_connection(root,port,240)
  tokens=descriptor_tokens(root)
  body=json.dumps(value.get("data",{})).encode() if value["method"]=="POST" else None
  connection.request(value["method"],target,body=body,headers={"Authorization":"Bearer "+tokens["mcp" if value.get("mcp") else "admin"],"Content-Type":"application/json"})
  response=connection.getresponse()
  content=response.read()
  result={"status":response.status,"data":json.loads(content) if content else None}
 except Exception:
  result={"status":502,"data":{"error":"Existing worker request could not be verified; job status is unknown"}}
 finally:
  if connection is not None: connection.close()
 with lock: print(json.dumps({"id":value["id"],**result}),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
 for line in sys.stdin:
  try: pool.submit(forward,json.loads(line))
  except Exception: pass
`;
export async function readExistingWorker(settings,{execute=exec}={}){
 if(!/^[\w .-]{1,80}$/.test(settings.distribution)||typeof settings.workerRoot!=='string'||!/^~\/|^\//.test(settings.workerRoot)||/[\r\n\0]/.test(settings.workerRoot)||!Number.isInteger(settings.workerPort)||settings.workerPort<1024||settings.workerPort>65535)throw Error('Invalid existing worker target');
 const {stdout}=await execute('wsl.exe',['-d',settings.distribution,'--','python3','-B','-c',EXISTING_WORKER_READ,settings.workerRoot,String(settings.workerPort)],{windowsHide:true,timeout:6000,maxBuffer:1024*1024});
 const result=JSON.parse(stdout.trim().split('\n').at(-1));
 return result;
}

// Snapshot preflight only, not an atomic cross-process root lock. Never sends a
// token or stops a process. Bootstrap separately verifies its connected socket.
export const LEGACY_WORKER_START_PROBE=String.raw`import json,os,sys,socket,time
from pathlib import Path
result={"status":"unknown"}
try:
 root=Path(sys.argv[1]).expanduser().resolve()
 port=int(sys.argv[2]); deadline=time.monotonic()+2
 if str(root)!=sys.argv[1] or root.exists() and root.stat().st_uid!=os.getuid(): raise ValueError()
 def process_start(process):
  with (process/'stat').open('rb') as stream: value=stream.read(8193)
  if len(value)>8192: raise ValueError()
  return value.decode().rsplit(')',1)[1].split()[19]
 count=0; conflict=False
 for process in Path('/proc').iterdir():
  if not process.name.isdigit(): continue
  count+=1
  if count>8192 or time.monotonic()>deadline: raise ValueError()
  root_candidate=False
  try:
   if process.stat().st_uid!=os.getuid(): continue
   with (process/'cmdline').open('rb') as stream: raw=stream.read(65537)
   if len(raw)>65536: raise ValueError()
   argv=raw.decode().rstrip('\0').split('\0')
   if 'studio_worker.server' not in argv: continue
   roots=[]
   for index,value in enumerate(argv):
    if value=='--root': roots.append(argv[index+1])
    elif value.startswith('--root='): roots.append(value.split('=',1)[1])
   if not roots: raise ValueError()
   resolved=[Path(value).expanduser().resolve() for value in roots]
   root_candidate=root in resolved
   if len(roots)!=1 or len(argv)!=7 or argv[1:4]!=['-m','studio_worker.server','--root'] or argv[5]!='--port' or not argv[6].isdigit(): raise ValueError()
   candidate=resolved[0]
   if candidate!=root: continue
   root_candidate=True
   start=process_start(process)
   if argv!=[argv[0],'-m','studio_worker.server','--root',str(root),'--port',argv[-1]] or not argv[-1].isdigit(): raise ValueError()
   with (process/'cmdline').open('rb') as stream: fresh=stream.read(65537)
   if fresh!=raw or process_start(process)!=start: raise ValueError()
   conflict=True
  except FileNotFoundError:
   if root_candidate: raise ValueError()
   continue
 if conflict: result={"status":"same_root_controller"}
 else:
  with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as probe:
   try: probe.bind(('127.0.0.1',port)); result={"status":"available"}
   except OSError: result={"status":"occupied"}
except Exception: result={"status":"unknown"}
print(json.dumps(result))`;
export async function probeLegacyWorkerStart(settings,{execute=exec}={}){
 if(!/^[\w .-]{1,80}$/.test(settings.distribution)||typeof settings.workerRoot!=='string'||!settings.workerRoot.startsWith('/')||/[\r\n\0]/.test(settings.workerRoot)||!Number.isInteger(settings.workerPort)||settings.workerPort<1024||settings.workerPort>65535)throw Error('Invalid legacy worker target');
 try{const {stdout}=await execute('wsl.exe',['-d',settings.distribution,'--','python3','-B','-c',LEGACY_WORKER_START_PROBE,settings.workerRoot,String(settings.workerPort)],{windowsHide:true,timeout:6000,maxBuffer:8192});const value=JSON.parse(stdout.trim());return {status:['available','same_root_controller','occupied','unknown'].includes(value?.status)?value.status:'unknown'};}catch{return {status:'unknown'};}
}
