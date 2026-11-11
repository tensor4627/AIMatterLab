import base64,hashlib,json,re,sys
_n=sys.argv[1]
if not re.fullmatch('[a-f0-9]{64}',_n):raise SystemExit(2)
_old=None
if sys.stdin.isatty():
 import termios,tty
 _old=termios.tcgetattr(0);tty.setraw(0)
_p='__STUDIO_SERVICE_V1__:'+_n+':'
def _send(k,i,v):
 sys.stdout.write(_p+k+':'+str(i)+':'+base64.b64encode(json.dumps(v,separators=(',',':')).encode()).decode()+'\r\n');sys.stdout.flush()
try:
 _send('BOOTSTRAP_READY','-',{'protocol':1});_b=bytearray();_i=0
 while True:
  _l=sys.stdin.buffer.readline(16385)
  if not _l or len(_l)>16384:raise ValueError()
  _a=_l.decode('ascii').rstrip('\r\n').split(':')
  if len(_a)!=5 or ':'.join(_a[:2])+':'!=_p:raise ValueError()
  _v=json.loads(base64.b64decode(_a[4],validate=True))
  if _a[2]=='INSTALL':
   if _a[3]!=str(_i) or set(_v)!={'chunk'}:raise ValueError()
   _c=base64.b64decode(_v['chunk'],validate=True)
   if not 0<len(_c)<=2048 or len(_b)+len(_c)>16777216:raise ValueError()
   _b.extend(_c);_send('ACK',_i,{'accepted':_i});_i+=1
  elif _a[2]=='INSTALL_END':
   if set(_v)!={'size','sha256'} or _v['size']!=len(_b) or _v['sha256']!=hashlib.sha256(_b).hexdigest():raise ValueError()
   _d=json.loads(_b);_f=[f for f in _d['files'] if f['path']=='ssh_service_bridge.py']
   if len(_f)!=1:raise ValueError()
   _s=base64.b64decode(_f[0]['base64'],validate=True)
   if hashlib.sha256(_s).hexdigest()!=_f[0]['sha256']:raise ValueError()
   exec(compile(_s,'<studio-service-bridge>','exec'),{'__name__':'__main__','STUDIO_SERVICE_PAYLOAD':_d,'STUDIO_SERVICE_NONCE':_n,'STUDIO_SERVICE_ORIGINAL_TERMIOS':_old});break
  elif _a[2]=='STOP' and _v=={}:
   if _old is not None:termios.tcsetattr(0,termios.TCSANOW,_old);_old=None
   _send('STOPPED',_a[3],{});break
  else:raise ValueError()
except Exception:_send('ERROR','-',{'code':'service_bootstrap_failed'})
finally:
 if _old is not None:termios.tcsetattr(0,termios.TCSANOW,_old)
