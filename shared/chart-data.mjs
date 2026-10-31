// Raw table preview only: no units, clocks, interpolation or scientific transforms.
const numeric=token=>/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)&&Number.isFinite(Number(token))?Number(token):null;
function tokens(line){
 if(!line.includes(','))return line.trim().split(/\s+/);
 const result=[];let value='',quoted=false,closed=false;
 for(let i=0;i<line.length;i++){const c=line[i];if(quoted){if(c==='"'){if(line[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=c;}
  else if(c===','){result.push(value.trim());value='';closed=false;}
  else if(c==='"'){if(value.trim()||closed)return null;quoted=true;}
  else if(closed&&!/\s/.test(c))return null;else value+=c;
 }
 if(quoted)return null;result.push(value.trim());return result;
}
export function parseChartData(text,name){
 const basename=name.replaceAll('\\','/').split('/').at(-1),neb=basename==='neb_energies.out',structure=/\.(?:xyz|extxyz|cif|pdb|vasp)$/i.test(basename)||/^(?:POSCAR|CONTCAR)$/i.test(basename);
 const empty={rows:[],series:[],xColumn:null,xLabel:null,ignoredColumns:[],cutLines:false,cutColumns:false,skippedRows:0,missingValues:0,hasData:false,neb,structure};
 if(structure)return empty;
 const entries=[];let commentHeader=null;
 for(const [index,line]of text.split(/\r?\n/).entries()){const trimmed=line.trim();if(!trimmed)continue;if(trimmed.startsWith('#')){const fields=tokens(trimmed.slice(1));if(!entries.length&&fields?.every(v=>v&&numeric(v)===null))commentHeader=fields;continue;}entries.push({fields:tokens(trimmed),sourceLine:index+1});}
 const limited=entries.slice(0,4000),first=limited[0]?.fields;
 let header=null,start=0;
 if(!neb&&first?.some(v=>v)&&first.every(v=>numeric(v)===null&&!/^[+-]?(?:nan|inf(?:inity)?)$/i.test(v))&&limited.slice(1).some(row=>row.fields?.length===first.length&&row.fields.some(v=>numeric(v)!==null))){header=first;start=1;}
 const candidate=limited.slice(start),firstData=candidate.find(row=>row.fields?.some(v=>numeric(v)!==null));
 const width=firstData?.fields?.length||0;
 if(!width||neb&&width!==1)return {...empty,cutLines:entries.length>4000};
 if(header?.length!==width)header=commentHeader?.length===width?commentHeader:null;
 const rows=[];let skippedRows=0;
 for(const [rowIndex,row]of candidate.entries()){if(!row.fields||row.fields.length!==width){skippedRows++;continue;}rows.push({rowIndex,sourceLine:row.sourceLine,values:row.fields.map(numeric)});}
 const label=index=>header?.[index]||'column '+index;
 const columns=Array.from({length:width},(_,index)=>index).filter(index=>rows.some(row=>row.values[index]!==null));
 const ignoredColumns=Array.from({length:width},(_,index)=>index).filter(index=>!columns.includes(index)).map(index=>({index,name:label(index)}));
 const xColumn=neb||columns.length<2?null:columns[0],seriesColumns=xColumn===null?columns:columns.slice(1);
 let missingValues=0;
 const series=seriesColumns.slice(0,6).map(column=>({column,name:label(column),points:rows.flatMap(row=>{const x=xColumn===null?row.rowIndex:row.values[xColumn],y=row.values[column];if(x===null){missingValues++;return [{x:null,y:null,rowIndex:row.rowIndex,sourceLine:row.sourceLine}];}if(y===null)missingValues++;return [{x,y,rowIndex:row.rowIndex,sourceLine:row.sourceLine}];})}));
 return {rows,series,xColumn,xLabel:xColumn===null?null:label(xColumn),ignoredColumns,cutLines:entries.length>4000,cutColumns:seriesColumns.length>6,skippedRows,missingValues,hasData:series.some(s=>s.points.some(p=>p.x!==null&&p.y!==null)),neb,structure};
}
