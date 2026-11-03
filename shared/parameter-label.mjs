// Manual-edit metadata identifies a field, not the age/version of its prose.
export function parameterDisplayLabel(field,manualEdits){
 return manualEdits&&Object.hasOwn(manualEdits,field.key)?field.key:field.label;
}
