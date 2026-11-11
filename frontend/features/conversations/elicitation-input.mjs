const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);

/** Only a proven zero-control form is a confirmation without editable content. */
export function elicitationHasEditableInput(params){
 if(!object(params)||![undefined,'form','openai/form','openaiForm'].includes(params.mode))return true;
 const schema=params.requestedSchema;
 if(!object(schema)||schema.type!=='object'||!object(schema.properties)||Object.keys(schema.properties).length)return true;
 if(schema.required!==undefined&&(!Array.isArray(schema.required)||schema.required.length))return true;
 if(schema.additionalProperties!==undefined&&schema.additionalProperties!==false)return true;
 // OpenAI form extensions carry general JSON Schema rather than the narrow MCP
 // form contract. There, omitted additionalProperties still permits user input.
 if(['openai/form','openaiForm'].includes(params.mode)&&schema.additionalProperties!==false)return true;
 const known=new Set(['type','properties','required','additionalProperties','$schema','title','description']);
 if(Object.keys(schema).some(key=>!known.has(key)))return true;
 if(['$schema','title','description'].some(key=>schema[key]!==undefined&&typeof schema[key]!=='string'))return true;
 return false;
}
