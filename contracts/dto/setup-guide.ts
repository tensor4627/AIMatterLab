export type SetupPage = 'welcome' | 'agent' | 'compute' | 'ready';
export type SetupProgress = SetupPage | 'complete';

export interface SetupGuideInfo {
  page: SetupProgress;
  directory: string;
  directoryKind: 'workspace' | 'profile';
}

export interface SetupProgressRequest { page: SetupProgress }
