import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict';
const schema=JSON.parse(fs.readFileSync(new URL('../desktop/custom-cv-tool-schema.json',import.meta.url),'utf8'));
test('proposal schema exposes only formula data and exact worker parameter vocabulary',()=>{
 assert.deepEqual(Object.keys(schema.properties).sort(),['library_review','spec','values']);assert.equal(schema.additionalProperties,false);const spec=schema.properties.spec;assert.equal(spec.additionalProperties,false);assert.equal(spec.properties.symbols.type,'array');assert.equal(spec.properties.symbols.items.additionalProperties,false);assert.deepEqual(spec.properties.pbc.enum,['none','row_mic']);assert.deepEqual(spec.properties.parameters.items.properties.type.enum,['number','integer','number_vector','integer_vector','number_matrix']);assert.equal(spec.properties.parameters.items.additionalProperties,false);assert.equal(spec.properties.parameters.items.properties.exclusive_minimum,undefined);assert.equal(spec.properties.parameters.items.properties.min.type,'number');
 for(const forbidden of ['id','expected','provider','approved','code','execute','share'])assert.equal(schema.properties[forbidden],undefined);
});
test('only the fixed data-draft tool is auto-approved, never custom approval or execution',()=>{
 const source=fs.readFileSync(new URL('../desktop/codex.mjs',import.meta.url),'utf8'),list=source.match(/for\(const tool of (\[[^\n]+\])/)[1];assert(list.includes("'propose_custom_cv'"));
 for(const forbidden of ['approve_formula','approve_code','customCv.validate','customCv.sharing','submit_run','validate_run'])assert(!list.includes("'"+forbidden+"'"));
 const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');assert(main.includes('custom-cv-tool-schema.json'));assert(main.includes('annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}'));
});
