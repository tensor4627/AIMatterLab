/** Exact settings schema shared by the desktop main process and its tests. */
import path from 'node:path';
import {agentConfig} from '../agent/context/agent-settings.mjs';
import {validateScientificConsent} from '../agent/skills/scientific-skills.mjs';
import {providerId} from '../agent/providers/contracts.mjs';

const PROVIDERS = ['codex','kimi','qwen','deepseek','compatible'];
const SOURCE_IDS = ['pygas','pydyn','gpumd','hotpp','torchnep'];
const THEMES = ['dark','light'];

/** Top-level renderer settings keys; anything else is rejected instead of silently persisted. */
export const SETTINGS_KEYS = Object.freeze([
 'autoDiscoverCompute','scientificSkillProviders','pygasSkillProviders','projectAgents',
 'agentLayout','agentProvider','kimiPath','qwenPath','agentProviders',
 'distribution','workerRoot','workerPort','codexPath','cwd','sourceRoots','sourceIds',
 'skillRoots','userCacheDirectory','theme','resourceBadgeMotion','language','fontFamily','fontSize','minimumFontSize','chatFontSize',
 'editorFontSize','terminalFontSize','terminalIdleMinutes','agent'
]);

export function normalizeSettings(current, data = {}) {
 if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Invalid settings update');
 if (!current || typeof current !== 'object' || Array.isArray(current)) throw Error('Invalid current settings');
 const unknown = Object.keys(data).filter(key => !SETTINGS_KEYS.includes(key));
 if (unknown.length) throw Error('Unknown settings: ' + unknown.slice(0, 8).join(', '));
 const next = {...current, ...data};
 if(next.terminalIdleMinutes!==undefined&&(!Number.isInteger(next.terminalIdleMinutes)||next.terminalIdleMinutes<1||next.terminalIdleMinutes>1440))throw Error('Terminal idle timeout must be 1 to 1440 minutes');
 if (next.autoDiscoverCompute !== undefined && typeof next.autoDiscoverCompute !== 'boolean') throw Error('Invalid compute discovery preference');
 if (!/^[\w .-]{1,80}$/.test(next.distribution) || !Number.isInteger(next.workerPort) ||
     next.workerPort < 1024 || next.workerPort > 65535 ||
     !/^~\/|^\//.test(next.workerRoot)) throw new Error('Invalid WSL settings');
 agentConfig(next.agent);
 if (!['right','center'].includes(next.agentLayout || 'right')) throw Error('Unsupported workspace layout');
 providerId(next.agentProvider || 'codex');
 for (const key of ['codexPath','kimiPath','qwenPath'])
  if (next[key] !== undefined && (typeof next[key] !== 'string' || /[\r\n\0]/.test(next[key]))) throw Error('Invalid CLI path');
 if (!['zh-CN','en'].includes(next.language || 'zh-CN')) throw Error('Unsupported language');
 for (const [key,min,max] of [['fontSize',12,24],['minimumFontSize',11,18],['chatFontSize',12,28],['editorFontSize',10,28],['terminalFontSize',10,24]])
  if (next[key] !== undefined && (!Number.isInteger(next[key]) || next[key] < min || next[key] > max)) throw Error('Invalid font size');
 if (next.fontFamily && !['system','sans','serif'].includes(next.fontFamily)) throw Error('Unsupported font');
 if (!Array.isArray(next.pygasSkillProviders || []) || (next.pygasSkillProviders || []).some(p => !PROVIDERS.includes(p))) throw Error('Invalid skill sharing provider scope');
 validateScientificConsent(next.scientificSkillProviders);
 if (next.sourceIds !== undefined && (!Array.isArray(next.sourceIds) || next.sourceIds.some(id => !SOURCE_IDS.includes(id)))) throw Error('Invalid source allowlist');
 if (!Array.isArray(next.sourceRoots || []) || (next.sourceRoots || []).some(v => typeof v !== 'string' || !path.isAbsolute(v))) throw Error('Source roots must be absolute paths');
 if (!Array.isArray(next.skillRoots)) throw new Error('Skill roots must be an array');
 if(next.userCacheDirectory!==undefined&&next.userCacheDirectory!==''){
  const dir=next.userCacheDirectory;
  if(typeof dir!=='string'||dir.length>4096||/[\r\n\0]/.test(dir)||/^[\\/]{2}/.test(dir)||!path.isAbsolute(dir)||
     process.platform==='win32'&&!/^[A-Za-z]:[\\/]/.test(dir)||path.resolve(dir)===path.parse(path.resolve(dir)).root)throw Error('Choose a local absolute skill cache directory');
 }
 if (next.skillRoots.some(v => typeof v !== 'string' || !v.trim() || v.length > 4096 || /[\r\n\0]/.test(v))) throw new Error('Skill roots must be non-empty bounded paths');
 if (next.cwd !== undefined && (typeof next.cwd !== 'string' || !next.cwd.trim() || /[\r\n\0]/.test(next.cwd))) throw new Error('Invalid working directory');
 if (next.projectAgents !== undefined && (!next.projectAgents || typeof next.projectAgents !== 'object' || Array.isArray(next.projectAgents) ||
     Object.entries(next.projectAgents).some(([id,agent]) => typeof id !== 'string' || !id || !PROVIDERS.includes(agent)))) throw new Error('Invalid project agent binding');
 if (next.resourceBadgeMotion !== undefined && !['wave','breathe'].includes(next.resourceBadgeMotion)) throw Error('Invalid resource badge motion');
 if (next.theme !== undefined && !THEMES.includes(next.theme)) throw Error('Unsupported theme');
 return next;
}
