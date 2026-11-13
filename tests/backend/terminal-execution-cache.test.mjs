import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {terminalExecutionCache} from '../../desktop/platform/terminal-execution-cache.mjs';

test('Windows execution cache stays outside an existing Low-integrity profile and preserves its location',()=>{
 const profile='D:\\project\\.config';
 assert.equal(terminalExecutionCache({platform:'win32',profileRoot:profile,localAppData:'C:\\Users\\Fixture\\AppData\\Local'}),'C:\\Users\\Fixture\\AppData\\Local\\GPU Sampling Studio\\terminal-runtime');
 assert.equal(profile,'D:\\project\\.config');
 assert.equal(terminalExecutionCache({platform:'linux',profileRoot:'/fixture/profile'}),path.join('/fixture/profile','shared-terminal','runtime'));
});
test('missing Windows local cache uses explicit home and refuses unsafe or profile-contained locations',()=>{
 assert.equal(terminalExecutionCache({platform:'win32',profileRoot:'D:\\profile',localAppData:'',home:'C:\\Users\\Fixture'}),'C:\\Users\\Fixture\\AppData\\Local\\GPU Sampling Studio\\terminal-runtime');
 for(const localAppData of ['relative','\\\\network\\share','D:\\profile','D:\\profile\\nested','C:\\bad\npath'])assert.throws(()=>terminalExecutionCache({platform:'win32',profileRoot:'D:\\profile',localAppData}),/invalid_root/);
});
