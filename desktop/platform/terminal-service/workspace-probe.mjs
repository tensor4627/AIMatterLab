/** Fixed SSH login-host directory observation. No job service is involved. */
import {randomBytes} from 'node:crypto';
import {posix} from 'node:path';
import {TerminalFault} from './session.mjs';

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const clean = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
export const workspaceCandidate = value => clean(value, 4096) && (value.startsWith('/') || value === '~' || value.startsWith('~/'));
export const absoluteWorkspace = value => clean(value, 4096) && value.startsWith('/') && value !== '/' && !value.endsWith('/') && posix.normalize(value) === value;
export const observedIdentity = value => clean(value?.hostname, 255) && clean(value?.account, 255) && clean(value?.machineId, 256) && Number.isSafeInteger(value?.uid) && value.uid >= 0;
const reject = code => { throw new TerminalFault(code, 409); };

// Resolve existing ancestors physically, preserving a missing suffix. Once
// approved, anchor directory creation in the last observed ancestor and check
// each new component before continuing. Existing contents remain untouched.
const script = `
mode=$1 candidate=$2 marker=$3
account=$(id -un) && uid=$(id -u) && host=$(uname -n) || exit 1
machine=$(cat /etc/machine-id 2>/dev/null || :)
[ -n "$machine" ] || machine=-
home=$(cd -P -- "$HOME" && pwd -P) || exit 1
case "$candidate" in
  '') candidate="$home/AIMatterLab" ;;
  '~') candidate="$home" ;;
  '~/'*) candidate="$home/\${candidate#??}" ;;
esac
case "$candidate" in
  /) exit 1 ;;
  */) while [ "\${candidate%/}" != "$candidate" ]; do candidate=\${candidate%/}; done ;;
esac
finish() {
  printf '\\n%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n' "$marker" "$1" "$account" "$uid" "$host" "$machine" "$home" "$2" "$3" "$marker"
  exit 0
}
missing= candidate_dir=$candidate
while [ ! -d "$candidate_dir" ]; do
  if [ -e "$candidate_dir" ] || [ -L "$candidate_dir" ]; then
    finish conflict "$candidate" "$candidate_dir"
  fi
  leaf=\${candidate_dir##*/}
  case "$leaf" in ''|.|..) exit 1 ;; esac
  missing=/$leaf$missing
  candidate_dir=\${candidate_dir%/*}
  [ -n "$candidate_dir" ] || candidate_dir=/
done
ancestor=$(cd -P -- "$candidate_dir" && pwd -P) || finish conflict "$candidate" "$candidate_dir"
root=\${ancestor%/}$missing
[ -n "$root" ] && [ "$root" != / ] || exit 1
if [ "$mode" = confirm ]; then
  if [ "$root" != "$candidate" ] || [ "$account" != "$4" ] || [ "$uid" != "$5" ] || [ "$host" != "$6" ] || [ "$machine" != "$7" ]; then
    finish changed "$root" -
  fi
fi
if [ ! -x "$ancestor" ] || { [ -n "$missing" ] && [ ! -w "$ancestor" ]; }; then finish conflict "$root" "$ancestor"; fi
ready=ok
for part in workfile software; do
  item="$root/$part"
  if [ -L "$item" ] || { [ -e "$item" ] && [ ! -d "$item" ]; }; then finish conflict "$root" "$item"; fi
  if [ -d "$item" ]; then
    if [ ! -w "$item" ] || [ ! -x "$item" ]; then finish conflict "$root" "$item"; fi
  else
    [ -n "$missing" ] || [ -w "$root" ] || finish conflict "$root" "$root"
    ready=missing
  fi
done
if [ "$mode" = confirm ]; then
  cd -P -- "$ancestor" && [ "$(pwd -P)" = "$ancestor" ] || finish changed "$root" -
  at=$ancestor
  until [ -z "$missing" ]; do
    tail=\${missing#/}
    part=\${tail%%/*}
    at=\${at%/}/$part
    if [ -L "./$part" ] || { [ ! -d "./$part" ] && ! mkdir -- "./$part"; }; then finish conflict "$root" "$at"; fi
    cd -P -- "./$part" && [ "$(pwd -P)" = "$at" ] || finish changed "$root" -
    if [ "$tail" = "$part" ]; then missing=; else missing=/\${tail#*/}; fi
  done
  for part in workfile software; do
    if [ -L "./$part" ] || { [ ! -d "./$part" ] && ! mkdir -- "./$part"; }; then finish conflict "$root" "$root/$part"; fi
    [ -w "./$part" ] && [ -x "./$part" ] || finish conflict "$root" "$root/$part"
  done
  ready=ok
fi
finish "$ready" "$root" -
`;

export function workspaceProbeCommand({mode, directory, expected}) {
  if (!['preview', 'confirm'].includes(mode) || directory !== undefined && !workspaceCandidate(directory) ||
      mode === 'preview' && expected !== undefined || mode === 'confirm' && (!absoluteWorkspace(directory) || !observedIdentity(expected)))
    reject('ssh_workspace_invalid');
  const marker = '__AIM_WORKSPACE_' + randomBytes(20).toString('hex') + '__';
  const args = [mode, directory ?? '', marker];
  if (mode === 'confirm') args.push(expected.account, String(expected.uid), expected.hostname, expected.machineId);
  const command = ['sh', '-c', quote(script), 'aimatterlab-workspace', ...args.map(quote)].join(' ');
  function decode(output) {
    const lines = output.split(/\r?\n/);
    const start = lines.indexOf(marker);
    const [state, account, uidText, hostname, machineId, home, root, conflict, end] = lines.slice(start + 1, start + 10);
    const identity = {account, uid: Number(uidText), hostname, machineId};
    if (start < 0 || end !== marker || !['ok', 'missing', 'conflict', 'changed'].includes(state) || !/^\d+$/.test(uidText) ||
        !observedIdentity(identity) || !absoluteWorkspace(home) && home !== '/' || !workspaceCandidate(root) ||
        state !== 'conflict' && !absoluteWorkspace(root) || state === 'conflict' && !workspaceCandidate(conflict)) reject('ssh_workspace_unconfirmed');
    if (state === 'changed') reject('ssh_workspace_changed');
    return {root, home, identity, ready: state === 'ok', ...(state === 'conflict' ? {conflict} : {})};
  }
  return {command, decode};
}
