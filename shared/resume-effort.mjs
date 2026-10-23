// Prefer this provider's explicit per-turn choice when the resumed model supports it.
export function resumedEffort({provider,preferences={},model,serverEffort}){
 const supported=new Set((Array.isArray(model?.supportedReasoningEfforts)?model.supportedReasoningEfforts:[]).map(value=>value?.reasoningEffort).filter(value=>typeof value==='string'));
 return [preferences[provider],serverEffort,model?.defaultReasoningEffort].find(value=>typeof value==='string'&&supported.has(value))||'';
}
