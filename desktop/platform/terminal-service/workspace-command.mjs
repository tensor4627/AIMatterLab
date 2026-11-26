/** Noninteractive command lane on the authenticated SSH resource. */
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {absoluteWorkspace, observedIdentity} from './workspace-probe.mjs';
import {TerminalFault} from './session.mjs';

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const readOnly = new Set(['pwd', 'ls', 'cat', 'head', 'tail', 'grep', 'wc', 'stat', 'file', 'hostname', 'id', 'whoami', 'which', 'sinfo', 'squeue', 'sacct', 'bjobs', 'bqueues', 'bhosts', 'nvidia-smi', 'echo', 'printf']);
const argument = value => typeof value === 'string' && value.length <= 8192 && !/[\x00\x1b]/.test(value);
const canonicalDirectory = value => value==='/' || absoluteWorkspace(value);
const homeArgument = value => value==='~'||value.startsWith('~/')?'"$HOME"'+quote(value.slice(1)):quote(value);
export const renderWorkspaceObservation = argv => 'command '+argv.map(homeArgument).join(' ');

function readOnlyFind(args){
  const operators=new Set(['-print','-print0','-ls','-empty','-readable','-writable','-executable','-mount','-xdev','-depth','-mindepth','-daystart','-ignore_readdir_race','-noleaf','-quit','-true','-false','-and','-or','-not','-a','-o','!','(',')',',','-prune','-P','-H','-L','--']);
  const unary=new Set(['-name','-iname','-path','-ipath','-regex','-iregex','-lname','-ilname','-type','-xtype','-maxdepth','-mindepth','-size','-mtime','-mmin','-atime','-amin','-ctime','-cmin','-user','-group','-uid','-gid','-perm','-links','-inum','-newer','-samefile','-printf','-regextype']);
  for(let at=0;at<args.length;at++){
    const value=args[at];
    if(unary.has(value)){if(++at===args.length)return false;continue;}
    if(value.startsWith('-')&&!operators.has(value))return false;
  }
  return true;
}
function confinementSource(){
  try{return readFileSync(new URL('./workspace-confinement.py', import.meta.url),'utf8');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  return readFileSync(new URL('../../../backend/worker/studio_worker/compute/workspace_confinement.py',import.meta.url),'utf8');
}

const scheduled = `
set -eu
[ "$(pwd -P)" = "$cwd" ] || exit 76
checksum=$(sha256sum -- "$frozen")
[ "\${checksum%% *}" = "$expected" ] || exit 76
python=$(command -v python3 || command -v python) || exit 125
exec "$python" -I -c "$confinement" "$root" "$cwd" '' /bin/sh -c 'exec "$1"' aimatterlab-job "$frozen"
`;

const overwrite = `
import os
import shutil
import stat
import sys
import uuid

destination, operation, value = sys.argv[1:]
if os.path.realpath(destination) != destination:
    sys.exit('Workspace destination changed before replacement.')
original = os.stat(destination, follow_symlinks=False)
if not stat.S_ISREG(original.st_mode):
    sys.exit('Workspace destination must be a regular file.')

temporary = os.path.join(os.path.dirname(destination), '.aimatterlab-write.' + uuid.uuid4().hex)
os.umask(0)
descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, original.st_mode & 0o777)
try:
    with os.fdopen(descriptor, 'wb') as output:
        if operation == 'write':
            output.write(value.encode('utf-8'))
        else:
            with os.fdopen(os.open(value, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as source:
                if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                    sys.exit('Workspace source must be a regular file.')
                shutil.copyfileobj(source, output)
    current = os.stat(destination, follow_symlinks=False)
    if (original.st_dev, original.st_ino, original.st_ctime_ns) != (current.st_dev, current.st_ino, current.st_ctime_ns):
        sys.exit('Workspace destination changed during replacement.')
    os.replace(temporary, destination)
finally:
    if os.path.lexists(temporary):
        os.unlink(temporary)
`;

export function allowedObservation(argv) {
  if (!Array.isArray(argv) || !argv.length || argv.length > 100 || argv.some(word => !argument(word) || /[\r\n]/.test(word))) return false;
  const name = argv[0].replace(/^\/(?:bin|usr\/bin)\//, '');
  const rest=argv.slice(1);
  if(name==='find')return readOnlyFind(rest);
  if(name==='uniq')return rest.every(word=>/^-[cdiuD]+$/.test(word)||['--count','--repeated','--unique','--ignore-case'].includes(word));
  if(name==='cut'||name==='tr')return true;
  if(name==='file')return rest.every(word=>!word.startsWith('-')||/^-[bhiILN]+$/.test(word)||['--','--brief','--mime','--mime-type','--mime-encoding','--no-pad','--no-dereference','--dereference'].includes(word));
  if (name === 'scontrol') return argv[1] === 'show';
  if (name === 'command') return argv[1] === '-v' || argv[1] === '-V';
  if (name === 'nvidia-smi') return argv.slice(1).every(word => word === '-L' || /^--(?:query-gpu|format)=[A-Za-z_,.]+$/.test(word));
  if (name === 'sacct') return !argv.some(word => word.startsWith('--file') || word === '-f');
  if (name === 'stat') return !argv.some(word => word.startsWith('--printf') && word.includes('\\x'));
  return readOnly.has(name);
}

const script = `
exec 2>&1
marker=$1 root=$2 cwd=$3 mode=$4 account=$5 uid=$6 host=$7 machine=$8 confinement=$9 program=\${10}
shift 10
finish() { printf '\\n%s\\n%s\\n%s\\n%s\\n' "$marker" "$1" "$2" "$marker"; exit 0; }
actual_machine=$(cat /etc/machine-id 2>/dev/null || :)
[ -n "$actual_machine" ] || actual_machine=-
[ "$(id -un)" = "$account" ] && [ "$(id -u)" = "$uid" ] && [ "$(uname -n)" = "$host" ] && [ "$actual_machine" = "$machine" ] || finish changed 1
cd -P -- "$root" && [ "$(pwd -P)" = "$root" ] || finish changed 1
cd -P -- "$cwd" && [ "$(pwd -P)" = "$cwd" ] || finish changed 1
contains() { case "$1" in "$root"|"$root/"*) return 0 ;; *) return 1 ;; esac; }
spell() { case "$1" in '~') printf '%s' "$HOME" ;; '~/'*) printf '%s/%s' "$HOME" "\${1#??}" ;; *) printf '%s' "$1" ;; esac; }
target() { realpath -m -- "$(spell "$1")"; }
blocked() { printf '%s\\n' "$1"; finish "$2" 1; }
create_directory() (
  destination=$1 ancestor=$1 suffix=
  until [ -d "$ancestor" ]; do
    [ ! -e "$ancestor" ] && [ ! -L "$ancestor" ] || exit 1
    suffix=/\${ancestor##*/}$suffix
    ancestor=\${ancestor%/*}
    [ -n "$ancestor" ] || ancestor=/
  done
  contains "$ancestor" && cd -P -- "$ancestor" && [ "$(pwd -P)" = "$ancestor" ] || exit 1
  at=$ancestor
  while [ -n "$suffix" ]; do
    tail=\${suffix#/}; child=\${tail%%/*}; at=\${at%/}/$child
    [ ! -L "./$child" ] && { [ -d "./$child" ] || mkdir -- "./$child"; } || exit 1
    cd -P -- "./$child" && [ "$(pwd -P)" = "$at" ] || exit 1
    if [ "$tail" = "$child" ]; then suffix=; else suffix=/\${tail#*/}; fi
  done
  [ "$at" = "$destination" ]
)
write_new() (
  destination=$1; shift
  parent=\${destination%/*}; child=\${destination##*/}
  contains "$parent" && cd -P -- "$parent" && [ "$(pwd -P)" = "$parent" ] || exit 1
  temporary=$(mktemp -- './.aimatterlab-write.XXXXXXXX') || exit 1
  trap 'rm -f -- "$temporary"' EXIT
  "$@" > "$temporary" && ln -T -- "$temporary" "./$child"
)
case "$mode" in
  read|read_pipeline) sh -c "$1" ;;
  cwd)
    destination=$(cd -P -- "$(spell "$1")" && pwd -P) || finish result 1
    printf '%s\\n' "$destination"
    ;;
  mkdir)
    for item do
      destination=$(target "$item") || finish result 1
      contains "$destination" || blocked "$destination" outside
    done
    for item do
      destination=$(target "$item") && contains "$destination" && create_directory "$destination" || finish result 1
    done
    ;;
  copy|copy_target)
    source=$(realpath -e -- "$(spell "$1")") && destination=$(target "$2") || finish result 1
    [ -f "$source" ] || finish result 1
    if [ -d "$destination" ]; then destination=$(target "$destination/\${source##*/}"); fi
    contains "$destination" || blocked "$destination" outside
    if [ -e "$destination" ] || [ -L "$destination" ]; then blocked "$destination" destructive; fi
    if [ "$mode" = copy_target ]; then
      printf '%s\\n%s\\n' "$source" "$destination"
    else
      write_new "$destination" cat -- "$source"
    fi
    ;;
  write)
    destination=$(target "$1") || finish result 1
    contains "$destination" || blocked "$destination" outside
    if [ -e "$destination" ] || [ -L "$destination" ]; then blocked "$destination" destructive; fi
    write_new "$destination" printf '%s' "$2"
    ;;
  approved) sh -c "$1" ;;
  confined)
    contains "$cwd" || finish changed 1
    python=$(command -v python3 || command -v python) || finish unavailable 125
    "$python" -I -c "$confinement" "$root" "$cwd" "\${marker}sandbox:" /bin/sh -c "$1"
    ;;
  confined_overwrite)
    contains "$cwd" && contains "$1" && [ "$(target "$1")" = "$1" ] || finish changed 1
    python=$(command -v python3 || command -v python) || finish unavailable 125
    value=$3
    if [ "$2" = copy ]; then
      value=$(realpath -e -- "$(spell "$value")") || finish changed 1
    fi
    "$python" -I -c "$confinement" "$root" "$cwd" "\${marker}sandbox:" "$python" -I -c "$program" "$1" "$2" "$value"
    ;;
  job_preview)
    job=$(realpath -e -- "$1") || finish result 1
    contains "$job" && contains "$cwd" || blocked "$job" outside
    [ -f "$job" ] && [ "$(wc -c < "$job")" -le 8192 ] || finish result 1
    checksum=$(sha256sum -- "$job") || finish result 1
    printf '%s\\n%s\\n' "$job" "\${checksum%% *}"
    cat -- "$job"
    ;;
  job)
    job=$(realpath -e -- "$1") || finish changed 1
    contains "$job" && contains "$cwd" || blocked "$job" outside
    checksum=$(sha256sum -- "$job") || finish changed 1
    [ "\${checksum%% *}" = "$2" ] || finish changed 1
    [ -f "$job" ] && [ "$(wc -c < "$job")" -le 8192 ] || finish changed 1
    # Freeze the exact script and queue directives. The scheduler wrapper
    # starts a separate sandbox on the compute node before running user code.
    command -v "$3" >/dev/null || finish result 1
    jobdir="$cwd/.aimatterlab-job.$4"
    # This exact human approval owns a single reserve-before-dispatch directory.
    # An existing reservation never permits another scheduler submission.
    if ! mkdir -m 700 -- "$jobdir"; then
      if [ -e "$jobdir" ] || [ -L "$jobdir" ]; then finish submission_unconfirmed 75; fi
      finish result 1
    fi
    frozen=$jobdir/frozen-script
    submission=$jobdir/submit.sh
    cat -- "$job" > "$frozen" || finish changed 1
    checksum=$(sha256sum -- "$frozen") || finish changed 1
    [ "\${checksum%% *}" = "$2" ] || finish changed 1
    chmod u+x -- "$frozen" || finish result 1
    encode() { printf '%s' "$1" | base64 | tr -d '\\n'; }
    assignment() { printf '%s=$(printf "%%s" %s | base64 -d)\\n' "$1" "$(encode "$2")"; }
    {
      printf '#!/bin/sh\\n'
      if [ "$3" = sbatch ]; then
        awk '/^[[:space:]]*#/ { if (/^[[:space:]]*#SBATCH[[:space:]]/) print; next } !/^[[:space:]]*$/ { exit }' "$frozen"
      else
        awk '/^[[:space:]]*#/ { if (/^[[:space:]]*#BSUB[[:space:]]/) print; next } !/^[[:space:]]*$/ { exit }' "$frozen"
      fi
      assignment root "$root"
      assignment cwd "$cwd"
      assignment frozen "$frozen"
      assignment expected "$2"
      assignment confinement "$confinement"
      printf '%s\\n' "$program"
    } > "$submission" || finish result 1
    if [ "$3" = sbatch ]; then
      command sbatch --parsable --chdir="$cwd" --output="$jobdir/slurm-%j.out" --error="$jobdir/slurm-%j.err" "$submission"
    else
      command bsub -cwd "$cwd" -o "$jobdir/lsf-%J.out" -e "$jobdir/lsf-%J.err" < "$submission"
    fi
    code=$?
    [ "$code" -eq 0 ] || finish submission_unconfirmed "$code"
    ;;
esac
code=$?
finish result "$code"
`;

export function workspaceCommand({root, cwd, identity, mode, args}) {
  const arity = {cwd: 1, copy: 2, copy_target: 2, write: 2, approved: 1, confined: 1, confined_overwrite: 3, read_pipeline: 1, job_preview: 1, job: 4};
  const pathWord = value => argument(value) && value.length > 0 && !/[\r\n]/.test(value);
  if (!absoluteWorkspace(root) || !canonicalDirectory(cwd) || !observedIdentity(identity) || !Array.isArray(args) ||
      args.some(value => !argument(value)) || mode === 'read' && !allowedObservation(args) ||
      mode === 'mkdir' && (!args.length || args.length > 64 || args.some(value => !pathWord(value))) ||
      !['read','mkdir'].includes(mode) && (!Object.hasOwn(arity, mode) || args.length !== arity[mode]) ||
      ['cwd', 'copy', 'copy_target', 'write', 'job_preview', 'job'].includes(mode) && !pathWord(args[0]) ||
      mode === 'confined_overwrite' && (!absoluteWorkspace(args[0]) || !['copy','write'].includes(args[1]) || args[1]==='copy' && !pathWord(args[2])) ||
      ['copy','copy_target'].includes(mode) && !pathWord(args[1]) || mode === 'job' && (!/^[a-f0-9]{64}$/.test(args[1]) || !['sbatch','bsub'].includes(args[2]) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(args[3])))
    throw new TerminalFault('ssh_workspace_invalid', 409);
  const marker = '__AIM_COMMAND_' + randomBytes(20).toString('hex') + '__';
  if(mode==='read'||mode==='read_pipeline'){
    let pipeline;
    try{pipeline=mode==='read'?[args]:JSON.parse(args[0]);}catch{}
    if(!Array.isArray(pipeline)||!pipeline.length||pipeline.length>8||!pipeline.every(allowedObservation))throw new TerminalFault('ssh_workspace_invalid',409);
    args=[pipeline.map(renderWorkspaceObservation).join(' | ')];
  }
  const confined = mode === 'confined' || mode === 'confined_overwrite';
  const confinement = confined || mode === 'job' ? confinementSource() : '';
  const program = mode === 'job' ? scheduled : mode === 'confined_overwrite' ? overwrite : '';
  const elements = [script, 'aimatterlab-command', marker, root, cwd, mode, identity.account, String(identity.uid), identity.hostname, identity.machineId, confinement, program, ...args];
  const command = 'sh -c ' + elements.map(quote).join(' ');
  const decode = raw => {
    const text = raw.replaceAll('\r\n', '\n');
    const at = text.lastIndexOf('\n' + marker + '\n', text.lastIndexOf('\n' + marker + '\n') - 1);
    const [state, code, end] = text.slice(at + marker.length + 2).split('\n');
    if (at < 0 || end !== marker || !['result','outside','destructive','changed','unavailable','submission_unconfirmed'].includes(state) || !/^\d{1,3}$/.test(code))
      throw new TerminalFault('ssh_workspace_unconfirmed', 409);
    const prefix = marker + 'sandbox:', lines = text.slice(0, at).split('\n');
    const method = confined ? lines.find(line => line === prefix+'landlock' || line === prefix+'bubblewrap')?.slice(prefix.length) : undefined;
    if (confined && state === 'result' && !method && code !== '125') throw new TerminalFault('ssh_workspace_unconfirmed', 409);
    const status = confined && !method && code === '125' ? 'unavailable' : state;
    const output = method ? lines.filter(line => line !== prefix+method).join('\n') : text.slice(0, at);
    return {status, code:Number(code), output, ...method?{confinement:method}:{}};
  };
  return {command, decode};
}
