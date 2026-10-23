"""POSIX admin-only create-or-identical using pinned no-follow project directories."""
import errno,hashlib,os,secrets,stat
from pathlib import Path
from .util import leaf

def materialize_input(service,data,admin=False):
    if not admin:raise PermissionError('Only the main-owned human stage can materialize inputs')
    if os.name!='posix':raise RuntimeError('Safe stage materialization requires the POSIX worker; no overwrite fallback')
    if not isinstance(data,dict)or set(data)!={'project_id','name','content'}or not isinstance(data['project_id'],str)or not isinstance(data['content'],str):raise ValueError('Exact typed project_id/name/content required')
    project_id=leaf(data['project_id']);name=service.input_name(data['name']);pieces=Path(name).parts
    if len(pieces)>12:raise ValueError('Input nesting exceeds12levels')
    encoded=data['content'].encode('utf-8')
    if not encoded or len(encoded)>2*1024*1024 or b'\x00'in encoded:raise ValueError('Materialized UTF-8 stage input must contain1byte to2MiB and no NUL')
    root=Path(service.root)
    if not root.is_absolute()or any(p in('.','..')for p in root.parts):raise ValueError('Explicit canonical worker root required')
    sha=hashlib.sha256(encoded).hexdigest();directory_flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW;fds=[];chain=[]
    identity=lambda st:(st.st_dev,st.st_ino)
    def open_directory(parent,part,create=False):
        if create:
            try:os.mkdir(part,mode=0o700,dir_fd=parent)
            except FileExistsError:pass
        fd=os.open(part,directory_flags,dir_fd=parent);fds.append(fd);observed=os.fstat(fd)
        if not stat.S_ISDIR(observed.st_mode):raise ValueError('A regular no-follow directory is required')
        chain.append((parent,part,fd,identity(observed)));return fd
    def check_chain():
        for parent,part,fd,expected in chain:
            actual=os.stat(part,dir_fd=parent,follow_symlinks=False)
            if not stat.S_ISDIR(actual.st_mode)or identity(actual)!=expected or identity(os.fstat(fd))!=expected:raise ValueError('Project directory path was linked or replaced; materialization is stale')
    with service.store.lock:
        project=service.store.get('project',project_id)
        if project['id']!=project_id:raise ValueError('Project identity differs')
        try:
            anchor=os.open('/',directory_flags);fds.append(anchor);parent=anchor
            for part in root.parts[1:]:parent=open_directory(parent,part)
            for part in ['projects',project_id,'inputs',*pieces[:-1]]:parent=open_directory(parent,part,True)
            filename=pieces[-1];check_chain()
            def same_existing():
                fd=os.open(filename,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent)
                try:
                    before=os.fstat(fd)
                    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or before.st_size!=len(encoded):raise ValueError('Existing stage input differs or is not a regular single-link file; never overwrite')
                    h=hashlib.sha256();count=0
                    while True:
                        block=os.read(fd,65536)
                        if not block:break
                        count+=len(block)
                        if count>len(encoded):raise ValueError('Existing input changed during read; never overwrite')
                        h.update(block)
                    after=os.fstat(fd)
                    if count!=len(encoded)or h.hexdigest()!=sha or (identity(before),before.st_size,before.st_mtime_ns,before.st_ctime_ns,before.st_nlink)!=(identity(after),after.st_size,after.st_mtime_ns,after.st_ctime_ns,after.st_nlink):raise ValueError('Existing stage input differs or changed; never overwrite')
                finally:os.close(fd)
            created=False
            try:same_existing()
            except FileNotFoundError:
                tmp='.studio-create-'+secrets.token_hex(16);fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent);created_identity=identity(os.fstat(fd))
                try:
                    offset=0
                    while offset<len(encoded):
                        size=os.write(fd,encoded[offset:])
                        if size<=0:raise OSError('Incomplete stage write')
                        offset+=size
                    os.fsync(fd);check_chain()
                    try:os.link(tmp,filename,src_dir_fd=parent,dst_dir_fd=parent,follow_symlinks=False);created=True
                    except FileExistsError:pass
                    os.unlink(tmp,dir_fd=parent)
                    try:check_chain();same_existing()
                    except Exception:
                        if created:
                            try:
                                current=os.stat(filename,dir_fd=parent,follow_symlinks=False)
                                if identity(current)==created_identity:os.unlink(filename,dir_fd=parent)
                            except FileNotFoundError:pass
                        raise
                finally:
                    os.close(fd)
                    try:os.unlink(tmp,dir_fd=parent)
                    except FileNotFoundError:pass
            check_chain()
            return {'path':str(root/'projects'/project_id/'inputs'/name),'name':name,'sha256':sha,'size':len(encoded),'status':'created'if created else'identical','scope':'Pinned no-follow project input create-or-identical; existing bytes never replaced, no authorization or execution'}
        except OSError as error:
            if error.errno in(errno.ELOOP,errno.ENOTDIR):raise ValueError('Linked or replaced directory/input refused')from error
            raise
        finally:
            for fd in reversed(fds):os.close(fd)
