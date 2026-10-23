"""Private custom CV private immutable CV library with local Git history.
Privileged approval methods are never MCP tools. Formula compilation is data-only.
"""
import copy,datetime,hashlib,json,os,re,secrets,stat,subprocess,threading
from pathlib import Path
from .custom_formula import schema,sha,stable,module_source,parameter_values

SCHEMA_VERSION=1
GENERATOR_VERSION='typed-formula-v1'

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
class Registry:
 def __init__(self,root):
  raw=Path(root).absolute()
  if raw.is_symlink() or raw.resolve()!=raw:raise ValueError('Private CV library cannot be linked')
  raw.mkdir(parents=True,exist_ok=True);self.root=raw;self.lock=threading.RLock()
  for name in ('entries','specs','values','sources','approvals','reports','numerical','.empty-hooks'):
   target=raw/name
   if target.is_symlink() or target.exists() and not target.is_dir():raise ValueError('Linked private library child refused')
   target.mkdir(exist_ok=True)
  empty=raw/'.empty-attributes'
  if not empty.exists():self._write(empty,b'')
  if not (raw/'.git').exists():
   self.git('init','--quiet');self._write(raw/'.gitignore',b'numerical/\n.empty-hooks/\n.empty-attributes\npending.json\n*.tmp\n');self.git('add','--','.gitignore');self.git('commit','--quiet','-m','Initialize private custom CV library')
  self._git_root()
 def _git_safety(self):
  hooks=self.root/'.empty-hooks'
  if hooks.is_symlink()or hooks.resolve()!=hooks or not hooks.is_dir()or any(hooks.iterdir()):raise ValueError('Private Git hooks must remain an actual empty directory')
  attributes=self.root/'.empty-attributes'
  if self._bytes(attributes,1)!=b'':raise ValueError('Private Git empty attributes file changed')
  for folder in ('','entries','specs','values','sources','approvals','reports'):
   if (self.root/folder/'.gitattributes').exists()or(self.root/folder/'.gitattributes').is_symlink():raise ValueError('Private Git attributes are not permitted')
  gitdir=self.root/'.git'
  if not gitdir.exists():return
  if gitdir.is_symlink()or not gitdir.is_dir()or gitdir.resolve()!=gitdir:raise ValueError('Private Git directory cannot be linked')
  count=0
  for parent,dirs,files in os.walk(gitdir,followlinks=False):
   count+=len(dirs)+len(files)
   if count>16384:raise ValueError('Private Git control files exceed the bounded audit budget')
   if any((Path(parent)/name).is_symlink()for name in[*dirs,*files]):raise ValueError('Linked private Git control file refused')
  for name in ('info/attributes','objects/info/alternates','objects/info/http-alternates','config.worktree'):
   if (gitdir/name).exists():raise ValueError('Private Git external attributes/objects/worktree config are not permitted')
  config=self._bytes(gitdir/'config',8192).decode('utf8');section=None;allowed={'repositoryformatversion','filemode','bare','logallrefupdates','ignorecase','precomposeunicode','symlinks'}
  for line in config.splitlines():
   line=line.strip()
   if not line or line.startswith(('#',';')):continue
   if line.startswith('['):
    if line!='[core]':raise ValueError('Unreviewed private repository Git configuration section')
    section='core';continue
   if section!='core'or'='not in line:raise ValueError('Unreviewed private repository Git configuration')
   key,value=(part.strip()for part in line.split('=',1));key=key.lower();value=value.lower()
   if key not in allowed or key=='repositoryformatversion'and value!='0'or key=='bare'and value!='false'or key not in('repositoryformatversion','bare')and value not in('true','false'):raise ValueError('Executable or nonstandard private Git configuration refused')
 def git(self,*args):
  self._git_safety()
  command=['git','-c','user.name=GPU Sampling Studio','-c','user.email=studio@localhost','-c','commit.gpgsign=false','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','maintenance.auto=false','-c','gc.auto=0','-c','core.attributesFile='+str(self.root/'.empty-attributes'),'-c','core.hooksPath='+str(self.root/'.empty-hooks'),*args]
  env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
  env.update(GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL=os.devnull,GIT_TERMINAL_PROMPT='0')
  result=subprocess.run(command,cwd=self.root,env=env,capture_output=True,timeout=20)
  if result.returncode:raise ValueError('Private library Git operation failed: '+result.stderr.decode('utf8','replace')[-512:])
  return result.stdout.decode('utf8')
 def _write(self,path,data):
  if path.is_symlink() or path.parent.resolve()!=path.parent:raise ValueError('Linked private CV file refused')
  temp=path.with_name(path.name+'.'+secrets.token_hex(8)+'.tmp')
  try:
   with temp.open('xb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
   os.replace(temp,path)
  finally:
   if temp.exists():temp.unlink()
 def _git_root(self):
  control=self.root/'.git'
  if control.is_symlink() or not control.is_dir() or control.resolve()!=control:raise ValueError('Private library requires its own actual Git directory')
  actual=Path(self.git('rev-parse','--show-toplevel').strip()).resolve()
  gitdir=Path(self.git('rev-parse','--absolute-git-dir').strip()).resolve()
  common=Path(self.git('rev-parse','--path-format=absolute','--git-common-dir').strip()).resolve()
  if actual!=self.root or gitdir!=control or common!=control:raise ValueError('Private CV Git root differs')
 def _bytes(self,path,limit=262144):
  if path.parent.resolve()!=path.parent or path.resolve()!=path or path.is_symlink():raise ValueError('Linked private object refused')
  fd=os.open(path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
  try:
   before=os.fstat(fd)
   if not stat.S_ISREG(before.st_mode) or before.st_size>limit:raise ValueError('Private object exceeds bounded regular file contract')
   with os.fdopen(fd,'rb',closefd=False)as stream:data=stream.read(limit+1)
   after=os.fstat(fd);current=path.stat()
   if len(data)>limit or path.is_symlink() or path.resolve()!=path or (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns) or (after.st_dev,after.st_ino)!=(current.st_dev,current.st_ino):raise ValueError('Private object changed during read')
  finally:os.close(fd)
  return data
 def _hash(self,value):
  if not isinstance(value,str)or not re.fullmatch('[0-9a-f]{64}',value):raise ValueError('Invalid immutable object identity')
  return value
 def _object_path(self,kind,identity,suffix='.json'):
  if kind not in ('specs','values','sources','approvals','reports'):raise ValueError('Unknown private object kind')
  if suffix!=('.py'if kind=='sources'else'.json'):raise ValueError('Private object suffix differs')
  return self.root/kind/(self._hash(identity)+suffix)
 def _object(self,kind,identity,data,suffix='.json'):
  path=self._object_path(kind,identity,suffix)
  if hashlib.sha256(data).hexdigest()!=identity:raise ValueError('Private object bytes differ from identity')
  if path.exists():
   if self._bytes(path)!=data:raise ValueError('Immutable private CV object differs')
  else:self._write(path,data)
  return path.relative_to(self.root).as_posix()
 def _load(self,kind,identity):
  raw=self._bytes(self._object_path(kind,identity,'.py'if kind=='sources'else'.json'))
  if hashlib.sha256(raw).hexdigest()!=identity:raise ValueError('Immutable private CV object hash differs')
  if kind=='sources':return raw.decode('utf8')
  value=json.loads(raw)
  if stable(value)!=raw:raise ValueError('Private object is not the approved canonical JSON')
  return value
 def _id(self,identifier):
  if not isinstance(identifier,str) or not re.fullmatch('[0-9a-f]{24}',identifier):raise ValueError('Invalid private CV id')
  return identifier
 def _available(self):
  self._git_root()
  if (self.root/'pending.json').exists():raise ValueError('Interrupted private library commit; explicit recovery required')
 def _read(self,identifier):
  self._available()
  name='entries/'+self._id(identifier)+'.json';raw=self._bytes(self.root/name,65536)
  if self.git('show','HEAD:'+name).encode('utf8')!=raw:raise ValueError('Private CV entry differs from its committed revision')
  item=json.loads(raw)
  if item.get('id')!=identifier or item.get('schema_version')!=SCHEMA_VERSION or item.get('generator_version')!=GENERATOR_VERSION:raise ValueError('Unsupported private CV entry schema/generator')
  if not isinstance(item.get('revision'),str)or not re.fullmatch('[0-9a-f]{32}',item['revision']):raise ValueError('Invalid private CV revision')
  for key in ('spec_sha256','parameters_sha256'):self._hash(item.get(key))
  spec=self._load('specs',item['spec_sha256']);schema(spec)
  values=self._load('values',item['parameters_sha256']);parameter_values(spec,values,False)
  if item.get('code_sha256'):
   source=self._load('sources',item['code_sha256'])
   generated=module_source(spec)
   if source!=generated['source']or item.get('class_name')!=generated['class_name']:raise ValueError('Implementation differs from its approved deterministic generator')
  for key,kind in (('formula_approval','human_formula_confirmation'),('code_approval','human_implementation_review')):
   receipt=item.get(key)
   if receipt:
    if self._load('approvals',sha(receipt))!=receipt or receipt.get('kind')!=kind or receipt.get('spec_sha256')!=item['spec_sha256']or key=='code_approval'and receipt.get('code_sha256')!=item.get('code_sha256'):raise ValueError('Private approval source/identity differs')
  if item.get('numerical_receipt_sha256') and self._load('reports',item['numerical_receipt_sha256'])!=item.get('numerical'):raise ValueError('Private numerical receipt differs')
  return item
 def _cas(self,identifier,expected):
  item=self._read(identifier)
  actual={k:item.get(k) for k in ('spec_sha256','code_sha256','parameters_sha256','revision')}
  if actual!=expected:raise ValueError('Private CV revision conflict; reload before changing it')
  return item
 def _save(self,item,message,paths=()):
  self._available()
  if self.git('diff','--cached','--name-only').strip():raise ValueError('Private library has unrelated staged changes; commit blocked')
  item={**item,'schema_version':SCHEMA_VERSION,'generator_version':GENERATOR_VERSION,'revision':secrets.token_hex(16),'updated_at':now()};name='entries/'+self._id(item['id'])+'.json'
  target=self.root/name;old=self._bytes(target,65536)if target.exists()else None;new=stable(item)
  journal={'schema_version':1,'head_before':self.git('rev-parse','HEAD').strip(),'entry':name,'old_hex':old.hex()if old is not None else None,'old_sha256':hashlib.sha256(old).hexdigest()if old is not None else None,'new_sha256':hashlib.sha256(new).hexdigest(),'paths':[name,*paths]}
  self._write(self.root/'pending.json',stable(journal))
  self._write(target,new)
  # Any failure below keeps the durable journal and blocks all further approvals.
  self.git('add','--',name,*paths);self.git('commit','--quiet','-m',message)
  committed=self.git('show','HEAD:'+name).encode('utf8')
  if committed!=new:raise ValueError('Private commit did not preserve the exact approved entry')
  (self.root/'pending.json').unlink()
  return self.read(item['id'])
 def pending(self):
  path=self.root/'pending.json'
  if not path.exists():return None
  raw=self._bytes(path,262144);return {'sha256':hashlib.sha256(raw).hexdigest(),'journal':json.loads(raw),'status':'blocked'}
 def recover(self,expected_sha256):
  """Human-only explicit repair. No resets or unrelated index/worktree writes."""
  with self.lock:
   self._git_root();pending=self.pending()
   if not pending or pending['sha256']!=self._hash(expected_sha256):raise ValueError('Private recovery journal conflict')
   journal=pending['journal'];name=journal.get('entry','')
   if not re.fullmatch(r'entries/[0-9a-f]{24}\.json',name):raise ValueError('Unsafe recovery entry')
   paths=journal.get('paths',[])
   for path in paths:
    if path==name:continue
    if not re.fullmatch(r'(specs|values|approvals|reports)/[0-9a-f]{64}\.json|sources/[0-9a-f]{64}\.py',path):raise ValueError('Unsafe recovery object')
    raw=self._bytes(self.root/path)
    if hashlib.sha256(raw).hexdigest()!=Path(path).stem:raise ValueError('Recovery object changed')
   target=self.root/name;actual=hashlib.sha256(self._bytes(target,65536)).hexdigest()if target.exists()else None
   if actual not in (journal['old_sha256'],journal['new_sha256']):raise ValueError('Recovery pointer was externally changed')
   head=self.git('rev-parse','HEAD').strip()
   if head==journal['head_before']:
    self.git('restore','--staged','--',*paths)
    if journal['old_hex']is None:
     if target.exists():target.unlink()
    else:
     old=bytes.fromhex(journal['old_hex'])
     if hashlib.sha256(old).hexdigest()!=journal['old_sha256']:raise ValueError('Recovery previous pointer differs')
     self._write(target,old)
    state='rolled_back_pointer'
   else:
    if actual!=journal['new_sha256']or hashlib.sha256(self.git('show','HEAD:'+name).encode('utf8')).hexdigest()!=actual:raise ValueError('Git advanced without the exact committed private entry; repair blocked')
    state='completed_commit'
   (self.root/'pending.json').unlink();return {'status':'passed','recovery':state,'scope':'Owned pointer/index only; immutable objects retained'}
 def read(self,identifier,provider=None):
  with self.lock:
   item=self._read(identifier);result=copy.deepcopy(item);result['expected']={k:item.get(k) for k in ('spec_sha256','code_sha256','parameters_sha256','revision')}
   result['spec']=self._load('specs',item['spec_sha256']);result['parameter_values']=self._load('values',item['parameters_sha256'])
   if provider is not None and not item.get('sharing',{}).get(provider):return {'id':identifier,'name':item['name'],'sharing':'permission_required','scope':'Private formula/source not shared with this provider'}
   if item.get('code_sha256'):result['code']=self._load('sources',item['code_sha256'])
   result['git_commit']=self.git('rev-parse','HEAD').strip();return result
 def list(self):
  with self.lock:
   self._available();return [{k:item.get(k) for k in ('id','name','workspace_id','project_id','revision','spec_sha256','code_sha256','parameters_sha256','formula_approval','code_approval','numerical','updated_at')} for p in sorted((self.root/'entries').glob('*.json')) for item in [self._read(p.stem)]]
 def propose(self,spec,values,*,workspace_id,project_id,identifier=None,expected=None):
  with self.lock:
   self._available()
   if any(not isinstance(value,str)or not 1<=len(value)<=128 or any(ord(c)<32 for c in value) for value in (workspace_id,project_id)):raise ValueError('Bounded owned workspace/project identifiers required')
   spec=schema(spec);values,missing=parameter_values(spec,values,complete=False);spec_sha=sha(spec);values_sha=sha(values)
   old=self._cas(identifier,expected) if identifier else {};identifier=identifier or secrets.token_hex(12)
   if old and (old['project_id']!=project_id or old['workspace_id']!=workspace_id):raise ValueError('Update only the conversation-owned custom CV; attach an existing revision explicitly')
   same=old.get('spec_sha256')==spec_sha;unchanged=same and old.get('parameters_sha256')==values_sha
   item={**old,'id':identifier,'name':spec['name'],'workspace_id':workspace_id,'project_id':project_id,'spec_sha256':spec_sha,'parameters_sha256':values_sha,'missing_parameters':missing}
   if not same:item.update(code_sha256=None,class_name=None,formula_approval=None,code_approval=None,sharing={},numerical={'status':'not_run'},numerical_receipt_sha256=None)
   elif not unchanged:
    item['numerical']={'status':'not_run','reason':'Formula parameter values changed; prior reports retain their own immutable scope'};item['numerical_receipt_sha256']=None;item['sharing']={}
   paths=[self._object('specs',spec_sha,stable(spec)),self._object('values',values_sha,stable(values))]
   return self._save(item,'Propose private CV '+identifier,paths)
 def approve_formula(self,identifier,expected,*,provider=None,share=False):
  """Human-only service entry, called from sender-validated desktop action."""
  with self.lock:
   if type(share)is not bool:raise ValueError('Explicit private sharing boolean required')
   item=self._cas(identifier,expected);spec=self._load('specs',item['spec_sha256'])
   if (item.get('formula_approval') or {}).get('spec_sha256')==item['spec_sha256']:return self.read(identifier)
   receipt={'kind':'human_formula_confirmation','spec_sha256':item['spec_sha256'],'confirmed_at':now()};code=module_source(spec)
   item.update(formula_approval=receipt,code_sha256=code['code_sha256'],class_name=code['class_name'],code_approval=None,numerical={'status':'not_run'},numerical_receipt_sha256=None)
   if share:
    if provider not in ('codex','kimi','qwen','deepseek'):raise ValueError('Choose an exact provider sharing scope')
    item['sharing']={provider:True}
   paths=[self._object('sources',code['code_sha256'],code['source'].encode('utf8'),'.py'),self._object('approvals',sha(receipt),stable(receipt))]
   return self._save(item,'Confirm formula and generate private primitive '+identifier,paths)
 def approve_code(self,identifier,expected):
  with self.lock:
   item=self._cas(identifier,expected)
   if not item.get('formula_approval') or not item.get('code_sha256'):raise ValueError('Confirm the actual formula before reviewing generated code')
   receipt={'kind':'human_implementation_review','spec_sha256':item['spec_sha256'],'code_sha256':item['code_sha256'],'confirmed_at':now()};item['code_approval']=receipt
   return self._save(item,'Review private primitive implementation '+identifier,[self._object('approvals',sha(receipt),stable(receipt))])
 def share(self,identifier,expected,provider,enabled):
  with self.lock:
   item=self._cas(identifier,expected)
   if provider not in ('codex','kimi','qwen','deepseek') or type(enabled)is not bool:raise ValueError('Explicit private provider sharing scope required')
   item.setdefault('sharing',{})[provider]=enabled
   return self._save(item,'Update private CV sharing '+identifier)
 def record_numerical(self,identifier,expected,report):
  """Only the service-owned runner supplies a report; no arbitrary MCP report."""
  with self.lock:
   item=self._cas(identifier,expected)
   if not item.get('code_approval') or item.get('missing_parameters'):raise ValueError('Review implementation and complete typed values before numerical tests')
   for key in ('spec_sha256','code_sha256','parameters_sha256'):
    if report.get(key)!=item.get(key):raise ValueError('Numerical report targets a different private CV revision')
   if report.get('status')not in ('passed','failed','blocked','not_run','running','unknown'):raise ValueError('Invalid numerical check state')
   item['numerical']={**report,'scope':'Only the recorded structure/parameters/runtime and enumerated checks; stable-phase/physical suitability and consuming MD/bias target are separate'}
   item['numerical_receipt_sha256']=sha(item['numerical'])
   return self._save(item,'Record private CV numerical check '+identifier,[self._object('reports',sha(item['numerical']),stable(item['numerical']))])

 def reuse(self,identifier,expected,*,workspace_id,project_id):
  """Explicit human reuse creates a new owned entry, never transfers sharing/results."""
  with self.lock:
   old=self._cas(identifier,expected);spec=self._load('specs',old['spec_sha256']);values=self._load('values',old['parameters_sha256'])
   created=self.propose(spec,values,workspace_id=workspace_id,project_id=project_id)
   item=self._read(created['id'])
   for key in ('code_sha256','class_name','formula_approval','code_approval'):item[key]=copy.deepcopy(old.get(key))
   item.update(sharing={},numerical={'status':'not_run','reason':'Explicitly copied definition; current structure/runtime require fresh checks'},numerical_receipt_sha256=None,reuse_of={'id':old['id'],'revision':old['revision'],'spec_sha256':old['spec_sha256'],'code_sha256':old.get('code_sha256'),'scope':'Definition/implementation approval provenance only; no provider sharing or numerical/target validation transferred'})
   return self._save(item,'Reuse definition into a new conversation '+item['id'])
