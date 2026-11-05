import type {ComputeResourceActivation,ComputeResourceState} from '../../contracts/dto/compute';
import {invoke} from './studio';

export const computeResources={
 status:()=>invoke<ComputeResourceState>('compute.resource.status',{}),
 activate:(reference:ComputeResourceActivation)=>invoke<ComputeResourceState>('compute.resource.activate',reference),
 clear:(selectionId:string)=>invoke<ComputeResourceState>('compute.resource.clear',{selectionId})
};
