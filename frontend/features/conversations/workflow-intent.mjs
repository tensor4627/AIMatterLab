export function explicitNewWorkflow(text){
 if(typeof text!=='string')return false;
 // Quoted examples are content, not instructions. Contractions remain intact.
 const plain=text.replace(/```[\s\S]*?```|`[^`\n]*`|"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|「[^」\n]*」|(?<![\p{L}\p{N}])'[^'\n]*'(?![\p{L}\p{N}])/gu,' ');
 const actions=/(?:新建|另建|创建)(?:一个|一份|新的)?(?:新的)?(?:计算)?(?:工作流|流程)|(?:create|start)\s+(?:a\s+)?(?:(?:new|another)\s+){1,2}workflow/gi;
 for(const match of plain.matchAll(actions)){
  const prefix=plain.slice(0,match.index).split(/[，,。.;；!?！？\n]|但是|不过|然后|\b(?:but|however|then)\b/i).at(-1)||'';
  if(/不|别|勿|无需|无须|禁止|没有|没必要|停止|避免|取消|撤销|暂停|\b(?:not|never|without|avoid|no|stop|cancel|don['’]?t|cannot|can['’]?t|isn['’]?t|wasn['’]?t|didn['’]?t|wouldn['’]?t)\b/i.test(prefix))continue;
  if(/解释|举例|说明|含义|意思|如何|怎么|是否|讨论|提到|字符串|文本|命令|按钮|复述|引用|回复|翻译|之前|此前|原先|曾经|已经|上次|\b(?:explain|describe|example|quote|repeat|translate|meaning|phrase|button|command|text|how|whether|what)\b/i.test(prefix))continue;
  const suffix=plain.slice(match.index+match[0].length).split(/[，,。.;；!?！？\n]|但是|不过|然后|\b(?:but|however|then)\b/i)[0];
  if(/^\s*(?:(?:这个|按钮|功能|操作|选项)?(?:是(?:什么|啥|何)|指(?:的)?是)|的(?:含义|意思|作用)|意味着)/.test(suffix)||/^\s*(?:mean|means|meaning|definition)\b/i.test(suffix))continue;
  return true;
 }
 return false;
}
