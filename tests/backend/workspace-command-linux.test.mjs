import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {workspaceProbeCommand} from '../../desktop/platform/terminal-service/workspace-probe.mjs';
import {workspaceCommand} from '../../desktop/platform/terminal-service/workspace-command.mjs';

const wsl = process.env.STUDIO_WORKSPACE_TEST_WSL;
const linux = process.platform === 'linux' || wsl;
function shell(command, ...args) {
 const prefix=wsl?['-d',wsl,'--exec','/bin/sh']:[];
 return execFileSync(wsl?'wsl.exe':'/bin/sh',[...prefix,'-c',command,'aimatterlab-fixture',...args],{encoding:'utf8',timeout:20000,windowsHide:true});
}

test('real Linux workspace probe, shell boundary, and the actual script delivered to a scheduler', {skip:!linux}, t=>{
 const fixture=shell('mktemp -d /tmp/aimatterlab-workspace-test.XXXXXXXX').trim();
 assert.match(fixture,/^\/tmp\/aimatterlab-workspace-test\.[A-Za-z0-9]+$/);
 t.after(()=>shell('case "$1" in /tmp/aimatterlab-workspace-test.*) rm -r -- "$1" ;; esac',fixture));
 const root=fixture+"/work with apostrophe ' a",outside=fixture+'/outside.txt';
 const preview=workspaceProbeCommand({mode:'preview',directory:root}), observed=preview.decode(shell(preview.command));
 assert.equal(observed.root,root);
 assert.equal(observed.ready,false);
 assert.equal(shell('test ! -e "$1" && printf clean',root),'clean');
 const confirmed=workspaceProbeCommand({mode:'confirm',directory:root,expected:observed.identity});
 assert.equal(confirmed.decode(shell(confirmed.command)).ready,true);
 const run=(mode,args,schedulerBin,cwd=root)=>{
  const compiled=workspaceCommand({root,cwd,identity:observed.identity,mode,args});
  const environment=schedulerBin?'PATH="$1:$PATH"; export PATH; ':'';
  return compiled.decode(shell(environment+compiled.command,...schedulerBin?[schedulerBin]:[]));
 };
 shell('printf original > "$1"; ln -s "$1" "$2"',outside,root+'/external-link');
 shell('ln -s "$1" "$2"',root,fixture+'/project-link');
 assert.equal(run('cwd',[fixture]).output.trim(),fixture);
 assert.equal(run('cwd',['/']).output.trim(),'/');
 const inspected=run('read_pipeline',[JSON.stringify([['find','.', '-maxdepth','1','-name','outside.txt'],['head','-n','1']])],undefined,fixture);
 assert.equal(inspected.output.trim(),'./outside.txt');
 assert.throws(()=>workspaceCommand({root,cwd:fixture,identity:observed.identity,mode:'read',args:['find','.','-delete']}),/ssh_workspace_invalid/);
 const target=run('copy_target',['outside.txt','project-link/workfile/canonical.txt'],undefined,fixture);
 assert.deepEqual(target.output.trim().split('\n'),[outside,root+'/workfile/canonical.txt']);
 assert.equal(shell('test ! -e "$1" && printf observed',root+'/workfile/canonical.txt'),'observed');
 assert.equal(run('copy',target.output.trim().split('\n'),undefined,fixture).code,0);
 assert.equal(run('copy_target',['outside.txt','project-link/external-link'],undefined,fixture).status,'outside');
 assert.equal(run('mkdir',['../outside-structure']).status,'outside');
 assert.equal(run('copy',[outside,'workfile/inside.txt']).code,0);
 assert.equal(run('write',['external-link','bad']).status,'outside');
 const canRun=run('confined',['python3 -c "from pathlib import Path; Path(\'inside.txt\').write_text(\'installed\')"']);
 if(canRun.status==='unavailable'){
  t.diagnostic(canRun.output);
  assert.ok(!wsl,'The local Linux test target did not provide a verified filesystem confinement implementation');
  t.skip('Current kernel provides no verifiable confinement');
  return;
 }
 assert.ok(['landlock','bubblewrap'].includes(canRun.confinement));
 assert.equal(canRun.code,0);
 assert.equal(shell('cat -- "$1"',root+'/inside.txt'),'installed');
 assert.notEqual(run('confined',['echo write > ../outside.txt']).code,0);
 assert.notEqual(run('confined',['python3 -c "from pathlib import Path; Path(\'external-link\').write_text(\'bad\')"']).code,0);
 assert.notEqual(run('confined',['python3 -c "import subprocess; subprocess.run([\'/bin/sh\',\'-c\',\'echo child > ../outside.txt\'], check=True)"']).code,0);
 assert.notEqual(run('confined',['chmod 000 ../outside.txt']).code,0);
 assert.equal(shell('cat -- "$1"',outside),'original');

 const bin=fixture+'/bin';
 const schedule=`#!/bin/sh
set -eu
for arg do
 case "$arg" in
  --chdir=*) work=\${arg#*=} ;;
  --output=*) log=\${arg#*=} ;;
  --*) ;;
  *) script=$arg ;;
 esac
done
[ -n "$work" ] && [ -n "$log" ] && [ -n "$script" ]
cd -- "$work"
printf 'dispatched\\n' >> scheduler-submissions.log
if /bin/sh "$script" > "$log" 2>&1; then code=0; else code=$?; fi
printf '%s' "$code" > compute-exit-code
printf '4312\\n'
`;
 shell('mkdir -- "$1"; printf "%s" "$2" > "$1/sbatch"; chmod 700 "$1/sbatch"',bin,schedule);
 const content=`#!/bin/sh
#SBATCH --job-name=fixture
set -e
printf inside > scheduler-result.txt
python3 -c "import subprocess; subprocess.run(['/bin/sh', '-c', 'echo child > ../outside.txt'], check=True)"
`;
 assert.equal(run('write',['job.sh',content]).code,0);
 const checksum=createHash('sha256').update(content).digest('hex');
 const request=[root+'/job.sh',checksum,'sbatch','9e47bb6d-9138-4775-86d3-018e156483fa'];
 const job=run('job',request,bin);
 assert.equal(job.code,0,job.output);
 assert.equal(job.output.trim(),'4312');
 assert.equal(shell('cat -- "$1"',root+'/scheduler-result.txt'),'inside');
 assert.notEqual(shell('cat -- "$1"',root+'/compute-exit-code'),'0');
 assert.equal(shell('cat -- "$1"',outside),'original');
 const replay=run('job',request,bin);
 assert.equal(replay.status,'submission_unconfirmed');
 assert.equal(shell('wc -l < "$1"',root+'/scheduler-submissions.log').trim(),'1');

 const lsf=`#!/bin/sh
set -eu
while [ "$#" -gt 0 ]; do
 case "$1" in
  -cwd) cwd=$2 ;;
  -o) log=$2 ;;
  -e) ;;
  *) exit 2 ;;
 esac
 shift 2
done
cd -- "$cwd"
printf 'dispatched\\n' >> lsf-submissions.log
/bin/sh > "$log" 2>&1 || :
printf 'Job <7319> is submitted\\n'
`;
 shell('printf "%s" "$2" > "$1/bsub"; chmod 700 "$1/bsub"',bin,lsf);
 const lsfRequest=[root+'/job.sh',checksum,'bsub','6252b5e4-d0a2-44c3-9e27-f0fb0b1154c1'];
 assert.equal(run('job',lsfRequest,bin).output.trim(),'Job <7319> is submitted');
 assert.equal(run('job',lsfRequest,bin).status,'submission_unconfirmed');
 assert.equal(shell('wc -l < "$1"',root+'/lsf-submissions.log').trim(),'1');
});
