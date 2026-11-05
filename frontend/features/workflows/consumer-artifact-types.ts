export interface ConsumerArtifactOption {selectionId:string;runId:string;name:string;size:number;sha256:string;status:'current-collected-observation-not-ABI';}
export interface ConsumerArtifactList {taskId:string;parameterRevision:number;options:ConsumerArtifactOption[];unavailable:{runId:string;reason:string}[];scope:string;}
export interface ConsumerArtifactAdoption {taskId:string;status:'copied_not_validated';scienceStageUnchanged:true;asset:{id:string;name:string;path:string;sha256:string;size:number;kind:'input'};}
export interface ConsumerArtifactApi {list(value:{taskId:string}):Promise<ConsumerArtifactList>;adopt(value:{taskId:string;selectionId:string}):Promise<ConsumerArtifactAdoption>;}
