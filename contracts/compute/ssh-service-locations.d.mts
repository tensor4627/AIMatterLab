export type SshLocations={schemaVersion:1;scope:'remote-observed';loginDirectory:string;observedAt:number;workspaces:{path:string;source:'worker-project';projectId:string;status:'observed'|'previously-observed';lastSeenAt:number}[];skills:{path:string;source:'worker-cluster-skill';status:'observed'|'previously-observed';lastSeenAt:number}[]};
export function checkedSshLocations(value:unknown):SshLocations;

export function mergeSshLocations(previous:SshLocations|undefined,current:SshLocations|undefined):SshLocations|undefined;
