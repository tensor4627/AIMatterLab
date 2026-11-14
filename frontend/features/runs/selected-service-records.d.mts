import type {ComputeResourceState,WorkerStatus} from '../../../contracts/dto/compute';
export type SelectedRecordScope={key:string;connectionId?:string;profileId?:string;profileVersion?:number};
export type RecordServiceObservation={phase:'checking'|'ready'|'unavailable';sourceId?:string;scopeKey?:string;serviceVersion?:'current'|'different'|'unconfirmed'};
export function selectedRecordScope(resource:ComputeResourceState|null|undefined,selectionEpoch:number):SelectedRecordScope|null;
export function matchesSelectedRecordService(status:WorkerStatus,scope:SelectedRecordScope):boolean;
export function readSelectedServiceRecords(options:{scope:SelectedRecordScope;current:()=>boolean;readStatus:()=>Promise<WorkerStatus>;read:(target:string)=>Promise<any[]>;onSource?:(sourceId:string)=>void}):Promise<{phase:'unavailable';sourceChanged?:boolean}|{phase:'ready';sourceId:string;serviceVersion:'current'|'different'|'unconfirmed';records:PromiseSettledResult<any[]>[]}|null>;
