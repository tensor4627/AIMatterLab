import test from 'node:test';import assert from 'node:assert/strict';import {partitionFields} from "../../frontend/ui/task-fields.mjs";
import {validField,fieldMissing,workflowMissing} from "../../contracts/workflows/task-fields.mjs";

test('Required science precedes optional details, with typed traceable defaults',()=>{
 const fields=[{key:'metad.seed',label:'Seed',type:'integer',required:false,advanced:true,default:0,default_source:'registered engine config'},{key:'metad.height',label:'Height',type:'number',required:true},{key:'metad.cv_definition',label:'CV',type:'text',required:true},{key:'metad.sigma',label:'Sigma',type:'number',required:true}];
 fields.forEach(validField);const groups=partitionFields(fields);assert.deepEqual(groups.primary.map(f=>f.key),['metad.cv_definition','metad.sigma','metad.height']);assert.equal(groups.advanced[0].key,'metad.seed');assert.equal(fieldMissing({...fields[0],required:true},{}),true);assert.throws(()=>validField({...fields[0],default_source:''}));assert.throws(()=>validField({...fields[0],default:1.5}));assert.throws(()=>validField({...fields[0],advanced:'yes'}));assert.throws(()=>validField({...fields[0],default:Infinity}));
 const p={metad:{cv_definition:'known',sigma:.1,height:.01}};assert.deepEqual(workflowMissing([{id:'m',title:'MetaD',fields}],p,[]),[]);assert.equal(p.metad.seed,undefined);
});

test('Required scientific lists reject nested empty values and non-finite numbers while false/zero remain supplied',()=>{
 const field={key:'values',label:'Values',type:'list',required:true};
 for(const values of [[[1,null,3]],[[1,undefined,3]],[[1,'',3]],[[1,NaN,3]],[[1,Infinity,3]],[[]],[]])assert.equal(fieldMissing(field,{values}),true);
 const valid=[[0,1,2],[false,true,false],{label:null}];assert.equal(fieldMissing(field,{values:valid}),false);assert.equal(valid[0][0],0);assert.equal(valid[1][0],false);assert.equal(Array.isArray(valid[0]),true);assert.equal(fieldMissing({...field,required:false},{values:[]}),false);
 const steps=[{id:'inputs',title:'Inputs',fields:[field]}];assert.deepEqual(workflowMissing(steps,{values:[[1,null,3]]},[]),['values']);assert.deepEqual(workflowMissing(steps,{values:[[1,0,3],false]},[]),[]);
});
