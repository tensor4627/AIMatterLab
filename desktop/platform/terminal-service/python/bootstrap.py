"""Small fixed loader. Only hash-verified transport code is executed."""
import base64,hashlib,json,os,re,stat,sys
from pathlib import Path

_n=sys.argv[1]
if not re.fullmatch('[a-f0-9]{64}',_n):raise SystemExit(2)
_p='__STUDIO_SERVICE_V1__:'+_n+':'
_old=None;_phase='waiting_python'
_codes=set('python_unsupported sqlite_unavailable tty_unavailable invalid_hello protocol_failed transport_hash_mismatch transport_cache_invalid worker_hash_mismatch worker_cache_invalid namespace_unsafe permission_denied storage_unavailable worker_start_timeout worker_start_failed worker_identity_unavailable worker_health_invalid service_request_unconfirmed internal_error'.split())
_phases=set('waiting_python checking_cache transferring_transport transferring_worker preparing_runtime starting_worker checking_health request'.split())
class Failure(Exception):
 def __init__(self,code,phase=None):self.code=code;self.phase=phase or _phase
class Stopped(Exception):pass
def send(k,i,v,final=False):
 sys.stdout.write(_p+k+':'+str(i)+':'+base64.b64encode(json.dumps(v,separators=(',',':')).encode()).decode()+('\n' if final else '\r\n'));sys.stdout.flush()
def restore():
 global _old
 if _old is not None:
  import termios
  termios.tcsetattr(0,termios.TCSANOW,_old);_old=None
def read():
 line=sys.stdin.buffer.readline(16385)
 if not line or len(line)>16384:raise Failure('protocol_failed')
 a=line.decode('ascii').rstrip('\r\n').split(':')
 if len(a)!=5 or ':'.join(a[:2])+':'!=_p:raise Failure('protocol_failed')
 v=json.loads(base64.b64decode(a[4],validate=True))
 if not isinstance(v,dict):raise Failure('protocol_failed')
 if a[2]=='STOP' and re.fullmatch('[A-Za-z0-9_-]{1,100}',a[3]) and v=={}:
  e=Stopped();e.identifier=a[3];raise e
 return a[2],a[3],v
def phase(value):
 global _phase
 _phase=value
 if value in ('preparing_runtime','starting_worker','checking_health'):send('PHASE','-',{'phase':value})
def private(path,create=False):
 home=Path.home().resolve()
 if not path.is_relative_to(home):raise Failure('namespace_unsafe')
 for p in [home,*[home.joinpath(*path.relative_to(home).parts[:i]) for i in range(1,len(path.relative_to(home).parts)+1)]]:
  if not p.exists() and not p.is_symlink():
   if not create:return False
   p.mkdir(mode=0o700)
  s=p.lstat()
  if p.is_symlink() or not stat.S_ISDIR(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o022:raise Failure('namespace_unsafe')
 return True
def main():
 global _old
 if sys.stdin.isatty():
  try:
   import termios,tty
   _old=termios.tcgetattr(0);tty.setraw(0)
   sys.stdout.write('\x1b[2J\x1b[3J\x1b[H');sys.stdout.flush()
  except Exception:raise Failure('tty_unavailable')
 if sys.version_info<(3,10):raise Failure('python_unsupported')
 try:import sqlite3
 except ImportError:raise Failure('sqlite_unavailable')
 send('BOOTSTRAP_READY','-',{'protocol':2,'python':list(sys.version_info[:3]),'sqlite':[int(x) for x in sqlite3.sqlite_version.split('.')[:3]],'capabilities':{'responseEncodings':['gzip-fragments-v1'],'uploadChunkBytes':[2048,4096,8192],'workerEncodings':['gzip-files-v1']}})
 k,i,h=read()
 fields=set('schema_version profile_id port expected_runtime_id worker_manifest_sha256 transport_sha256 transport_size worker_gzip_size worker_gzip_sha256 worker_size worker_sha256'.split())
 if k!='HELLO' or i!='-' or not fields<=set(h) or set(h)-fields-{'response_encoding','upload_chunk_bytes','worker_encoding'} or h['schema_version']!=2 or not isinstance(h['profile_id'],str) or not re.fullmatch('[A-Za-z0-9_-]{1,100}',h['profile_id']) or type(h['port']) is not int or not 1024<=h['port']<=65535:raise Failure('invalid_hello')
 for key in ['worker_manifest_sha256','transport_sha256','worker_gzip_sha256','worker_sha256']:
  if not isinstance(h[key],str) or not re.fullmatch('[a-f0-9]{64}',h[key]):raise Failure('invalid_hello')
 if h['expected_runtime_id']!=h['worker_manifest_sha256'][:20]:raise Failure('invalid_hello')
 for key,limit in [('transport_size',131072),('worker_gzip_size',8388608),('worker_size',16777216)]:
  if type(h[key]) is not int or not 0<h[key]<=limit:raise Failure('invalid_hello')
 if h.get('worker_encoding') not in (None,'gzip-files-v1'):raise Failure('invalid_hello')
 if h.get('response_encoding') not in (None,'gzip-fragments-v1') or h.get('upload_chunk_bytes',2048) not in (2048,4096,8192):raise Failure('invalid_hello')
 phase('checking_cache')
 folder=Path.home().resolve()/'.local/state/gpu-sampling-studio/ssh-transport-v2'/h['transport_sha256'];file=folder/'bridge.py';code=None
 if private(folder) and (file.exists() or file.is_symlink()):
  s=file.lstat()
  if file.is_symlink() or not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o022 or s.st_size!=h['transport_size']:raise Failure('transport_cache_invalid')
  code=file.read_bytes()
  if hashlib.sha256(code).hexdigest()!=h['transport_sha256']:raise Failure('transport_cache_invalid')
 cached=code is not None
 if not cached:
  phase('transferring_transport');send('TRANSPORT_NEEDED','-',{});b=bytearray();index=0
  while True:
   k,i,v=read()
   if k=='TRANSPORT_END' and i=='-':
    if v!={'size':h['transport_size'],'sha256':h['transport_sha256']} or len(b)!=h['transport_size'] or hashlib.sha256(b).hexdigest()!=h['transport_sha256']:raise Failure('transport_hash_mismatch')
    code=bytes(b);break
   if k!='INSTALL' or i!=str(index) or set(v)!={'chunk'}:raise Failure('protocol_failed')
   c=base64.b64decode(v['chunk'],validate=True)
   if not 0<len(c)<=h.get('upload_chunk_bytes',2048) or len(b)+len(c)>h['transport_size']:raise Failure('transport_hash_mismatch')
   b.extend(c);send('ACK',index,{'accepted':index});index+=1
  private(folder,True)
  temporary=folder/('.'+os.urandom(12).hex()+'.tmp')
  try:
   with temporary.open('xb') as f:f.write(code)
   temporary.chmod(0o444);temporary.replace(file)
  finally:
   if temporary.exists():temporary.unlink()
 send('HELPER_READY','-',{'cached':cached})
 scope={'__name__':'studio_transport_v2'};exec(compile(code,'<studio-service-transport>','exec'),scope)
 scope['run'](h,_n,read,send,phase,restore,_old)
try:main()
except Stopped as e:
 restore();send('STOPPED',e.identifier,{},True)
except Exception as e:
 code=getattr(e,'code','internal_error');p=getattr(e,'phase',_phase)
 if isinstance(e,PermissionError):code='permission_denied'
 elif isinstance(e,OSError):code='storage_unavailable'
 v={'code':code if code in _codes else 'internal_error','phase':p if p in _phases else _phase,'python':list(sys.version_info[:3])}
 number=getattr(e,'errno',None)
 if type(number) is int and 0<number<65536:v['errno']=number
 try:send('ERROR','-',v);restore();send('EXITED','-',{'reason':'failed'},True)
 except Exception:pass
finally:
 try:restore()
 except Exception:pass
