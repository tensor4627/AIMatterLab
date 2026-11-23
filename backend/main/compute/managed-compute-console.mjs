import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {readExistingWorker} from './existing-worker.mjs';
import {normalizeSshServiceHealth} from './ssh-connection-service.mjs';

const freshMs = 45000;
const providers = new Set(['codex','kimi','qwen','deepseek','compatible']);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const textId = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
const profileKey = ({profileId,profileVersion}) => JSON.stringify([profileId,profileVersion]);
const ownerKey = ({provider,threadId}) => JSON.stringify([provider,threadId]);
const sshRef = ({profileId,profileVersion,connectionId}) => ({profileId,profileVersion,connectionId});
const sameRef = (a,b) => a && b && a.profileId === b.profileId && a.profileVersion === b.profileVersion && a.connectionId === b.connectionId;
const fail = code => { throw Error(code); };
const online = view => view.status === 'authenticated' && view.authentication === 'verified' && view.multiplex;

function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value,field))) {
    fail('invalid_compute_console_request');
  }
}
function profileTarget(target) {
  if (!identifier(target.profileId) || !Number.isSafeInteger(target.profileVersion) || target.profileVersion < 1) fail('invalid_compute_console_request');
}
const result = (status,checkedAt = null) => ({status,checkedAt});

export function createManagedComputeConsole({profiles, terminal, resources, conversationTerminals, records, catalog,
  registration, worker, closeSsh, assertConnectionIdle = () => {}, notify, now = Date.now, readLocal = readExistingWorker}) {
  let brokerInventory = null, refreshing = null, latestCheck = null;
  let foregroundCheck = null;
  const services = new Map(), shells = new Map(), localChecks = new Map(), localOperations = new Set();
  const recent = row => row?.checkedAt != null && now() - row.checkedAt <= freshMs;
  const observable = value => value?.status === 'online' && !recent(value) ? result('unknown',value.checkedAt) : value;

  function foregroundBinding(saved = profiles.list()) {
    const identity = worker?.identity, connection = worker?.connection, target = worker?.connectionTarget;
    if (!connection || !identity || identity.kind === 'ssh' || !target || typeof identity.distribution !== 'string' || !Number.isSafeInteger(target.port)) return null;
    const matches = saved.filter(row=>row.kind==='wsl'&&row.distribution===identity.distribution&&row.port===target.port&&[target.root,target.requestedRoot].includes(row.root));
    return {connection,epoch:worker.connectionEpoch,root:identity.root,runtime:connection.health?.runtime,
      distribution:identity.distribution,port:target.port,profile:matches.length===1?matches[0]:null};
  }
  const covers = (binding,profile) => binding?.profile?.id === profile.id && binding.profile.version === profile.version;
  function inspectLocal(profileId,profileVersion) {
    const profile = profiles.read({id:profileId});
    if (profile.kind !== 'wsl' || profile.version !== profileVersion) fail('managed_compute_profile_changed');
    return profile;
  }
  function checkedProfile(ref) {
    try { return profiles.read({id:ref.profileId,version:ref.profileVersion}); }
    catch { return null; }
  }
  function projectList(chats) {
    const projects = new Map();
    for (const item of [...catalog.list('workspace-index'),...catalog.list('projects')]) {
      if (textId(item.id)) projects.set(item.id,{id:item.id,name:item.name || item.id});
    }
    for (const chat of chats) {
      if (textId(chat.projectId) && !projects.has(chat.projectId)) projects.set(chat.projectId,{id:chat.projectId,name:chat.projectId});
    }
    return projects;
  }
  function terminalRow(shell,masterStatus='online') {
    const profile = shell.resource?.profileId && checkedProfile(shell.resource);
    return {sessionId:shell.sessionId,mode:shell.mode,kind:shell.kind,owner:shell.owner,
      ...shell.resource?.profileId ? {profileId:shell.resource.profileId,profileVersion:shell.resource.profileVersion} : {},
      ...profile ? {profileName:profile.name} : {},
      ...result(!shell.verified || !recent(brokerInventory) ? 'unknown' : shell.expired || !shell.alive ? 'closed' : masterStatus==='online' ? 'online' : 'unknown',brokerInventory.checkedAt)};
  }
  function channelRow(channel,source,conversations,projects,status,checkedAt) {
    const chat = conversations.get(ownerKey(channel));
    return {source,leaseId:channel.leaseId ?? channel.sessionId,provider:channel.provider,threadId:channel.threadId,
      conversationId:chat?.id ?? null,conversationName:chat?.name ?? null,
      projectId:channel.projectId ?? null,projectName:projects.get(channel.projectId)?.name ?? null,
      sessionId:channel.sessionId,serviceOnly:channel.serviceOnly===true,serviceContext:channel.serviceContext===true,
      ...channel.commandContext?{commandContext:true}:{},
      terminalStatus:channel.terminalStatus??null,busy:channel.busy,status,checkedAt};
  }

  function snapshot({projectAccess = () => []} = {}) {
    const saved = profiles.list(), byProfile = new Map(saved.map(profile => [profile.id,profile]));
    const foreground = foregroundBinding(saved);
    const {entries,channels} = resources.consoleEntries();
    const currentLegacy = conversationTerminals?.consoleEntries() ?? [];
    const observed = brokerInventory?.connections ?? [];
    const terminalList = brokerInventory?.sessions ?? [];
    const chats = records.conversations();
    const conversations = new Map(chats.map(row => [ownerKey(row),row]));
    const projects = projectList(chats);
    const masters = new Map(observed.filter(row => row.status !== 'closed' || !row.closed).map(row => [row.connectionId,row]));
    for (const item of [...entries,...channels,...currentLegacy]) {
      if (item.connectionId && !masters.has(item.connectionId) && !observed.some(row => row.connectionId === item.connectionId && row.closed)) masters.set(item.connectionId,{...sshRef(item),verified:false});
    }
    const list = [];
    function scopedChannels(entry,master,service,masterStatus) {
      const managed = channels.filter(channel => master ? sameRef(channel,master) : sameRef(channel,entry)).map(channel => {
        const proof = shells.get(channel.leaseId);
        let status = channel.status, checkedAt = null;
        if (status === 'assigned') {
          if (channel.expired) status = 'lost';
          else if (master && masterStatus !== 'online') {
            status = masterStatus === 'lost' ? 'lost' : 'unknown';
            checkedAt = brokerInventory?.checkedAt ?? null;
          } else if (channel.commandContext&&!channel.sessionId) {
            status = !recent(brokerInventory)||!master?.verified ? 'unknown' : online(master) ? 'assigned' : 'lost';
            checkedAt = brokerInventory?.checkedAt ?? null;
          } else if (channel.serviceOnly) {
            const generation = channel.serviceGeneration ?? entry?.generation;
            const current = generation && entry?.generation === generation && (!master || master.service?.serviceId === generation);
            status = service.status === 'online' && current ? 'assigned' : service.status === 'lost' || generation && entry?.generation !== generation ? 'lost' : 'unknown';
            checkedAt = service.checkedAt;
          } else if (!recent(brokerInventory)) status = 'unknown';
          else if (!master.verified || !online(master)) status = 'lost';
          else if (!recent(proof) || proof.sessionId!==channel.sessionId) status = 'unknown';
          else { status = proof.status === 'online' ? 'assigned' : 'lost'; checkedAt = proof.checkedAt; }
        }
        return channelRow(channel,channel.kind === 'wsl' ? 'wsl' : 'managed',conversations,projects,status,checkedAt);
      });
      const legacy = master ? currentLegacy.filter(channel => sameRef(channel,master)).map(channel => {
        const shell = terminalList.find(row => row.sessionId === channel.sessionId && row.connectionId === master.connectionId);
        let status = channel.status;
        if (status === 'assigned' || status === 'parked') {
          if (masterStatus !== 'online') status = masterStatus === 'lost' ? 'lost' : 'unknown';
          else if (!shell?.verified || shell.owner !== 'agent' || !shell.alive || shell.expired) status = 'lost';
        }
        return channelRow(channel,'handoff',conversations,projects,status,brokerInventory?.checkedAt ?? null);
      }) : [];
      return [...managed,...legacy];
    }
    for (const master of masters.values()) {
      const profile = checkedProfile(master);
      const current = byProfile.get(master.profileId)?.version === master.profileVersion;
      const managed = entries.find(entry => sameRef(entry,master));
      const proof = services.get(master.connectionId);
      const check = brokerInventory?.checkedAt ?? null;
      const masterStatus = !recent(brokerInventory) ? 'unknown' : !master.verified ?
        brokerInventory.complete && !master.verificationPending ? 'lost' : 'unknown' :
        online(master) ? 'online' : master.status === 'authenticating' ? 'preparing' : master.status === 'requires_review' || master.status === 'unsupported' ? 'requires_review' : 'lost';
      const channel = master.service;
      let status = masterStatus === 'lost' ? 'lost' : 'unknown', checkedAt = check;
      if (masterStatus === 'online') {
        if (managed?.serviceStatus === 'preparing' || channel?.status === 'connecting') { status = 'preparing'; checkedAt = null; }
        else if (channel?.active && channel.status === 'connected') {
          const same = proof?.generation === channel.serviceId;
          status = same && recent(proof) ? proof.status : 'channel_ready';
          checkedAt = same ? proof.checkedAt : check;
        } else if (channel?.active) status = 'unknown';
        else if (channel?.status === 'failed' || channel?.status === 'disconnected' || managed?.serviceStatus === 'unavailable') status = 'lost';
        else if (channel) {
          let registered;
          try { registered = registration.read({profileId:master.profileId,profileVersion:master.profileVersion}); } catch { registered = null; }
          status = managed?.serviceStatus === 'configuration_required' || registered?.status === 'unconfigured' ? 'unconfigured' : registered?.status === 'maintenance_required' ? 'requires_review' : 'offline';
        }
      }
      const service = {...result(status,checkedAt),kind:channel?.kind ?? 'private'};
      const leases = scopedChannels(managed,master,service,masterStatus);
      const assigned = new Set(leases.map(lease => lease.sessionId));
      const terminals = terminalList.filter(row => row.connectionId === master.connectionId && !assigned.has(row.sessionId) && (row.alive || !row.verified));
      list.push({key:master.connectionId,kind:'ssh',name:profile?.name ?? byProfile.get(master.profileId)?.name ?? master.profileId,...sshRef(master),current,
        target:profile?.kind === 'ssh' ? profile.host + ':' + profile.port : null, mode:profile?.mode ?? 'interactive',
        master:result(masterStatus,check),canDisconnect:master.verified&&recent(brokerInventory)&&['authenticated','authenticating','unavailable'].includes(master.status),capacity:masterStatus === 'online' ? master.capacity : null,
        service,channels:leases,terminals:terminals.map(shell=>terminalRow(shell,masterStatus)),managedId:managed?.resourceId ?? null,
        projectPolicies:managed ? projectAccess(managed) : []});
    }
    for (const profile of saved) {
      const profileRef = {profileId:profile.id,profileVersion:profile.version}, key = profileKey(profileRef);
      if (profile.kind === 'ssh' && [...masters.values()].some(master => profileKey(master) === key)) continue;
      const base = {key:profile.kind + ':' + profile.id + ':' + profile.version,kind:profile.kind,name:profile.name,...profileRef,current:true,
        terminals:[],capacity:null,connectionId:null,projectPolicies:[]};
      if (profile.kind === 'ssh') {
        list.push({...base,mode:profile.mode,target:profile.host + ':' + profile.port,master:result(brokerInventory?.complete && recent(brokerInventory) ? 'offline' : 'unknown',brokerInventory?.checkedAt),
          service:{...result('unknown'),kind:'private'},managedId:null,channels:[]});
        continue;
      }
      const managed = entries.find(row => row.kind === 'wsl' && profileKey(row) === key);
      const front = covers(foreground,profile) ? foreground : null, proof = localChecks.get(key);
      let service;
      if (localOperations.has(key) || managed?.serviceStatus === 'preparing') service = result('preparing');
      else if (proof && (managed?.generation && proof.generation===managed.generation || front && proof.epoch===front.epoch)) service = observable(proof);
      else if (managed?.generation || front) service = result('unknown',proof?.checkedAt);
      else if (proof && !proof.generation && proof.epoch == null) service = observable(proof);
      else service = result(proof?.status === 'online' || proof?.status === 'lost' ? 'lost' : 'offline',proof?.checkedAt);
      list.push({...base,target:profile.distribution + ' · :' + profile.port,master:null,
        managedId:managed?.resourceId ?? null,localGeneration:managed?.generation ?? null,foregroundEpoch:front?.epoch ?? null,
        service:{status:service.status,checkedAt:service.checkedAt,kind:'wsl'},channels:scopedChannels(managed ?? {kind:'wsl',...profileRef},null,service)});
    }
    const standalone = terminalList.filter(shell => !shell.connectionId && (shell.alive || !shell.verified)).map(shell=>terminalRow(shell));
    const foregroundLocal = foreground && !foreground.profile ? {distribution:foreground.distribution,port:foreground.port,foregroundEpoch:foreground.epoch,
      service:foregroundCheck?.epoch===foreground.epoch ? observable(foregroundCheck) : result('unknown')} : null;
    return {checkedAt:latestCheck,observation:!brokerInventory ? 'unverified' : brokerInventory.complete ? 'complete' : 'partial',resources:list,standalone,foregroundLocal,projects:[...projects.values()]};
  }

  async function inspectUnmanagedSsh(master) {
    const {connectionId} = master, serviceId = master.service.serviceId;
    const baseline = await terminal.connections.serviceState({connectionId,serviceId});
    if (!sameRef(master,baseline) || baseline.serviceId !== serviceId || baseline.channelKind !== 'private' || baseline.status !== 'connected' || !baseline.serviceActive) return false;
    const expected = normalizeSshServiceHealth(baseline);
    const response = await terminal.connections.privateServiceRequest({connectionId,serviceId,requestId:randomUUID(),method:'GET',target:'/api/health',mcp:false,timeoutMs:10000});
    if (response.status !== 200) return false;
    const health = normalizeSshServiceHealth(response.data);
    return ['root','runtime','runtimeId','hostIdentity','port'].every(key => isDeepStrictEqual(expected[key],health[key]));
  }
  async function inspectForeground(front) {
    if (!front?.root || !front.runtime) return false;
    const response = await worker.forward('GET','/api/health',undefined,false,10000);
    const value = response.data;
    return worker.connection === front.connection && worker.connectionEpoch === front.epoch && response.status === 200 && value?.name === 'gpu-sampling-studio' && value.execution_policy === 'desktop-review-v1' && value.ssh_service !== true && value.root === front.root && value.runtime === front.runtime;
  }
  async function check() {
    const brokerRead = terminal.consoleInventory().then(value => {
      brokerInventory = {...value,checkedAt:now()};
    },() => {
      brokerInventory = {...(brokerInventory ?? {connections:[],sessions:[]}),complete:false,checkedAt:now()};
      brokerInventory.connections = brokerInventory.connections.map(row => ({...row,verified:false}));
      brokerInventory.sessions = brokerInventory.sessions.map(row => ({...row,verified:false}));
    });
    const observe = async (probe, map, key, extra) => {
      let status;
      try { status = await probe() ? 'online' : 'lost'; }
      catch (error) {
        status = ['ssh_control_timeout','ssh_control_unavailable'].includes(error?.message) ? 'unknown' : 'lost';
      }
      map.set(key,{...extra,...result(status,now())});
    };
    await brokerRead;
    const {entries,channels} = resources.consoleEntries(), observed = brokerInventory.connections;
    for (const id of services.keys()) if (!observed.some(row => row.connectionId === id)) services.delete(id);
    for (const id of shells.keys()) if (!channels.some(row => row.leaseId === id)) shells.delete(id);
    const ssh = observed.filter(row => row.verified && online(row) && row.service?.active && row.service.kind === 'private' && row.service.status === 'connected' && row.service.serviceId);
    const checks = ssh.map(row => {
      const generation = row.service.serviceId;
      const entry = entries.find(item => sameRef(item,row) && item.generation === generation);
      return observe(() => entry ? resources.observeConsoleService(entry) : inspectUnmanagedSsh(row),services,row.connectionId,{generation});
    });
    for (const channel of channels) {
      if (channel.kind === 'ssh' && channel.sessionId && !channel.serviceOnly && channel.status === 'assigned' && !channel.expired && observed.some(row => sameRef(channel,row) && row.verified && online(row))) {
        checks.push(observe(() => resources.observeConsoleLease(channel),shells,channel.leaseId,{sessionId:channel.sessionId}));
      }
    }
    const localProfiles = profiles.list().filter(row => row.kind === 'wsl');
    const front = foregroundBinding(localProfiles);
    for (const profile of localProfiles) {
      const key = profileKey({profileId:profile.id,profileVersion:profile.version});
      const entry = entries.find(row => row.kind === 'wsl' && profileKey(row) === key && row.generation);
      if (entry) checks.push(observe(() => resources.observeConsoleService(entry),localChecks,key,{generation:entry.generation}));
      else if (covers(front,profile)) checks.push(observe(() => inspectForeground(front),localChecks,key,{epoch:front.epoch}));
    }
    if (front && !front.profile) {
      checks.push(inspectForeground(front).catch(()=>false).then(live=>{
        foregroundCheck={epoch:front.epoch,...result(live?'online':'lost',now())};
      }));
    }
    await Promise.all(checks);
    latestCheck = now();
  }
  function refresh() {
    if (!refreshing) refreshing = check().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function release(target) {
    exact(target,['resourceId','connectionId','source','leaseId','provider','threadId']);
    if (typeof target.resourceId !== 'string' || !/^(ssh|wsl):[A-Za-z0-9_-]{1,200}$/.test(target.resourceId) || !identifier(target.leaseId) || !providers.has(target.provider) || !textId(target.threadId) || target.threadId.length > 200 ||
      !['wsl','managed','handoff'].includes(target.source) || (target.source === 'wsl' ? target.connectionId !== null : !identifier(target.connectionId))) fail('invalid_compute_console_request');
    if (target.source === 'handoff') {
      const owned = (conversationTerminals?.consoleEntries() ?? []).find(row => row.connectionId === target.connectionId && row.sessionId === target.leaseId && ownerKey(row) === ownerKey(target));
      if (!owned || target.resourceId !== 'ssh:' + owned.profileId) fail('managed_compute_channel_changed');
      return conversationTerminals.releaseFromConsole(target);
    }
    const owned = resources.consoleEntries().channels.find(row => row.resourceId === target.resourceId && (row.connectionId ?? null) === target.connectionId && row.leaseId === target.leaseId && ownerKey(row) === ownerKey(target));
    if (!owned || (owned.kind === 'wsl') !== (target.source === 'wsl')) fail('managed_compute_channel_changed');
    return resources.releaseFromConsole(target);
  }
  async function disconnectSsh(target) {
    exact(target,['profileId','profileVersion','connectionId']);profileTarget(target);
    if (!identifier(target.connectionId)) fail('invalid_compute_console_request');
    const view = await terminal.connections.state({connectionId:target.connectionId});
    if (!sameRef(view,target) || !['authenticated','authenticating','unavailable'].includes(view.status)) fail('managed_compute_resource_unavailable');
    const leases = [...resources.consoleEntries().channels,...(conversationTerminals?.consoleEntries() ?? [])];
    if (leases.some(row => row.connectionId === target.connectionId && row.busy)) fail('managed_compute_channel_busy');
    assertConnectionIdle(target);
    const report = await closeSsh(target);
    return {status:report?.status === 'closed' && report.closed === true ? 'disconnected' : 'unconfirmed'};
  }
  async function attachLocal(target) {
    exact(target,['profileId','profileVersion']);profileTarget(target);
    const key = profileKey(target), profile = inspectLocal(target.profileId,target.profileVersion);
    if (localOperations.has(key)) fail('managed_compute_channel_busy');
    localOperations.add(key);notify();
    try {
      const proof = await readLocal({distribution:profile.distribution,workerRoot:profile.root,workerPort:profile.port});
      inspectLocal(target.profileId,target.profileVersion);
      const health = proof?.connection?.health;
      if (proof?.status !== 'connected' || health?.name !== 'gpu-sampling-studio' || health.execution_policy !== 'desktop-review-v1' || health.ssh_service === true) fail('managed_compute_private_service_unavailable');
      await resources.publishWsl({...target,distribution:profile.distribution,port:profile.port,root:health.root,runtime:health.runtime});
      return {status:'attached'};
    } catch (error) {
      localChecks.set(key,result('lost',now()));
      throw error;
    } finally { localOperations.delete(key);notify(); }
  }
  async function detachLocal(target) {
    exact(target,['profileId','profileVersion','generation','foregroundEpoch']);
    if (target.generation !== null && !identifier(target.generation) || target.foregroundEpoch !== null && (!Number.isSafeInteger(target.foregroundEpoch) || target.foregroundEpoch < 0) ||
      target.generation === null && target.foregroundEpoch === null) fail('invalid_compute_console_request');
    const foreground = foregroundBinding();
    const detachForeground = () => { assertConnectionIdle();worker.close(); };
    if (target.profileId === null && target.profileVersion === null && target.generation === null) {
      if (!foreground || foreground.profile || foreground.epoch !== target.foregroundEpoch) fail('managed_compute_resource_unavailable');
      detachForeground();notify();return {status:'disconnected'};
    }
    profileTarget(target);
    const profile = inspectLocal(target.profileId,target.profileVersion), key = profileKey(target), front = covers(foreground,profile) ? foreground : null;
    const managed = resources.consoleEntries().entries.find(row => row.kind === 'wsl' && profileKey(row) === key);
    if (localOperations.has(key)) fail('managed_compute_channel_busy');
    if ((front?.epoch ?? null) !== target.foregroundEpoch || (managed?.generation ?? null) !== target.generation) fail('managed_compute_resource_unavailable');
    if (managed?.generation) await resources.detachLocalFromConsole({...target,resourceId:managed.resourceId},front?detachForeground:undefined);
    else if (front) detachForeground();
    localChecks.set(key,result('offline',now()));notify();
    return {status:'disconnected'};
  }
  return {snapshot,refresh,release,disconnectSsh,attachLocal,detachLocal};
}
