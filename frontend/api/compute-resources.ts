import type {ComputeResourceActivation,ComputeResourceState,SshServiceConnectRequest,SshServiceDisconnectRequest,SshServiceCheckRequest,SshServiceRegistrationRequest,SshServiceRegistrationState,SshServiceState,SshServiceOwnerRequest,SshServiceStatusRequest,SshSchedulerRequest,SshConnectionOpenRequest,SshConnectionState,SshConnectionRequest,SshConnectionAuthReadRequest,SshConnectionAuthReadResult,SshConnectionAuthInputRequest,SshConnectionAuthResizeRequest,SshConnectionOpenShellRequest,SshConnectionCompleteLoginRequest,SshConnectionCompleteLoginResult,SshConnectionLoginStatusRequest,SshConnectionLoginStatusResult} from '../../contracts/dto/compute';
import {invoke} from './studio';

export const computeResources={
 status:()=>invoke<ComputeResourceState>('compute.resource.status',{}),
 activate:(reference:ComputeResourceActivation)=>invoke<ComputeResourceState>('compute.resource.activate',reference),
 clear:(selectionId:string)=>invoke<ComputeResourceState>('compute.resource.clear',{selectionId})
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
