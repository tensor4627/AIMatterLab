import {parameterValue} from "../../../contracts/workflows/task-fields.mjs";
const normalized=value=>typeof value==='string'?value.trim().replace(/\s+/g,' ').toLowerCase():'';


// Search only this step's controlled file values, never global inputs or file contents.
export function stepMatchesQuery(step,parameters,query){
 const needle=normalized(query);if(!needle)return true;
 const names=step.fields.flatMap(field=>{
  const value=field.type==='file'||field.type==='files'?parameterValue(parameters,field.key):null;
  const paths=field.type==='file'?[value]:field.type==='files'&&Array.isArray(value)?value:[];
  return paths.filter(path=>typeof path==='string').map(path=>path.trim().split(/[\\/]/).at(-1));
 });
 return normalized([step.title,step.tool,...step.fields.flatMap(field=>[field.label,field.key]),...names].join(' ')).includes(needle);
}
