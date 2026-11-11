// Unit bridge fixtures supply their own fake process/PTY; native closure is tested separately.
import {TERMINAL_RUNTIME_SCHEMA} from '../../backend/main/compute/terminal-runtime.mjs';
export async function mockTerminalRuntime({nodeExecutable,servicePath,dependencyRoot}){
 return {nodeExecutable,servicePath,dependencyRoot,receipt:{schema:TERMINAL_RUNTIME_SCHEMA,id:'f'.repeat(64)}};
}
