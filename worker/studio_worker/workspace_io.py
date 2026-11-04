"""Bounded authoring I/O; writes never escape project-owned inputs."""
import codecs
import hashlib
import os
import tempfile
from pathlib import Path
from .util import contained,digest

TEXT={'.py','.json','.yaml','.yml','.in','.txt','.cfg','.xyz','.extxyz','.cif','.pdb','.vasp','.md','.svg','.log','.out'}
def read_input(service,data):
 project=service.store.get('project',data['project_id']);name=data['name']
 if not isinstance(name,str) or not name or len(name)>4096:raise ValueError('Input name or authorized absolute path required')
 root=service.root/'projects'/project['id']/'inputs'
 roots=project['policy']['input_roots']+[str(root)]+[r['directory'] for r in service.store.runs() if r['project_id']==project['id']]
 raw=name if Path(name).is_absolute() else root/service.input_name(name)
 from .tools.archive_guard import assert_guidance_read,guard_path_before_resolve
 guard_path_before_resolve(service,raw)
 path=contained(raw,roots)
 assert_guidance_read(service,path)
 if not path.is_file():raise ValueError('Input file does not exist')
 offset=data.get('offset',0)
 if type(offset)is not int or offset<0:raise ValueError('Nonnegative byte offset required')
 size=path.stat().st_size;sha=digest(path)
 result={'path':str(path),'name':name,'sha256':sha,'size':size,'scope':'Read from existing project authorization; no execution or model deserialization'}
 if path.suffix.lower() not in TEXT and path.name not in ('POSCAR','INCAR','KPOINTS'):return {**result,'binary':True,'text':None}
 with path.open('rb') as stream:stream.seek(offset);chunk=stream.read(256*1024)
 if b'\x00' in chunk:return {**result,'binary':True,'text':None}
 if digest(path)!=sha:raise ValueError('Input changed during read; retry the current file')
 decoder=codecs.getincrementaldecoder('utf-8')('strict')
 try:text=decoder.decode(chunk,final=offset+len(chunk)>=size)
 except UnicodeDecodeError:return {**result,'binary':True,'text':None,'reason':'Input is not valid UTF-8 text'}
 pending,_=decoder.getstate();consumed=len(chunk)-len(pending)
 return {**result,'binary':False,'text':text,'offset':offset+consumed,'truncated':offset+consumed<size}

def write_input(service,data,admin=False):
 project=service.store.get('project',data['project_id']);name=service.input_name(data['name']);content=data['content']
 if len(Path(name).parts)>12:raise ValueError('Input nesting exceeds 12 levels')
 if not isinstance(content,str) or len(content.encode('utf-8'))>2*1024*1024:raise ValueError('Input source exceeds 2 MiB')
 root=contained(service.root/'projects'/project['id']/'inputs',[service.root]);root.mkdir(parents=True,exist_ok=True)
 raw=root/name
 if raw.is_symlink():raise ValueError('Symlink input targets are not allowed')
 target=contained(raw,[root]);target.parent.mkdir(parents=True,exist_ok=True);encoded=content.encode('utf-8');sha=hashlib.sha256(encoded).hexdigest()
 with service.store.lock:
  exists=target.exists();old=digest(target) if exists else None;expected=data.get('expected_sha256')
  if expected is not None and (not isinstance(expected,str) or len(expected)!=64 or expected!=old):raise ValueError('Input hash conflict; read the current input and review changes before retrying')
  if exists and old!=sha and not admin and expected is None:raise ValueError('Existing input needs expected_sha256 from read_project_input before replacement')
  if old!=sha:
   fd,temp=tempfile.mkstemp(prefix='.studio-write-',dir=target.parent)
   try:
    with os.fdopen(fd,'wb') as stream:stream.write(encoded)
    os.replace(temp,target)
   finally:
    if os.path.exists(temp):os.unlink(temp)
 return {'path':str(target),'name':name,'sha256':sha,'size':len(encoded),'previous_sha256':old,'status':'saved'}
