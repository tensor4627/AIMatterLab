/** Saved facts only: neither import success nor settled choice grants scientific review. */
export function workspacePresentation(task) {
 const choice=task?.workspaceChoice,authoring=task?.authoring;
 const settled=(choice==='draft'||choice==='workspace'&&!!task.workspace?.id)&&authoring?.workspacePending===false&&typeof authoring.inputRoot==='string'&&!!authoring.inputRoot;
 const imports=Array.isArray(authoring?.imports)?authoring.imports:[];
 const passed=imports.filter(value=>value?.status==='passed'&&typeof value.path==='string'&&value.path&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256));
 return {settled,label:settled?(choice==='draft'?'已选择：草稿目录':'已选择：工作区'):choice==='pending'?'工作区尚未选择':'工作区选择尚未确认',imported:passed.length,pending:Array.isArray(authoring?.pendingInputs)?authoring.pendingInputs.length:0};
}
