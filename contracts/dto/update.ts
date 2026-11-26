export type UpdateSource = 'nju'|'github';
export type UpdateAccess = Record<UpdateSource,boolean>;
export interface UpdateState {
  phase: 'disabled'|'idle'|'checking'|'unpublished'|'current'|'available'|'downloading'|'verifying'|'ready'|'preparing'|'installing'|'error';
  currentVersion: string;
  sequence: number;
  version?: string;
  mode?: 'app'|'delta'|'full';
  bytes?: number;
  received?: number;
  assembled?: number;
  fullBytes?: number;
  source?: UpdateSource;
  step?: 'cache'|'manifest'|'blocks';
  issues?: {source:UpdateSource;status:number;webPage?:boolean}[];
  automatic?: boolean;
  reason?: 'app'|'base'|'map'|'delta'|'retry';
  detail?: string;
}
