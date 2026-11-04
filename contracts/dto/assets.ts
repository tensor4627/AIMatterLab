/** Pure cross-process contracts. Runtime and renderer state belong to their owners. */

export interface Artifact {id:string;name:string;path:string;kind:string;sha256:string;size:number;metadata?:Record<string,unknown>}

export interface AssetOption{id:string;name:string;path:string;sha256:string|null;kind:string;hash_status?:string}

export interface CompositionAssetImportResult{taskId:string;cancelled:boolean;asset?:AssetOption;assets?:AssetOption[];receipt?:{kind:'human_native_dialog';sha256:string;size:number}}
