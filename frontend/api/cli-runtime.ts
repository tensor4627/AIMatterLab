import {invoke} from './studio';
import type {CliProvider,CliReadiness,CliInstallRequest} from '../../contracts/dto/cli-runtime';

export const cliRuntime={
 inspect:(provider:CliProvider)=>invoke<CliReadiness>('agent.cli.inspect',{provider}),
 choose:(provider:CliProvider)=>invoke<CliReadiness|null>('agent.cli.choose',{provider}),
 install:(request:CliInstallRequest)=>invoke<CliReadiness>('agent.cli.install',request),
 cancel:(request:CliInstallRequest)=>invoke<{cancelled:boolean}>('agent.cli.cancel',request),
};
