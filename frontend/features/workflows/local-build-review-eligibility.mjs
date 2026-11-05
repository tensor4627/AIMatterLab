import {consumer,localReviewUnsupportedCode} from "../../../contracts/workflows/local-review-eligibility.mjs";
/** Presentation only. Main remains authoritative for source-matched review. */
const messages={
 LOCAL_REVIEW_UNSUPPORTED_OPES:'当前 OPES 输入尚不支持本地人工复核。原参数与资产保持不变；可使用下方 AI 复核。',
 LOCAL_REVIEW_UNSUPPORTED_CONSUMER_CONTRACT:'当前选择的 manifest 或 kernel 契约尚不支持本地人工复核；所选输入保持不变，可使用下方 AI 复核。',
 LOCAL_REVIEW_PARAMETER_CONFLICT:'当前模式或消费契约存在相互冲突的别名值；请核对原输入，不会自动选取或改写。',
 LOCAL_REVIEW_UNSUPPORTED_CONSUMER_MODE:'请先核对当前消费模式；此模式尚不能进行本地人工输入复核。',
 LOCAL_REVIEW_CONSUMER_PAIR_REQUIRED:'本地人工复核需要同一流程已保存的 Metad 组合图和对应当前构建产物；请先核对来源。'
};

export function localBuildReviewEligibility(engine,savedMode,parameters){
 const code=localReviewUnsupportedCode(engine,parameters,savedMode);
 if(code)return {allowed:false,reason:messages[code]};
 if(engine==='pygas.build')return savedMode==='metad'||savedMode==='cvonly'?{allowed:true,reason:null}:{allowed:false,reason:'请先读取已保存组合图的模式，再进行本地人工输入复核。'};
 if(consumer(engine)){
  if(savedMode!=='metad')return {allowed:false,reason:messages.LOCAL_REVIEW_CONSUMER_PAIR_REQUIRED};
 }
 return {allowed:true,reason:null};
}

/** Map only bounded known diagnostics, including Electron's exact invocation envelope. */
export function localReviewErrorMessage(error){
 const raw=error instanceof Error?error.message:String(error);
 const wrapped=/^Error invoking remote method ['"]studio:task\.localReview\.(?:inspect|read|confirm)['"]: Error: ([^\r\n]+)$/.exec(raw),key=wrapped?wrapped[1]:raw;
 if(Object.hasOwn(messages,key))return messages[key];
 if(key==='Save and complete the actual current canonical pair')return messages.LOCAL_REVIEW_CONSUMER_PAIR_REQUIRED;
 return raw;
}
