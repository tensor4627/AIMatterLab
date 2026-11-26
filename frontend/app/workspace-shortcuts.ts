export const workspaceShortcuts = {
 search: {key:'k', label:'搜索与命令'},
 conversation: {key:'n', label:'新对话'},
 sidebar: {key:'b', label:'切换会话侧栏'},
 bottom: {key:'j', label:'切换底部任务与终端面板'},
 settings: {key:',', label:'设置'},
 help: {key:'/', label:'键盘快捷键'},
} as const;

export type WorkspaceShortcut = keyof typeof workspaceShortcuts;

export function shortcutLabel(id:WorkspaceShortcut) {
 return `Ctrl+${workspaceShortcuts[id].key.toUpperCase()}`;
}

export function workspaceShortcut(event:KeyboardEvent):WorkspaceShortcut|undefined {
 if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || event.shiftKey ||
    !(event.ctrlKey || event.metaKey)) return;
 const key = event.key.toLowerCase();
 const entry = (Object.keys(workspaceShortcuts) as WorkspaceShortcut[]).find(id => workspaceShortcuts[id].key===key);
 if (entry==='search') return entry;
 const editable = event.target instanceof Element &&
  event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],.monaco-editor,.xterm');
 if (!editable) return entry;
}
