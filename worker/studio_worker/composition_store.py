"""Journaled graph/source pair candidate. Caller supplies authorized root and lock.

 Two files cannot be atomically replaced together. A durable pending record blocks
 consumers on an interrupted write; success requires rereading both exact hashes.
 No engine, shell, registration, or execution is performed by this module.
 """
import hashlib,json,os,secrets,tempfile
from pathlib import Path
NAMES=("workflow.json","build_bias.py")
JOURNAL=".studio-composition.json"
def sha(data):return hashlib.sha256(data).hexdigest()
def encoded(value):return (json.dumps(value,ensure_ascii=False,allow_nan=False,sort_keys=True,indent=2)+"\n").encode("utf8")
class CompositionStore:
 def __init__(self,root,lock):
  self.root=Path(root).resolve(strict=True);self.lock=lock
 def owned(self,directory):
  raw=Path(directory)
  if not raw.is_absolute():raw=self.root/raw
  if raw.is_symlink() or raw.resolve()!=raw or not raw.is_relative_to(self.root) or raw==self.root:raise ValueError("Composition directory must be an owned unlinked child")
  for name in (*NAMES,JOURNAL):
   path=raw/name
   if path.is_symlink() or path.exists() and not path.is_file():raise ValueError("Composition files must be ordinary owned files")
  return raw
 def _replace(self,path,data):
  fd,name=tempfile.mkstemp(prefix=".studio-composition-",dir=path.parent)
  try:
   with os.fdopen(fd,"wb") as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
   os.replace(name,path)
  finally:
   if os.path.exists(name):os.unlink(name)
 def _read(self,path,limit):
  if path.is_symlink() or not path.is_file() or path.stat().st_size>limit:raise ValueError("Unavailable or oversized composition file")
  descriptor=os.open(path,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
  try:
   before=os.fstat(descriptor)
   with os.fdopen(descriptor,"rb",closefd=False) as stream:data=stream.read(limit+1)
   after=os.fstat(descriptor);current=path.stat()
   if len(data)>limit or path.is_symlink() or path.resolve()!=path or (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns) or (after.st_dev,after.st_ino)!=(current.st_dev,current.st_ino):raise ValueError("Composition file changed during read")
   return data
  finally:os.close(descriptor)
 def _state(self,directory):
  result={"directory":str(directory),"files":{}}
  for name in NAMES:
   path=directory/name
   if path.exists():
    data=self._read(path,2*1024*1024);result["files"][name]={"sha256":sha(data),"bytes":len(data),"data":data}
  path=directory/JOURNAL
  if not path.exists():return {**result,"status":"legacy" if result["files"] else "new","journal_sha256":None}
  data=self._read(path,16384);record=json.loads(data)
  result.update(journal_sha256=sha(data),record=record,status=record.get("status"))
  if record.get("schema")!="studio.composition/1" or result["status"] not in ("pending","draft","rendered"):raise ValueError("Unsupported composition journal")
  if result["status"]=="pending":return {**result,"status":"blocked","reason":"Interrupted graph/source save; explicit repair and review required"}
  actual={name:entry["sha256"] for name,entry in result["files"].items()}
  if actual!=record.get("files"):return {**result,"status":"blocked","reason":"Graph/source differs from its saved revision; rerender and review required"}
  return result
 def read(self,directory):
  with self.lock:
   current=self._state(self.owned(directory));result={k:v for k,v in current.items() if k!="files"}
   result["files"]={name:{k:v for k,v in entry.items() if k!="data"} for name,entry in current["files"].items()}
   if "workflow.json" in current["files"]:result["graph"]=json.loads(current["files"]["workflow.json"]["data"])
   # Source is a derived artifact only when the pair is rendered and consistent.
   if current["status"]=="rendered":result["source"]=current["files"]["build_bias.py"]["data"].decode("utf8")
   return result
 def save(self,directory,graph,source,expected,*,repair=False,details=None):
  graph_bytes=encoded(graph)
  if len(graph_bytes)>1024*1024:raise ValueError("Graph exceeds 1 MiB")
  if source is not None and (not isinstance(source,str) or len(source.encode("utf8"))>2*1024*1024):raise ValueError("Rendered source exceeds 2 MiB")
  with self.lock:
   directory=self.owned(directory);directory.mkdir(parents=True,exist_ok=True);current=self._state(directory)
   if current["status"]=="blocked" and not repair:raise ValueError(current["reason"])
   identity={"journal_sha256":current["journal_sha256"],"files":{name:item["sha256"] for name,item in current["files"].items()}}
   if expected!=identity:raise ValueError("Composition hash conflict; read the current graph/source pair before retrying")
   files={name:entry["data"] for name,entry in current["files"].items()};files["workflow.json"]=graph_bytes
   if source is not None:files["build_bias.py"]=source.encode("utf8")
   target={name:sha(data) for name,data in files.items()};record={"schema":"studio.composition/1","revision":secrets.token_hex(16),"status":"pending","previous":identity,"files":target,"details":details or {}}
   self._replace(directory/JOURNAL,encoded(record))
   # The pending journal intentionally remains on any exception or crash.
   self._replace(directory/"workflow.json",graph_bytes)
   if source is not None:self._replace(directory/"build_bias.py",files["build_bias.py"])
   reread={name:sha(self._read(directory/name,2*1024*1024)) for name in files}
   if reread!=target:raise ValueError("Composition readback mismatch; partial save remains blocked")
   record["status"]="rendered" if source is not None else "draft";record.pop("previous")
   self._replace(directory/JOURNAL,encoded(record))
   return self.read(directory)
