import path from 'node:path';

/** Executable copies must not inherit the profile's Windows Low integrity label. */
export function terminalExecutionCache({platform=process.platform,localAppData=process.env.LOCALAPPDATA,home,profileRoot}={}){
 if(typeof profileRoot!=='string'||!profileRoot)throw Error('terminal_runtime_invalid_root');
 if(platform!=='win32')return path.join(profileRoot,'shared-terminal','runtime');
 const base=localAppData||(typeof home==='string'&&home?path.win32.join(home,'AppData','Local'):null);
 if(typeof base!=='string'||! /^[A-Za-z]:[\\/]/.test(base)||/[\0\r\n]/.test(base))throw Error('terminal_runtime_invalid_root');
 const directory=path.win32.resolve(base,'GPU Sampling Studio','terminal-runtime'),profile=path.win32.resolve(profileRoot);
 if(directory.toLowerCase()===profile.toLowerCase()||directory.toLowerCase().startsWith(profile.toLowerCase()+'\\'))throw Error('terminal_runtime_invalid_root');
 return directory;
}
