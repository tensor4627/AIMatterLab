/** Derived local guidance only. The saved human-owned profile remains authoritative. */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail=()=>{throw Error('compute_profile_guide_unavailable');};
function profileIdentity(profile){if(profile?.kind!=='ssh'||!UUID.test(profile.id||'')||!Number.isSafeInteger(profile.version)||profile.version<1)fail();}
export function sshServiceEnvironmentGuide(profile){
 profileIdentity(profile);
 // Activation text deliberately stays in the connection configuration. It may
 // contain private values and must not be copied into reusable Agent guidance.
 const python=profile.serviceEnvironment?.python||'python3';
 if(typeof python!=='string'||!python||python.length>4096||/[\x00-\x1f\x7f`]/.test(python))fail();
 return `---\nname: ssh-service-environment-${profile.id}\ndescription: Guide setup of the AIMatterLab job-service Python for this exact saved SSH connection.\n---\n\n# Saved SSH service environment\n\nConnection profile: ${profile.id}\nProfile version: ${profile.version}\nPython executable: \`${python}\`\n\nUse this guidance only for the selected connection with this exact profile ID and version. The saved connection configuration is authoritative; this file does not grant terminal access or project authorization.\n\n1. Keep the exact authenticated SSH connection. Its ordinary shell and private service channel are independent. Request the shell input grant before terminal commands, and the separate service-use grant before service tools. Do not open another login or reconnect automatically.\n2. Help the user select an existing Conda or virtual environment. Check that its interpreter provides a Python version supported by the current AIMatterLab job service and working sqlite3, including isolated interpreter mode. If no suitable environment exists, explain the proposed environment setup and obtain the user's approval before installing anything.\n3. Have the user save the interpreter name or absolute path and any environment activation commands in this connection's job-service environment editor. Store activation commands only in that explicit connection configuration; never copy passwords, tokens, shell history, or activation text into this file, global skills, or long-term guidance.\n4. First setup and later service checks/updates live under Connect compute resources > Job-service settings. First setup verifies actual health and tools before persisting this connection's service registration. Saving a recipe alone does not prove readiness. Registration never stores an SSH session, an Agent grant or project authorization.\n5. After a fresh SSH login is actually verified, the human explicitly selects the connection and attaches the registered service using its saved interpreter and activation recipe. Daily attach checks the pinned cache, host, runtime, health and tools; it does not stage, bootstrap or upgrade the worker. A missing or stopped service requires explicit maintenance in connection settings. Do not change registered scientific engines, branches, other connections or existing jobs.\n6. The ordinary shell stays usable while the service channel is active. Shell input and service usage have separate current-conversation grants. Closing a shell does not close the service; stopping a service does not close the shell/master or stop the remote worker/jobs. Explicitly ending the whole SSH connection revokes its temporary channels and grants. Registration and real run state remain. Never unlock a legacy single-PTY protocol lane to simulate concurrent channels.\n7. If service startup is unconfirmed, inspect the existing state and preserve the session. Do not replay unknown requests, automatically reinstall a service, or submit jobs as a setup test. Service readiness is not scientific validation.\n`;
}
function unlinkedAncestors(target){
 for(let current=path.resolve(target);;current=path.dirname(current)){
  if(fs.existsSync(current)){const stat=fs.lstatSync(current);if(stat.isSymbolicLink()||!stat.isDirectory())fail();}
  if(path.dirname(current)===current)break;
 }
}
export function writeSshServiceEnvironmentGuide(root,profile){
 if(typeof root!=='string'||!path.isAbsolute(root)||/[\x00-\x1f\x7f]/.test(root))fail();
 const body=sshServiceEnvironmentGuide(profile),directory=path.join(root,profile.id),target=path.join(directory,'SKILL.md');
 if(path.relative(root,directory)!==profile.id)fail();
 unlinkedAncestors(directory);fs.mkdirSync(directory,{recursive:true,mode:0o700});unlinkedAncestors(directory);
 if(fs.existsSync(target)){const stat=fs.lstatSync(target);if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1)fail();if(fs.readFileSync(target,'utf8')===body)return target;}
 const temporary=path.join(directory,'.SKILL.'+randomUUID()+'.tmp');
 try{fs.writeFileSync(temporary,body,{encoding:'utf8',mode:0o600,flag:'wx'});fs.renameSync(temporary,target);}
 catch(error){if(fs.existsSync(temporary))fs.unlinkSync(temporary);throw error;}
 return target;
}
