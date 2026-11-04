// Portable declarations only. No programs, files or scientific operations are run.
export const packageVersion='a'.repeat(64);
export const display={priority:90,advanced:false,reason:'Needed to connect the workflow'};
export const port=(id,format='json',required=true)=>({id,type:'file',format,description:id,required,display:{...display},...required?{}:{default:null,default_behavior:'No file is emitted when disabled',default_source:'Tool declaration'}});
export function toolDefinition(){return {
 schema_version:1,id:'data-tool',name:'Inert data transform declaration',repository:{path:'source',commit:'b'.repeat(40)},manual:'manual.md',guidance:{},
 environment:{hardware:'cpu',requirements:['Python as declared by the author'],parallelism:{supported:['serial']}},
 functions:[{id:'transform',name:'Transform',description:'Declared JSON transformation',entrypoint:'source/transform.py',inputs:[port('source')],outputs:[port('result')],parameters:[{id:'count',type:'integer',description:'Iteration count',required:false,default:1,default_behavior:'One iteration',default_source:'Author documented default',display:{...display}}],operation:{command:['{python}','{entrypoint}'],failure_handling:'Record the failure and preserve inputs'},tests:['minimal']}],
 tests:{directory:'data-tool-tests',introduction:'data-tool-tests/README.md',cases:[{id:'minimal',function_id:'transform',directory:'data-tool-tests/transform',instructions:'data-tool-tests/transform/README.md',entrypoint:'source/test.py',resources:['source/fixture.json'],expected_outputs:[{path:'result.json',format:'json',description:'Transformed JSON'}],pass_criteria:['Check the declared transformation']}]}
};}
export function groupDefinition(){return {schema_version:1,id:'data-flow',name:'Two stage data flow',inputs:[port('initial')],steps:[
 {id:'second',tool_id:'data-tool',package_version:packageVersion,function_id:'transform',inputs:{source:{step_id:'first',port_id:'result'}},parameters:{count:2}},
 {id:'first',tool_id:'data-tool',package_version:packageVersion,function_id:'transform',inputs:{source:{input_id:'initial'}}}
],outputs:[{id:'final',step_id:'second',port_id:'result'}]};}
