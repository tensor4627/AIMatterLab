const compact=value=>String(value||'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim();

const limit=value=>Array.from(compact(value)).slice(0,36).join('');

export function conversationTitle(request,{name,engine,existing=false}={}){
 const text=compact(request),proposed=compact(name);
 if(proposed&&(existing||proposed!==text)&&Array.from(proposed).length<=36&&!/^(请|帮我|我想|我希望|please\b|can you\b)/i.test(proposed))return proposed;
 const basis=[engine||'',text].join(' '),parts=[];
 const system=basis.match(/\b(?:[A-Z][a-z]?\d*){1,8}\b/gu)?.find(s=>!['MD','NEB','CV','API','GPU','NVT','NPT','WTMetaD','MetaD','DFT','JSON','SSH','CVs','I'].includes(s));
 if(system)parts.push(system);
 for(const [regex,label]of [[/WTMetaD|well.tempered|良温/i,'WTMetaD'],[/metad|元动力|增强采样/i,'增强采样'],[/\bNEB\b|能垒|过渡态/i,'NEB 路径'],[/pydyn/i,'PyDyn'],[/gpumd|gpu.sampling/i,'GPUMD'],[/hotpp/i,'HotPP'],[/torchnep/i,'TorchNEP'],[/\bNEP\b|nep\.(train|eval)/i,'NEP'],[/训练|train/i,'训练'],[/测试|评估|evaluate|\beval\b/i,'评估'],[/分子动力学|molecular dynamics|\.md\b|\bMD\b/i,'分子动力学'],[/CV|集体变量|\bbias\b/i,'CV / Bias'],[/结构|晶体|structure|crystal/i,'结构构建'],[/自由能|\bFES\b|重加权/i,'自由能分析'],[/集群|队列|\bSSH\b|cluster/i,'集群任务'],[/环境|安装|install/i,'环境配置'],[/报错|错误|bug|error|排查/i,'问题排查']])if(regex.test(basis)&&!parts.includes(label))parts.push(label);
 return limit(parts.slice(0,3).join(' · ')||(/你好|hello|hi\b/i.test(text)?'日常交流':/翻译|translate/i.test(text)?'翻译讨论':/解释|原理|why|explain/i.test(text)?'原理讨论':'任务讨论'));
}

export function validConversationName(value){if(typeof value!=='string'||!value.trim()||Array.from(value.trim()).length>60||/[\r\n\0]/.test(value))throw Error('会话名称需为 1–60 个字符的单行文字');return value.trim();}
