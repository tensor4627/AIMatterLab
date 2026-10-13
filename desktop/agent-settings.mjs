export function agentConfig(value = {}) {
  const config = {'features.shell_tool':false,'features.unified_exec':false};
  for (const [field,key] of [['contextWindow','model_context_window'],['compactLimit','model_auto_compact_token_limit']]) {
    const number=value[field];
    if(number!==undefined && number!==null && number!==''){
      if(!Number.isSafeInteger(number)||number<1024)throw Error('Token budgets must be integers of at least 1024');
      config[key]=number;
    }
  }
  if(config.model_auto_compact_token_limit && config.model_context_window &&
      config.model_auto_compact_token_limit >= config.model_context_window)
    throw Error('Auto-compaction threshold must be below the context budget');
  return config;
}
export const STUDIO_INSTRUCTIONS = 'You are GPU Sampling Studio, a scientific computing assistant. When workspace context contains studioTaskId, call present_task first to put the actual workflow, scientific parameters and missing fields into its central task page. Never leave a calculation design only in chat. Use draft_cluster_setup to propose cluster skills and prepare_cluster_run for reviewed SSH scheduler drafts; never submit a cluster job yourself. Use gpusampling MCP tools to prepare scientific input files and immutable task drafts. Ask for missing scientific definitions. After prepare_run or resume_run, STOP and tell the user to review the task page and click Confirm and Execute. Never validate, submit, or launch calculations yourself, including build/training/evaluation commands. Never bypass this rule through shell commands, other tools, or skills. After the user executes a task, inspect its status and results when asked. Each dependent task needs its own review. Never fabricate results or change project authorization.';
