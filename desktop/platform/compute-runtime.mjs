/** Native process capabilities only; connection, job and provider policy belongs to domain owners. */
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
export const computeRuntime=Object.freeze({execute:promisify(execFile),spawnProcess:spawn,terminalServicePath:fileURLToPath(new URL('./terminal-service/broker.mjs',import.meta.url))});
