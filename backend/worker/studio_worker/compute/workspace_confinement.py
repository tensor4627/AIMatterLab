"""Launch one reviewed login-host or scheduler command with a writable workspace."""
import ctypes as C
import errno
import os
import shutil
import stat
import subprocess
import sys


class Ruleset(C.Structure):
    _fields_ = [('fs', C.c_uint64), ('network', C.c_uint64), ('scope', C.c_uint64)]


class PathRule(C.Structure):
    _pack_ = 1
    _fields_ = [('access', C.c_uint64), ('parent_fd', C.c_int32)]


METADATA_WRITES = (
    'chmod', 'lchmod', 'fchmod', 'fchmodat', 'fchmodat2', 'chown', 'lchown', 'fchown', 'fchownat',
    'chown32', 'lchown32', 'fchown32', 'utime', 'utimes', 'futimesat', 'utimensat', 'utimensat_time64',
    'setxattr', 'lsetxattr', 'fsetxattr', 'setxattrat', 'removexattr', 'lremovexattr', 'fremovexattr', 'removexattrat',
    'io_uring_setup', 'io_uring_register', 'io_uring_enter', 'file_setattr',
)

# New kernel syscalls may predate the host's libseccomp name table. These
# numbers are shared by the two supported native architectures.
COMMON_SYSCALLS = {'io_uring_setup': 425, 'io_uring_enter': 426, 'io_uring_register': 427,
                   'fchmodat2': 452, 'setxattrat': 463, 'removexattrat': 466, 'file_setattr': 469}


def linux_call(call, *args):
    value = call(*args)
    if value < 0:
        number = C.get_errno()
        raise OSError(number, os.strerror(number))
    return value


def limit_metadata():
    library = C.CDLL('libseccomp.so.2', use_errno=True)
    library.seccomp_init.argtypes = (C.c_uint32,)
    library.seccomp_init.restype = C.c_void_p
    library.seccomp_syscall_resolve_name.argtypes = (C.c_char_p,)
    library.seccomp_rule_add.argtypes = (C.c_void_p, C.c_uint32, C.c_int, C.c_uint)
    library.seccomp_load.argtypes = library.seccomp_release.argtypes = (C.c_void_p,)
    context = library.seccomp_init(0x7fff0000)  # SCMP_ACT_ALLOW
    if not context:
        raise OSError('seccomp context unavailable')
    try:
        denied = 0x00050000 | errno.EPERM  # SCMP_ACT_ERRNO(EPERM)
        for name in METADATA_WRITES:
            number = library.seccomp_syscall_resolve_name(name.encode('ascii'))
            if number < 0:
                number = COMMON_SYSCALLS.get(name, -1)
            if number >= 0 and library.seccomp_rule_add(context, denied, number, 0) != 0:
                raise OSError('seccomp metadata rule unavailable')
        if library.seccomp_load(context) != 0:
            raise OSError('seccomp metadata filter unavailable')
    finally:
        library.seccomp_release(context)


def landlock(roots, devices):
    # Linux x86-64 and arm64 use these system call numbers. Other targets
    # can use the mount namespace implementation below.
    if sys.platform != 'linux' or os.uname().machine not in ('x86_64', 'aarch64'):
        raise OSError('Landlock architecture unavailable')
    libc = C.CDLL(None, use_errno=True)
    syscall = libc.syscall
    syscall.restype = C.c_long
    abi = linux_call(syscall, 444, C.c_void_p(), 0, 1)
    if abi < 3:
        raise OSError('Landlock write/truncate enforcement unavailable')
    # Open for write, remove/create, reparent, truncate, and device IOCTL.
    writes = (1 << 1) | sum(1 << bit for bit in range(4, 15))
    handled = writes | (1 << 15 if abi >= 5 else 0)
    # Scope abstract sockets and signals to this domain where supported.
    rules = Ruleset(handled, 0, 3 if abi >= 6 else 0)
    fd = linux_call(syscall, 444, C.byref(rules), C.sizeof(rules) if abi >= 6 else 8, 0)

    def allow(path, flags, mask):
        parent = os.open(path, os.O_PATH | os.O_CLOEXEC | os.O_NOFOLLOW | flags)
        try:
            linux_call(syscall, 445, fd, 1, C.byref(PathRule(mask, parent)), 0)
        finally:
            os.close(parent)

    try:
        # A data workspace can contain ordinary files, but creating or
        # controlling device nodes is outside the work directory contract.
        for root in roots:
            allow(root, os.O_DIRECTORY, writes & ~((1 << 6) | (1 << 11)))
        if os.path.exists('/dev/null'):
            allow('/dev/null', 0, 1 << 1)
        for device in devices:
            allow(device, 0, (1 << 1) | (1 << 15 if abi >= 5 else 0))
        linux_call(libc.prctl, 38, 1, 0, 0, 0)  # PR_SET_NO_NEW_PRIVS
        # Reject metadata mutations and asynchronous interfaces that do not
        # go through the pathname write rules. Do not claim partial isolation.
        limit_metadata()
        linux_call(syscall, 446, fd, 0)
    finally:
        os.close(fd)


def bubblewrap(roots, cwd, devices):
    executable = shutil.which('bwrap')
    if not executable:
        raise OSError('Bubblewrap unavailable')
    argv = [executable, '--unshare-user', '--unshare-pid', '--unshare-ipc', '--disable-userns',
            '--new-session', '--die-with-parent', '--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev']
    for root in roots:
        argv.extend(('--bind', root, root))
    for device in devices:
        argv.extend(('--dev-bind', device, device))
    argv.extend(('--chdir', cwd, '--'))
    probe = subprocess.run([*argv, '/bin/true'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=5)
    if probe.returncode != 0:
        raise OSError('Bubblewrap mount namespace unavailable')
    return argv


def accelerator_devices():
    """Retain scheduler-visible device access for an explicitly allocated GPU."""
    import glob
    candidates = ['/dev/nvidiactl', '/dev/nvidia-uvm', '/dev/nvidia-uvm-tools', '/dev/kfd', '/dev/dxg']
    for pattern in ('/dev/nvidia[0-9]*', '/dev/nvidia-caps/nvidia-cap[0-9]*', '/dev/dri/renderD[0-9]*'):
        candidates.extend(glob.glob(pattern))
    return [device for device in candidates if os.path.realpath(device) == device and
            os.path.exists(device) and stat.S_ISCHR(os.stat(device).st_mode) and os.access(device, os.R_OK | os.W_OK)]


def launch(root, cwd, marker, command, extra_roots=(), gpu=False):
    roots = [root, *extra_roots]
    if any(not os.path.isabs(path) or path == '/' or not os.path.isdir(path) or os.path.realpath(path) != path for path in roots) or \
            os.path.commonpath((root, cwd)) != root or os.path.realpath(cwd) != cwd:
        raise OSError('Workspace changed before command launch')
    os.chdir(cwd)
    devices = accelerator_devices() if gpu else ()
    try:
        landlock(roots, devices)
        prefix, method = [], 'landlock'
    except OSError:
        prefix, method = bubblewrap(roots, cwd, devices), 'bubblewrap'
    if marker:
        print(marker + method, flush=True)
    argv = [*prefix, *command]
    os.execv(argv[0], argv)


if __name__ == '__main__':
    try:
        root, cwd, marker, *command = sys.argv[1:]
        gpu, extra_roots = False, []
        while command and command[0] in ('--gpu', '--write'):
            option = command.pop(0)
            if option == '--gpu':
                gpu = True
            elif command:
                extra_roots.append(command.pop(0))
            else:
                raise OSError('Missing additional writable path')
        if not command or not os.path.isabs(command[0]):
            raise OSError('Absolute entry point required')
        launch(root, cwd, marker, command, extra_roots, gpu)
    except (OSError, ValueError, subprocess.SubprocessError):
        print('AIMatterLab workspace confinement is unavailable on this host.', file=sys.stderr)
        sys.exit(125)
