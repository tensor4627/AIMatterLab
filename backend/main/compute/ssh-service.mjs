// Version 2 resource model: a service belongs to an authenticated SSH connection,
// never to the visible shell's PTY, ownership epoch or lifecycle.
export {createSshService,normalizeSshServiceHealth} from './ssh-connection-service.mjs';
