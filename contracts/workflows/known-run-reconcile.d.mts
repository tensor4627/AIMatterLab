export type KnownRunReconcile={request:{taskId:string;runId:string;kind:'run'|'cluster-run';expectedPrepared?:{artifactId:string;parameterRevision:number;deploymentRevision:number}};uncertain:boolean};

export function knownRunReconcile(task:any):KnownRunReconcile|null;

export function knownRunReconcileScope(task:any,worker:boolean):string;
