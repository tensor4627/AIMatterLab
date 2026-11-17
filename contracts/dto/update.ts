export interface UpdateState {
  phase: 'disabled'|'idle'|'checking'|'unpublished'|'current'|'available'|'downloading'|'verifying'|'ready'|'preparing'|'installing'|'error';
  currentVersion: string;
  sequence: number;
  version?: string;
  mode?: 'delta'|'full';
  bytes?: number;
  received?: number;
  fullBytes?: number;
  reason?: 'base'|'map'|'delta'|'retry';
  detail?: string;
}
