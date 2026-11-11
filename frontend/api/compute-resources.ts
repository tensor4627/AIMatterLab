import type {ComputeResourceActivation,ComputeResourceState,SshServiceConnectRequest,SshServiceDisconnectRequest,SshServiceState,SshSchedulerRequest} from '../../contracts/dto/compute';
import {invoke} from './studio';

export const computeResources={
 status:()=>invoke<ComputeResourceState>('compute.resource.status',{}),
 activate:(reference:ComputeResourceActivation)=>invoke<ComputeResourceState>('compute.resource.activate',reference),
 clear:(selectionId:string)=>invoke<ComputeResourceState>('compute.resource.clear',{selectionId})
};
export const sshService={connect:(request:SshServiceConnectRequest)=>invoke<SshServiceState>('compute.sshService.connect',request),status:()=>invoke<SshServiceState>('compute.sshService.status',{}),disconnect:(request:SshServiceDisconnectRequest)=>invoke<SshServiceState>('compute.sshService.disconnect',request),scheduler:(request:SshSchedulerRequest)=>invoke<any>('compute.sshService.scheduler',request)};
