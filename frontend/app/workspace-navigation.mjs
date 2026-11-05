export function workspaceModule(section,engine=''){
 if(section.startsWith('tool:'))return section.slice(5);
 if(section.startsWith('task:'))return engine==='gpumd.neb'?'neb':engine.startsWith('pydyn.')||engine.startsWith('gpumd.')?'md':engine.startsWith('hotpp.')||engine.startsWith('nep.')?'training':engine.startsWith('pygas.')||engine==='bias.validate'?'pygas':'queue';
 if(section.startsWith('agent-task:')||section.startsWith('workflow:')||section.startsWith('plan:'))return 'workflow';
 if(section==='editor')return 'code';if(section==='ssh'||section==='environments')return 'resources';if(section==='runs'||section.startsWith('cluster-run:')||section.startsWith('deployment'))return 'queue';
 return section==='home'?'home':section==='skills'?'skills':section==='relations'?'workflow':section;
}
