"""Private CV adapter: approved private primitives extend the real pyGAS catalog.
No source import, scientific execution, approval, filesystem writes or provider grant.
"""
import copy,hashlib
from studio_worker.tools.custom_formula import module_source,parameter_values,sha,expression_type


def checked_entry(item):
 spec=item['spec'];values,missing=parameter_values(spec,item['parameter_values'],complete=False)
 if missing:raise ValueError('Complete the confirmed formula values before attaching a private primitive')
 expression_type(spec,values)
 generated=module_source(spec)
 if generated['code_sha256']!=item.get('code_sha256')or generated['source']!=item.get('code'):raise ValueError('Approved private implementation differs from its deterministic source')
 if item.get('formula_approval',{}).get('spec_sha256')!=sha(spec)or item.get('code_approval',{}).get('code_sha256')!=generated['code_sha256']:raise ValueError('Human formula and code approvals are required')
 numerical=item.get('numerical',{})
 if numerical.get('status')!='passed'or numerical.get('reusable_primitive',{}).get('status')!='passed':raise ValueError('A current passed reusable primitive report is required, not merely nested successful checks')
 for key in ('spec_sha256','code_sha256','parameters_sha256'):
  if numerical.get(key)!=item.get(key):raise ValueError('Numerical check targets a different private primitive revision')
 if numerical.get('numerical_self_consistency',{}).get('status')!='passed'or numerical.get('independent_reference',{}).get('status')!='passed':raise ValueError('Saved primitive self-consistency plus independently justified reference is required before reuse')
 relative='studio_custom_'+generated['code_sha256']+'.py';source={'name':relative,'line':1,'sha256':generated['code_sha256']}
 params=[]
 for p in spec['parameters']:
  kind=p['type'];vector=kind.endswith('vector')or kind.endswith('matrix');editor={'number':'number','integer':'integer','number_vector':'number_vector','integer_vector':'integer_vector','number_matrix':'number_matrix'}[kind]
  hint={'editor':editor,'unit':p['units'],'description':p['description'],'provenance':{'kind':'Approved private formula adapter','sha256':source['sha256'],'source':relative}}
  if vector:hint.update(serializer='tensor',tensor_dtype='torch.long'if kind=='integer_vector'else'torch.float64')
  params.append({'name':p['name'],'required':p['required'],'default':repr(p['default'])if not p['required']else'','default_is_literal':not p['required'],'default_value':p.get('default')if not p['required']else None,'type_hint':'tensor'if vector else'int'if kind=='integer'else'float','annotation':kind,'is_module_param':False,'editor_hint':hint})
 entry={'kind':'cv','name':generated['class_name'],'params':params,'forward_args':['pos','cell','side_array'],'from_dict_sections':[],'requires_switch':False,'supports_pipeline':True,'unknown_forward_args':[],'documentation':spec['formula'],'source':source,'output_size':spec['output_size'],'semantics':{'source':relative,'sha256':source['sha256'],'output_rank':1,'graph_support':'supported','reason':'Private approved fixed-size primitive; whole pyGAS bias and target validation remain mandatory'},'validation':'primitive_reference_only','private':True}
 binding={'id':item['id'],'spec_sha256':item['spec_sha256'],'code_sha256':item['code_sha256'],'parameters_sha256':item['parameters_sha256'],'revision':item['revision'],'reference_structure_sha256':numerical['structure_sha256'],'numerical_receipt_sha256':sha(numerical),'module_name':relative[:-3],'module_file':relative,'class_name':entry['name'],'output_size':spec['output_size']}
 return {'entry':entry,'binding':binding,'source':generated['source'],'parameter_values':values}


def extend(receipt,approved):
 result=copy.deepcopy(receipt)
 for item in approved:
  entry=item['entry'];name=entry['name'];relative=entry['source']['name']
  if any(existing['name']==name for existing in result['catalog']['cv']):raise ValueError('Duplicate private primitive class identity')
  result['catalog']['cv'].append(copy.deepcopy(entry));result['source']['files'][relative]=entry['source']['sha256']
  result['ports']['classes']['cv.'+name]={'inputs':{name:name for name in('pos','cell','side_array')},'outputs':{'value':'value'}}
 result['custom_cv_bindings']=[copy.deepcopy(item['binding'])for item in approved]
 return result


def check_graph_values(graph,approved):
 by_class={item['entry']['name']:item for item in approved}
 for node in graph.get('nodes',[]):
  item=by_class.get(node.get('class_name'))
  if not item:continue
  if node.get('params',{})!=item['parameter_values']or node.get('parameter_dtypes'):
   raise ValueError('Private formula values changed: edit typed formula parameters and rerun its numerical/reference checks, then attach the updated revision')


def import_line(approved):
 # All identifiers derive from validated 64hex identities and deterministic class names.
 return ''.join('from '+item['binding']['module_name']+' import '+item['entry']['name']+'\n'for item in approved)
