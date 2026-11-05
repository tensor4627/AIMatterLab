export function pixelFontSize(base,minimum=12,scale=1){const finite=(v,f)=>typeof v==='number'&&Number.isFinite(v)&&v>0?v:f;return Math.max(finite(base,13)*finite(scale,1),finite(minimum,12));}
