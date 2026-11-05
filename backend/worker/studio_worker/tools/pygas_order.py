"""Independently verify a pure CV permutation against the old saved graph."""
import copy,json

def stable(value):return json.dumps(value,sort_keys=True,allow_nan=False,separators=(',',':'))
def validate_order_change(old,new,receipt):
 if not old or old.get('parameter_format')!='structured-v1' or new.get('parameter_format')!='structured-v1':return
 collectors=[node['id'] for node in old.get('nodes',[]) if node.get('kind')=='collect']
 if len(collectors)!=1:return
 collector=collectors[0]
 def incoming(graph):return [edge for edge in graph.get('edges',[]) if edge.get('target')=={'node':collector,'port':'value'}]
 before,after=incoming(old),incoming(new)
 key=lambda edge:(edge['source']['node'],edge['source']['port'])
 if [key(e) for e in before]==[key(e) for e in after]:return
 # Insertions, replacements or other scientific edits are complete new definitions;
 # all review/build evidence is invalidated by the caller. This rule only certifies a pure permutation.
 if len(before)!=len(after) or set(map(key,before))!=set(map(key,after)):return
 if len(set(map(key,before)))!=len(before):raise ValueError('Duplicate collected CV components cannot be reordered')
 if old.get('mode')=='opes':raise ValueError('OPES dimension-order contract is not declared; explicit new definition review required')
 old_nodes={n['id']:n for n in old['nodes']};new_nodes={n['id']:n for n in new['nodes']}
 if set(old_nodes)!=set(new_nodes):return
 base_old=copy.deepcopy(old);base_new=copy.deepcopy(new)
 for graph in (base_old,base_new):
  graph.pop('edges',None)
  for node in graph['nodes']:
   if node.get('kind')=='bias':node.pop('params',None)
 if stable(base_old)!=stable(base_new):return
 def others(graph):return [e for e in graph.get('edges',[]) if e.get('target')!={'node':collector,'port':'value'}]
 if stable(others(old))!=stable(others(new)):return
 if receipt.get('ports',{}).get('status')!='passed' or receipt['ports'].get('source_sha256')!=receipt['source']['files'].get('tools/graph_workflow.py'):raise ValueError('Source-bound graph ports required for reordering')
 entries=receipt['catalog']
 def entry(node):return next((e for e in entries.get(node.get('kind'),[]) if e['name']==node.get('class_name')),None)
 def size(identifier,seen=None):
  seen=set() if seen is None else seen
  if identifier in seen:raise ValueError('CV cycle')
  seen.add(identifier);node=old_nodes[identifier]
  if node['kind']=='cv':
   item=entry(node);value=item.get('output_size') if item else None
   if not item or item.get('semantics',{}).get('graph_support')=='blocked' or node.get('output_size',value)!=value or type(value)is not int or not 1<=value<=512:raise ValueError('Source-confirmed CV dimension required for reordering')
   return value
  if node['kind']!='reduce':raise ValueError('Only actual CV or Reduce output can be collected')
  edges=[e for e in old['edges'] if e.get('target')=={'node':identifier,'port':'value'}]
  if len(edges)!=1:raise ValueError('Reduction needs exactly one input')
  n=size(edges[0]['source']['node'],seen);operation=node.get('params',{}).get('operation')
  if operation=='identity' and n!=1:raise ValueError('Identity does not collapse a vector')
  if operation not in ('identity','mean','sum','first'):raise ValueError('Explicit source-supported reduction required')
  return 1
 offsets={};count=0
 for edge in before:
  n=size(edge['source']['node']);offsets[key(edge)]=(count,n);count+=n
 permutation=[index for edge in after for index in range(offsets[key(edge)][0],sum(offsets[key(edge)]))]
 for identifier,node in old_nodes.items():
  if node.get('kind')!='bias':continue
  item=entry(node);sem=item.get('semantics',{}) if item else {}
  if not item or sem.get('sha256')!=item['source']['sha256'] or sem.get('source')!=item['source']['name'] or sem.get('reorder_policy')!='permutation':raise ValueError('Unknown bias/grid CV order; explicit reviewed new definition required')
  links=[e for e in old['edges'] if e.get('target')=={'node':identifier,'port':'cv'}]
  if len(links)!=1 or links[0]['source']!={'node':collector,'port':'cv'}:raise ValueError('Bias must use the actual selected collector')
  values=copy.deepcopy(node.get('params',{}))
  for name,rule in sem.get('ordered_cv_parameters',{}).items():
   value=values.get(name)
   if rule.get('axis')!=0 or not isinstance(value,list) or len(value)!=count:raise ValueError('Explicit full ordered parameter required: '+identifier+'.'+name)
   values[name]=[copy.deepcopy(value[index]) for index in permutation]
  if stable(values)!=stable(new_nodes[identifier].get('params',{})):raise ValueError('CV order changed without the exact corresponding sigma/scale/pdl permutation: '+identifier)
 return {'permutation':permutation,'requires_revalidation':True}
