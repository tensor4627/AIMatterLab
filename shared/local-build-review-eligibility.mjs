/** Presentation only. Main remains authoritative for source-matched review. */
export function localBuildReviewEligibility(engine, savedMode) {
 if(engine!=='pygas.build')return {allowed:true,reason:null};
 if(savedMode==='metad'||savedMode==='cvonly')return {allowed:true,reason:null};
 return {allowed:false,reason:savedMode==='opes'?'OPES 尚不支持本地人工输入复核；请使用 AI 复核。':'请先读取已保存组合图的模式，再进行本地人工输入复核。'};
}
