import type {ComputeResourceActivation,ComputeResourceState,SshServiceConnectRequest,SshServiceDisconnectRequest,SshServiceCheckRequest,SshServiceRegistrationRequest,SshServiceRegistrationState,SshServiceState,SshServiceOwnerRequest,SshServiceStatusRequest,SshSchedulerRequest,SshConnectionOpenRequest,SshConnectionState,SshConnectionRequest,SshConnectionAuthReadRequest,SshConnectionAuthReadResult,SshConnectionAuthInputRequest,SshConnectionAuthResizeRequest,SshConnectionOpenShellRequest,SshConnectionCompleteLoginRequest,SshConnectionCompleteLoginResult,SshConnectionLoginStatusRequest,SshConnectionLoginStatusResult} from '../../contracts/dto/compute';
import {invoke} from './studio';
import type {ResourceWorkspaceReference,ManagedSshServiceStatus,ManagedSshServiceUpdateRequest} from '../../contracts/dto/compute';
import type {PublishedSshResource} from '../../contracts/dto/managed-compute';
import type {ResourceWorkspacePreviewRequest,ResourceWorkspaceConfirmRequest,ResourceWorkspaceReadRequest,ResourceWorkspaceReadResult,ResourceWorkspacePreview,SessionWorkspaceResult,TerminalWorkspaceApproval,TerminalWorkspaceDecision} from '../../contracts/dto/compute';

export const computeResources={
 status:()=>invoke<ComputeResourceState>('compute.resource.status',{}),
 activate:(reference:ComputeResourceActivation)=>invoke<ComputeResourceState>('compute.resource.activate',reference),
 clear:(selectionId:string)=>invoke<ComputeResourceState>('compute.resource.clear',{selectionId})
};
export const resourceWorkspaces={
 read:(request:ResourceWorkspaceReadRequest)=>invoke<ResourceWorkspaceReadResult>('compute.resourceWorkspace.read',request),
 preview:(request:ResourceWorkspacePreviewRequest)=>invoke<ResourceWorkspacePreview>('compute.resourceWorkspace.preview',request),
 confirm:(request:ResourceWorkspaceConfirmRequest)=>invoke<ResourceWorkspacePreview>('compute.resourceWorkspace.confirm',request),
 cancel:(request:ResourceWorkspaceConfirmRequest)=>invoke<{cancelled:boolean}>('compute.resourceWorkspace.cancel',request),
 session:(request:{profileId?:string}={})=>invoke<SessionWorkspaceResult>('compute.resourceWorkspace.session',request),
};
export const terminalWorkspaceApprovals={
 pending:()=>invoke<TerminalWorkspaceApproval|null>('compute.terminalApproval.pending',{}),
 decide:(request:TerminalWorkspaceDecision)=>invoke<{status:'approved'|'denied'}>('compute.terminalApproval.decide',request),
};
export const managedSshServices={
 status:(request:ResourceWorkspaceReference)=>invoke<ManagedSshServiceStatus>('compute.managed.serviceStatus',request),
 update:(request:ManagedSshServiceUpdateRequest)=>invoke<PublishedSshResource>('compute.managed.updateService',request),
 useForWorkflow:(request:ResourceWorkspaceReference)=>invoke<SshServiceState>('compute.managed.useForWorkflow',request),
};
export const sshConnections={
 open:(request:SshConnectionOpenRequest)=>invoke<SshConnectionState>('compute.sshConnection.open',request),
 list:()=>invoke<{connections:SshConnectionState[]}>('compute.sshConnection.list',{}),
 state:(request:SshConnectionRequest)=>invoke<SshConnectionState>('compute.sshConnection.state',request),
 authRead:(request:SshConnectionAuthReadRequest)=>invoke<SshConnectionAuthReadResult>('compute.sshConnection.authRead',request),
 authInput:(request:SshConnectionAuthInputRequest)=>invoke<{accepted:boolean}>('compute.sshConnection.authInput',request),
 authResize:(request:SshConnectionAuthResizeRequest)=>invoke<{resized:boolean}>('compute.sshConnection.authResize',request),
 loginStatus:(request:SshConnectionLoginStatusRequest)=>invoke<SshConnectionLoginStatusResult>('compute.sshConnection.loginStatus',request),
 completeLogin:(request:SshConnectionCompleteLoginRequest)=>invoke<SshConnectionCompleteLoginResult>("compute.sshConnection.completeLogin",request),
 confirm:(request:SshConnectionRequest)=>invoke<SshConnectionState>('compute.sshConnection.confirm',request),
 openShell:(request:SshConnectionOpenShellRequest)=>invoke<import('../../contracts/dto/compute').SshShellSessionState>('compute.sshConnection.openShell',request),
 close:(request:SshConnectionRequest)=>invoke<SshConnectionState>('compute.sshConnection.close',request)
};
export const sshService={connect:(request:SshServiceConnectRequest)=>invoke<SshServiceState>('compute.sshService.connect',request),status:(request:SshServiceStatusRequest={})=>invoke<SshServiceState>('compute.sshService.status',request),owner:(request:SshServiceOwnerRequest)=>invoke<SshServiceState>('compute.sshService.owner',request),registration:(request:SshServiceRegistrationRequest)=>invoke<SshServiceRegistrationState>('compute.sshService.registration',request),check:(request:SshServiceCheckRequest)=>invoke<SshServiceState>('compute.sshService.check',request),disconnect:(request:SshServiceDisconnectRequest)=>invoke<SshServiceState>('compute.sshService.disconnect',request),scheduler:(request:SshSchedulerRequest)=>invoke<any>('compute.sshService.scheduler',request)};
