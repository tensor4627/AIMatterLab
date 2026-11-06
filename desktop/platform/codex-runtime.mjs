import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {prepareIsolation,overrideArgs,constrainedRequest,verifyIsolation,assertInstructionSources} from "./codex-isolation.mjs";
import {STUDIO_VERSION} from "./studio-version.mjs";
import {resolveCodexExecutable} from './codex-executable.mjs';
/** Main-owned native launch and isolation capabilities; never reads credentials here. */
export const codexRuntime=Object.freeze({resolveExecutable:resolveCodexExecutable,execute:promisify(execFile),spawnProcess:spawn,prepareIsolation,overrideArgs,constrainedRequest,verifyIsolation,assertInstructionSources,version:STUDIO_VERSION});
