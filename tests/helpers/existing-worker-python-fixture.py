"""Execute the shipped Python helper against synthetic proc/socket/HTTP objects.

This fixture starts no service and imports no scientific worker or engine.
"""
import contextlib
import io
import json
import sys
import concurrent.futures
from types import SimpleNamespace

payload=json.loads(sys.stdin.read())
space={}
exec(payload['common'],space)
mode=payload['mode']
events=[]
counts={}
uid=1000
port=8767
root='/fixture/worker'
def count(key):
 counts[key]=counts.get(key,0)+1
 return counts[key]
class FakePath:
 def __init__(self,path): self.path=str(path)
 def __str__(self): return self.path
 def __truediv__(self,name): return FakePath(self.path+'/'+name)
 @property
 def name(self): return self.path.rsplit('/',1)[-1]
 def resolve(self): return self
 def expanduser(self): return self
 def is_file(self): return mode!='missing-descriptor'
 def is_symlink(self): return mode=='symlink'
 def stat(self): return SimpleNamespace(st_uid=uid+1 if mode=='uid' else uid)
 def iterdir(self):
  if self.path=='/proc': return iter([FakePath('/proc/7')])
  if self.path=='/proc/7/fd':
   if mode=='fd-denied': raise PermissionError('Synthetic denial')
   return iter([FakePath('/proc/7/fd/8')])
  raise OSError('Synthetic missing directory')
 def read_bytes(self):
  n=count('argv')
  argv=['python3','-m','studio_worker.server','--root',root,'--port',str(port)]
  if mode=='argv-substring': argv[2]='other.studio_worker.server'
  if mode=='argv-extra': argv+=['--extra']
  if mode=='root': argv[4]='/other-root'
  if mode=='port': argv[6]='8768'
  if mode=='changed-argv' and n>1: argv[4]='/changed-root'
  return ('\0'.join(argv)+'\0').encode()
 def read_text(self):
  if self.path.endswith('connection.json'): return json.dumps({'admin':'fixture-admin','mcp':'fixture-mcp'})
  if self.path.endswith('/stat'):
   n=count('start')
   if mode=='pid-exit' and n>1: raise FileNotFoundError('Synthetic exit')
   return '7 (python3) '+' '.join(['0']*19+['11' if mode=='pid-reuse' and n>1 else '10'])
  if self.path=='/proc/net/tcp':
   count('tcp')
   remote='0100007F:C350' if mode!='tuple' else '0100007F:C351'
   inode='0' if mode=='no-inode' else '123'
   return 'header\n0: 0100007F:'+format(port,'04X')+' '+remote+' 01 0 0 0 '+str(uid)+' 0 '+inode
  raise OSError('Synthetic missing file')
class FakeSocket:
 def getsockname(self): return ('127.0.0.1',50000)
 def settimeout(self,value): pass
class FakeHTTP:
 def __init__(self,*args,**kwargs): self.sock=None;events.append({'kind':'http'})
 def request(self,method,target,body=None,headers=None):
  assert self.sock is last_socket[0], 'Must authenticate the same verified stream'
  assert self.auto_open==0, 'Must not reconnect implicitly'
  events.append({'kind':'request','target':target,'auth':headers['Authorization']})
 def getresponse(self):
  health={'name':'gpu-sampling-studio','root':root,'runtime':'/fixture/runtime','execution_policy':'desktop-review-v1'}
  if mode.startswith('health-'): health[mode.removeprefix('health-')]='bad'
  return SimpleNamespace(status=200,read=lambda *args:json.dumps(health).encode())
 def close(self): events.append({'kind':'close'})
last_socket=[None]
def connect(*args,**kwargs):
 count('connect')
 last_socket[0]=FakeSocket()
 return last_socket[0]
space.update(Path=FakePath,os=SimpleNamespace(getuid=lambda:uid,readlink=lambda fd:'socket:[999]' if mode=='inode' or mode=='later-owner' and counts.get('connect',0)>1 else 'socket:[123]'),socket=SimpleNamespace(create_connection=connect),time=SimpleNamespace(sleep=lambda value:None),http=SimpleNamespace(client=SimpleNamespace(HTTPConnection=FakeHTTP)))
class ImmediatePool:
 def __init__(self,**kwargs): pass
 def __enter__(self): return self
 def __exit__(self,*args): pass
 def submit(self,fn,*args): return fn(*args)
concurrent.futures.ThreadPoolExecutor=ImmediatePool
space['sys']=SimpleNamespace(argv=['helper',root,str(port)],stdin=io.StringIO('\n'.join(json.dumps(value) for value in payload.get('requests',[]))))
output=io.StringIO()
with contextlib.redirect_stdout(output): exec(payload['body'],space)
print(json.dumps({'events':events,'counts':counts,'output':output.getvalue()}))
