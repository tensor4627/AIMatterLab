/** Scope and review agent SSH commands before any input reaches a remote shell. */
import {createHash,randomUUID} from 'node:crypto';
import {posix} from 'node:path';
import {allowedObservation} from '../../../desktop/platform/terminal-service/workspace-command.mjs';
import {absoluteWorkspace} from '../../../desktop/platform/terminal-service/workspace-probe.mjs';

const fail = code => { throw Object.assign(Error(code), {operationNotStarted: true}); };
const owning = value => JSON.stringify([value?.provider, value?.threadId]);
const inside = (root, directory) => directory === root || directory.startsWith(root + '/');
const absolute = (cwd, value) => posix.resolve(cwd, value);
const canonicalDirectory = value => value==='/'||absoluteWorkspace(value);
const commandDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const observations = new Set(['read','read_pipeline','cwd','job_preview','copy_target']);

function words(text) {
  const tokens = /\s+|'[^']*'|"[^"$`\\]*"|\\[()]|[A-Za-z0-9_.\/\-,:+@%*=~?!]+/gy;
  const output = [];
  let end = 0, previous = ' ';
  for (const match of text.matchAll(tokens)) {
    if (match.index !== end) return null;
    end += match[0].length;
    if (/^\s/.test(match[0])) {
      previous = ' ';
      continue;
    }
    if (previous !== ' ') return null;
    previous = match[0];
    output.push(/^['"]/.test(previous) ? previous.slice(1, -1) : previous.replace(/^\\([()])$/, '$1'));
  }
  return end === text.length && output.length ? output : null;
}

function readPipeline(command){
  if(/[\r\n]/.test(command))return null;
  const pieces=[];let quote='',offset=0;
  for(let at=0;at<command.length;at++){
    const character=command[at];
    if(quote){if(character===quote)quote='';continue;}
    if(character==='"'||character==="'")quote=character;
    else if(character==='|'){pieces.push(command.slice(offset,at));offset=at+1;}
  }
  if(!pieces.length||quote||pieces.length>=8)return null;
  pieces.push(command.slice(offset));
  const parsed=pieces.map(part=>words(part.trim()));
  return parsed.every(allowedObservation)?parsed:null;
}

// Path-bearing directives (for example --output or -o) need the ordinary
// review. The scheduler processes them before the workspace sandbox starts.
function workspaceJobDirectives(script,scheduler){
  const prefix=scheduler==='sbatch'?'#SBATCH':'#BSUB';
  const allowed=scheduler==='sbatch'
    ? /^(?:--(?:partition|qos|account|time|nodes|ntasks|ntasks-per-node|cpus-per-task|gpus|gres|mem|mem-per-cpu|job-name)[=\s]+|-[pAtNncJ]\s*)[a-zA-Z0-9_.:,+=-]+$/
    : /^-(?:q|P|W|n|J|M)\s+[a-zA-Z0-9_.:,+=-]+$/;
  return script.split(/\r?\n/).filter(line=>line.trimStart().startsWith(prefix))
    .every(line=>allowed.test(line.trim().slice(prefix.length).trim()));
}

export function classifyWorkspaceCommand(text, root, cwd) {
  const command = text.trim(), here = /^cat\s*>\s*(.+?)\s*<<\s*'([A-Za-z_][A-Za-z0-9_]*)'\n([\s\S]*)\n\2$/.exec(command);
  const args = /[\r\n]/.test(command) ? null : words(command);
  const pipeline=readPipeline(command);
  if(pipeline)return {mode:'read_pipeline',args:[JSON.stringify(pipeline)],paths:[]};
  const lsf = /^bsub[\t ]*<[\t ]*(.+)$/.exec(command);
  const job = lsf ? {scheduler:'bsub', path:words(lsf[1])} : args?.[0] === 'sbatch' ?
    {scheduler:'sbatch', path:args.slice(args[1] === '--parsable' ? 2 : 1)} : null;
  if (job?.path?.length === 1 && !job.path[0].startsWith('-') && inside(root, cwd) && inside(root, absolute(cwd, job.path[0])))
    return {mode:'job_preview', args:job.path, paths:[absolute(cwd, job.path[0]), cwd], scheduler:job.scheduler};
  let mode, values, destinations = [];
  if (here) {
    const path = words(here[1]);
    if (path?.length === 1 && !here[3].split('\n').includes(here[2])) {
      mode = 'write';
      values = [path[0], here[3] + '\n'];
      destinations = [path[0]];
    }
  } else if (args) {
    const [name, ...rest] = args;
    if (allowedObservation(args)) return {mode:'read', args, paths: []};
    if (name === 'cd' && (rest.length===0||rest.length===1&&(!rest[0].startsWith('-')||rest[0]==='-')))
      return {mode:'cwd',args:rest.length?rest:['~'],paths:[]};
    if (name === 'mkdir' && (rest[0] === '-p' ? rest.slice(1) : rest).length && (rest[0] === '-p' ? rest.slice(1) : rest).every(value => !value.startsWith('-'))) {
      mode = 'mkdir'; values = rest[0] === '-p' ? rest.slice(1) : rest; destinations = values;
    }
    if (name === 'cp' && rest.length === 2 && rest.every(value => !value.startsWith('-'))) {
      const path=absolute(cwd,rest[1]);
      const needsCanonicalTarget=!inside(root,cwd)||!inside(root,path)||rest[1].startsWith('~/');
      return {mode:needsCanonicalTarget?'copy_target':'copy',args:rest,paths:[path]};
    }
  }
  if (mode) {
    const paths = destinations.map(value => absolute(cwd, value));
    if (!inside(root, cwd) || paths.some(path => !inside(root, path)) || destinations.some(value => value.startsWith('~/')))
      return {mode:'approved',args:[command],paths,reason:'outside_workspace'};
    return {mode, args: values, paths};
  }
  const literal = (command.match(/(?:^|[\s=><])(?:'[^'\n]*'|"[^"\n]*"|\/[^\s'";|&<>]+)(?=$|[\s;|&])/g) || [])
    .map(value => value.trim().replace(/^[=><]/, '').replace(/^['"]|['"]$/g, '')).filter(value => value.startsWith('/'));
  const destructive = /(?:^|[;|&\s])(?:\/[\w/-]+\/)?(?:rm|rmdir|unlink|mv|truncate|dd|scancel|bkill|chmod|chown)(?=\s|$)/.test(command)||
    /(?:^|[;&|\s])(?:\/[^\s]+\/)?find\s[^\n]*\s-(?:delete|fprint0?|fprintf|fls)(?=\s|$)/.test(command);
  const changesDirectory = /(?:^|[;&|\n])\s*cd\s+['"]?(\/[^'"\s;|&]+)|(?:^|[\s\d])>>?\s*['"]?(\/[^'"\s;|&]+)/g;
  const outside = [...command.matchAll(changesDirectory)].some(([, directory, redirect]) => {
    // The confinement backend provides the null device. The entire batch still runs inside that boundary.
    if (redirect === '/dev/null') return false;
    return !inside(root, posix.normalize(directory || redirect));
  });
  return {mode:'approved', args:[command], paths:[...new Set(literal)],
    reason: destructive ? 'destructive' : !inside(root, cwd) || outside ? 'outside_workspace' : 'unverified_effects'};
}

export function createWorkspaceTerminalAuthorization({workspace, connections, current, developerCompute, catalog, emit = () => {}, now = Date.now, uuid = randomUUID}) {
  const stages = new Map(), approvals = new Map();
  function settle(row, decision) {
    clearTimeout(row.timer);
    approvals.delete(row.view.approvalId);
    if (decision === 'changed' && now() >= row.view.expiresAt) decision = 'expired';
    row.resolve({decision, guard:row.guard, approvalId:row.view.approvalId});
    emit();
  }
  function pending(value) {
    if (!value || Object.keys(value).length) fail('ssh_workspace_invalid');
    const owner = owning(current());
    for (const row of approvals.values()) {
      if (row.owner !== owner) continue;
      try { row.guard(); } catch { settle(row, 'changed'); continue; }
      return structuredClone(row.view);
    }
    return null;
  }
  function activity() {
    const owner = owning(current());
    for (const row of approvals.values()) {
      if (row.owner !== owner) continue;
      try { row.guard(); } catch { continue; }
      const {provider,threadId,approvalId,expiresAt} = row.view;
      return {provider,threadId,approvalId,expiresAt,at:row.at};
    }
    return null;
  }
  function decide(value) {
    const row = approvals.get(value?.approvalId);
    if (!value || Object.keys(value).sort().join(',') !== 'approvalId,decision' || !['approve','deny'].includes(value.decision) || row?.owner !== owning(current())) fail('ssh_terminal_approval_changed');
    try { row.guard(); } catch { settle(row, 'changed'); fail('ssh_terminal_approval_changed'); }
    const status = value.decision === 'approve' ? 'approved' : 'denied';
    settle(row, status);
    return {status};
  }
  function review({scope, ref, guard, root, cwd, commands, paths, reason}) {
    guard();
    const owner = owning(scope);
    if (owning(current()) !== owner) fail('ssh_terminal_approval_changed');
    if ([...approvals.values()].some(row => row.owner === owner)) fail('ssh_terminal_approval_pending');
    const approvalId = uuid(), at = now(), expiresAt = at + 120000;
    const view = {approvalId, provider:scope.provider, threadId:scope.threadId, resourceName:ref.resourceName,
      connectionId:ref.connectionId, workspaceRoot:root, cwd, commands, paths, reason, expiresAt};
    const revision = current()?.revision;
    const approvalGuard = () => {
      guard();
      const fresh = current();
      if (owning(fresh) !== owner || revision !== fresh?.revision || now() >= expiresAt) fail('ssh_terminal_approval_changed');
    };
    return new Promise(resolve => {
      const row = {owner, view, guard:approvalGuard, resolve, at};
      row.timer = setTimeout(() => settle(row, 'expired'), expiresAt - now());
      row.timer.unref?.();
      approvals.set(approvalId, row);
      emit();
    });
  }
  async function run({scope, ref, guard, entry, registered, command, beforeMutation}) {
    const {root, identity} = registered;
    const cwd = entry.cwd;
    const config = {scope, ref, guard, root, cwd};
    const execute = async (mode, args, dispatchGuard=guard) => {
      dispatchGuard();
      const mutates=!observations.has(mode);
      if (mutates) beforeMutation?.();
      let received=false;
      try {
        const response = await connections.runWorkspaceCommand({connectionId:ref.connectionId, profileId:ref.profileId, profileVersion:ref.profileVersion, root, cwd, identity, mode, args}, dispatchGuard);
        received=true;
        dispatchGuard();
        if (!response || !['result','outside','destructive','changed','unavailable','submission_unconfirmed'].includes(response.status) || !Number.isInteger(response.code) || typeof response.output !== 'string') throw Error('ssh_workspace_unconfirmed');
        if (response.status === 'changed') throw Object.assign(Error('ssh_workspace_changed'),{operationDispatched:false});
        return response;
      } catch(error) {
        error.operationDispatched=mutates&&(error.operationDispatched??(received||!error.operationNotStarted));
        throw error;
      }
    };
    let {mode, args, paths, reason, scheduler} = classifyWorkspaceCommand(command, root, cwd);
    const commands = [command];
    let response, replacement;
    const approvalMode=developerCompute?.approvalMode(scope,registered.workspaceId)??'manual';
    const full=approvalMode==='full';
    const automaticGuard=()=>{
      guard();
      if(developerCompute?.approvalMode(scope,registered.workspaceId)!==approvalMode)fail('ssh_terminal_approval_changed');
    };
    const replacementArgs=(result,mode,args)=>{
      if (!(approvalMode==='auto'||full)||!inside(root,cwd)||result.status!=='destructive') return;
      const destination=result.output.replace(/\r?\n$/,'');
      if (!absoluteWorkspace(destination)||!inside(root,destination)) return;
      if (mode==='write') return [destination,'write',args[1]];
      if (mode==='copy'||mode==='copy_target') return [destination,'copy',args[0]];
    };
    // File mutations inside the selected workspace can use the same kernel-enforced
    // boundary as other workspace programs. Scheduler cancellations affect external state.
    const confinedMutation=()=>full&&reason==='destructive'&&inside(root,cwd)&&
      paths.every(item=>inside(root,item))&&/^(?:rm|rmdir|unlink|mv|truncate|chmod)\s/.test(command)&&
      words(command)?.slice(1).filter(item=>!item.startsWith('-')).every(item=>!item.startsWith('~')&&inside(root,absolute(cwd,item)));
    if(mode==='cwd'&&args[0]==='-'){
      if(!entry.previousCwd)return {accepted:true,execution_status:'failed',exit_code:1,output:'No previous directory for this terminal.',cwd};
      args=[entry.previousCwd];
    }
    const fullMutation=confinedMutation();
    if (reason === 'unverified_effects' || fullMutation) {
      response = await execute('confined', args,fullMutation?automaticGuard:guard);
      if (response.status === 'result' && ['landlock','bubblewrap'].includes(response.confinement)) reason = null;
      else if (response.status !== 'unavailable') fail('ssh_workspace_unconfirmed');
    }
    if (mode === 'job_preview') {
      response = await execute(mode, args);
      if (response.status === 'result' && response.code === 0) {
        const [path, sha, ...lines] = response.output.split('\n');
        if (!absoluteWorkspace(path) || !inside(root, path) || !/^[a-f0-9]{64}$/.test(sha) || !lines.length) fail('ssh_workspace_unconfirmed');
        commands.push(lines.join('\n'));
        paths = [path, cwd];
        reason = 'independent_job';
        mode = 'job';
        args = [path, sha, scheduler];
      } else if (response.status === 'outside') {
        reason = 'outside_workspace';
        paths = [...paths, response.output.trim()];
        mode = 'approved';
        args = [command];
      } else return {accepted:true, execution_status:'failed', exit_code:response.code, output:response.output, cwd};
    }
    if(mode==='copy_target'){
      const observation=await execute(mode,args);
      if(observation.status==='result'&&observation.code===0){
        const [source,destination,...rest]=observation.output.replace(/\n$/,'').split('\n');
        if(rest.length||!absoluteWorkspace(source)||!absoluteWorkspace(destination)||!inside(root,destination))fail('ssh_workspace_unconfirmed');
        // Send only the canonical target from this read-only observation. The
        // copy lane canonicalizes again, checks containment and never clobbers.
        mode='copy';args=[source,destination];paths=[destination];
      }else if(['outside','destructive'].includes(observation.status)){
        replacement=replacementArgs(observation,mode,args);
        reason=observation.status==='outside'?'outside_workspace':'destructive';
        paths=[...new Set([...paths,observation.output.trim()])];mode='approved';args=[command];
      }else return {accepted:true,execution_status:'failed',exit_code:observation.code,output:observation.output,cwd};
    }
    if (!reason && !response) {
      response = await execute(mode, args);
      if (['outside','destructive'].includes(response.status)) {
        replacement=replacementArgs(response,mode,args);
        reason = response.status === 'outside' ? 'outside_workspace' : 'destructive';
        paths = [...new Set([...paths, response.output.trim()])];
        mode='approved';args=[command];
      }
    }
    if (replacement) {
      const result=await execute('confined_overwrite',replacement,automaticGuard);
      if(result.status==='result'&&['landlock','bubblewrap'].includes(result.confinement)){response=result;reason=null;}
      else if(result.status!=='unavailable')fail('ssh_workspace_unconfirmed');
    }
    if(full&&reason==='independent_job'&&commands.length===2&&workspaceJobDirectives(commands[1],scheduler)){
      // The remote helper reserves this exact script before submission, including in full mode.
      response=await execute('job',[...args,uuid()],automaticGuard);
      reason=null;
    }
    if (reason) {
      const approval=await review({...config, commands, paths, reason});
      if (approval.decision !== 'approved') return {accepted:false, execution_status:'denied', approval_status:approval.decision, cwd};
      if(mode==='job')args=[...args,approval.approvalId];
      response = await execute(mode, args, approval.guard);
    }
    if (response.status === 'result' && response.code === 0 && mode==='cwd') {
      const actualPath=response.output.replace(/\r?\n$/,'');
      if (!canonicalDirectory(actualPath)) throw Error('ssh_workspace_unconfirmed');
      entry.previousCwd=entry.cwd;
      entry.cwd=actualPath;
    }
    const jobReceipt=scheduler==='bsub'?/\bJob <([0-9]+)>/:/^([0-9]+)(?:;[^\s;]+)?$/;
    const job=mode==='job'&&response.code===0?response.output.split('\n').map(line=>jobReceipt.exec(line.trim())).find(match=>match)?.[1]:null;
    return {accepted:true, execution_status:response.status==='submission_unconfirmed'?'submission_unconfirmed':response.code !== 0 ? 'failed' : mode==='job' ? job?'submitted':'submission_unconfirmed' : 'completed',
      exit_code:response.code, output:response.output, cwd:entry.cwd,...job?{job_id:job}:{},...response.confinement?{confinement:response.confinement}:{}};
  }
  async function operate({scope, ref, input, channel, assertCurrent, verifyConnection}) {
    const registered = workspace.forTerminal(ref, scope);
    const modeRevision=developerCompute?.revision(registered.workspaceId);
    const key = JSON.stringify([owning(scope), ref.connectionId, channel]);
    const guard = () => {
      assertCurrent();
      if(modeRevision!==developerCompute?.revision(registered.workspaceId))fail('ssh_terminal_approval_changed');
      const fresh = workspace.forTerminal(ref, scope);
      if (fresh.workspaceId !== registered.workspaceId || fresh.path !== registered.path) fail('ssh_workspace_changed');
    };
    guard();
    let entry = stages.get(key);
    if (!entry) {
      if (stages.size >= 128) {
        for (const [id, state] of stages) {
          if (state.running) continue;
          try { state.assertCurrent(); } catch { stages.delete(id); }
        }
        if (stages.size >= 128) fail('ssh_terminal_request_limit');
      }
      entry = {owner: owning(scope), workspaceId:registered.workspaceId, path:registered.path, cwd:registered.path, staged:'', requests:new Map(), running:false, assertCurrent,modeRevision};
      stages.set(key,entry);
    }
    const signature = JSON.stringify(input), prior = entry.requests.get(input.requestId);
    if (prior) {
      if (prior.signature !== signature) fail('terminal_invalid_request');
      return prior.operation;
    }
    if (entry.running) fail('ssh_terminal_command_pending');
    if(entry.modeRevision!==modeRevision){entry.staged='';entry.modeRevision=modeRevision;}
    if (entry.requests.size >= 4096) fail('ssh_terminal_request_limit');
    entry.assertCurrent=assertCurrent;
    if (entry.workspaceId !== registered.workspaceId || entry.path !== registered.path) {
      Object.assign(entry,{workspaceId:registered.workspaceId,path:registered.path,cwd:registered.path,previousCwd:undefined,staged:''});
    }
    const operation = Promise.resolve().then(async () => {
      guard();
      if (input.command !== undefined) {
        const receiptId = commandDigest([owning(scope),ref.resourceId,input.requestId]);
        const digest = commandDigest([scope.projectId??null,registered.workspaceId,input.command]);
        const previous = catalog?.get('ssh-command-receipt',receiptId);
        if (previous) {
          if (previous.digest!==digest) fail('terminal_invalid_request');
          return {...(previous.receipt??{accepted:true,execution_status:'unconfirmed'}),cwd:entry.cwd,replayed:true};
        }
        // A cached receipt belongs to the original dispatch. Only a new command
        // needs a live connection check, and no command has been sent at this point.
        try {
          await verifyConnection?.();
          guard();
        } catch (error) {
          entry.requests.delete(input.requestId);
          throw Object.assign(error, {operationNotStarted:true});
        }
        let claimed = false;
        const beforeMutation = () => {
          if (!catalog || claimed) return;
          // Record the dispatch before it can have a remote effect. A lost
          // reply leaves this receipt unresolved across logins and restarts.
          const save = () => {
            if (catalog.get('ssh-command-receipt',receiptId)) throw Error('ssh_command_outcome_unconfirmed');
            catalog.put('ssh-command-receipt',receiptId,{digest});
          };
          if (catalog.transaction) catalog.transaction(save); else save();
          claimed = true;
        };
        let result;
        try {
          result = await run({scope,ref,guard,entry,registered,command:input.command,beforeMutation});
        } catch(error) {
          if (claimed&&(error.operationDispatched===false||error.operationDispatched!==true&&error.operationNotStarted===true)) {
            try {
              if(catalog.remove){catalog.remove('ssh-command-receipt',receiptId);entry.requests.delete(input.requestId);}
            } catch { /* Keep the reservation if the local store cannot clear it. */ }
          }
          throw error;
        }
        if (claimed) {
          const {accepted,execution_status,exit_code,job_id,approval_status} = result;
          try {
            catalog.put('ssh-command-receipt',receiptId,{digest,receipt:{accepted,execution_status,
              ...exit_code!==undefined?{exit_code}:{},...job_id?{job_id}:{},...approval_status?{approval_status}:{}}});
          } catch {
            // Keep the original dispatch record when a completed receipt cannot be saved.
          }
        }
        return result;
      }
      if (input.data === '\x03') { entry.staged = ''; return {accepted:true, execution_status:'cleared', cwd:entry.cwd}; }
      if (input.data !== '\r') {
        const staged = entry.staged + input.data;
        if (!staged || Buffer.byteLength(staged) > 8192 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(staged)) fail('terminal_invalid_request');
        entry.staged = staged;
        return {accepted:true, execution_status:'staged', cwd:entry.cwd};
      }
      const command = entry.staged.replaceAll('\r\n','\n').replaceAll('\r','\n');
      entry.staged = '';
      if (!command.trim()) return {accepted:true, execution_status:'empty', cwd:entry.cwd};
      return run({scope,ref,guard,entry,registered,command});
    }).finally(() => {entry.running = false;});
    entry.running = true;
    entry.requests.set(input.requestId, {signature, operation});
    return operation;
  }
  return {
    input:({sessionId,ownerEpoch,...params})=>operate({...params,channel:['terminal',sessionId,ownerEpoch]}),
    execute:({leaseId,requestId,command,...params})=>operate({...params,channel:['command',leaseId],input:{requestId,command}}),
    pending, decide, activity,
    revalidatePending() { for (const row of [...approvals.values()]) try { row.guard(); } catch { settle(row, 'changed'); } },
    revokeConnection(connectionId) { for (const row of [...approvals.values()]) if (row.view.connectionId === connectionId) settle(row, 'changed'); },
    forget(provider, threadId) {
      const target = owning({provider, threadId});
      for (const row of [...approvals.values()]) if (row.view.provider === provider && row.view.threadId === threadId) settle(row, 'changed');
      for (const [id, state] of stages) if (state.owner === target) stages.delete(id);
    }};
}
