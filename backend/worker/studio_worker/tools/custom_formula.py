"""Private custom CV: formula data -> deterministic, inspectable PyTorch primitive.
No import of generated modules, scientific execution or provider access here.
"""
import ast,copy,hashlib,json,keyword,math,re

def stable(value):return (json.dumps(value,ensure_ascii=False,sort_keys=True,allow_nan=False,indent=2)+'\n').encode('utf8')
def sha(value):return hashlib.sha256(stable(value)).hexdigest()
def text(value,label,limit=4096):
 if not isinstance(value,str) or not value.strip() or len(value)>limit or '\x00' in value:raise ValueError('Required bounded '+label)
 return value
FUNCTIONS={'norm':('torch.linalg.vector_norm',1,1),'sum':('torch.sum',1,1),'mean':('torch.mean',1,1),'sqrt':('torch.sqrt',1,1),'exp':('torch.exp',1,1),'log':('torch.log',1,1),'sin':('torch.sin',1,1),'cos':('torch.cos',1,1),'abs':('torch.abs',1,1),'atan2':('torch.atan2',2,2),'dot':('torch.dot',2,2),'cross':('torch.cross',2,2),'clamp':('torch.clamp',3,3),'stack':('torch.stack',1,1),'mic':('_studio_mic',2,2),'logsumexp':('torch.logsumexp',1,1)}
TYPES={'number','integer','number_vector','integer_vector','number_matrix'}
RESERVED=set(FUNCTIONS)|{'pos','cell','side_array','pi','self','torch','forward','training','parameters','buffers','state_dict','n_atoms','numbers','atomic_types','bonds','internal_dtype'}
def schema(spec):
 if not isinstance(spec,dict) or set(spec)-{'name','formula','expression','symbols','units','domain','pbc','atom_selection','output_size','parameters','invariances','singularities','references'}:raise ValueError('Unknown custom CV specification fields')
 result=copy.deepcopy(spec)
 for key in ('name','formula','expression','units','domain'):text(result.get(key),key,128 if key=='name' else 4096)
 symbols=result.get('symbols')
 if not isinstance(symbols,list) or not symbols or len(symbols)>64:raise ValueError('Explicit symbol meanings/units/domain required')
 for symbol in symbols:
  if not isinstance(symbol,dict) or set(symbol)!={'name','meaning','units','domain'}:raise ValueError('Symbol description requires name, meaning, units and domain')
  for key,value in symbol.items():text(value,'symbol '+key,1024)
 singularities=result.get('singularities')
 if not isinstance(singularities,list) or not singularities or len(singularities)>32:raise ValueError('Explicit singularities/excluded geometry required')
 for value in singularities:text(value,'singularity',1024)
 if result.get('pbc') not in ('none','row_mic'):raise ValueError('Custom formula pbc must be none or explicit row_mic; partial PBC needs a separately reviewed adapter')
 if type(result.get('output_size'))is not int or not 1<=result['output_size']<=16:raise ValueError('Fixed output_size 1..16 required')
 indices=result.get('atom_selection')
 if not isinstance(indices,list) or not indices or len(indices)>256 or any(type(i)is not int or i<0 for i in indices) or len(set(indices))!=len(indices):raise ValueError('Actual distinct zero-based atom_selection required')
 invariances=result.get('invariances',[])
 if not isinstance(invariances,list) or set(invariances)-{'translation','rotation','periodic_translation'}:raise ValueError('Unsupported automatic invariance check')
 if 'periodic_translation' in invariances and result['pbc']!='row_mic':raise ValueError('Periodic translation needs row_mic definition')
 refs=result.get('references',[])
 if not isinstance(refs,list) or len(refs)>16 or any(not isinstance(r,str) or len(r)>1024 or not r.startswith('https://') for r in refs):raise ValueError('References are bounded HTTPS source links')
 params=result.get('parameters')
 if not isinstance(params,list) or len(params)>32:raise ValueError('Bounded typed parameter schema required')
 names=set()
 for p in params:
  if not isinstance(p,dict) or set(p)-{'name','type','units','description','required','default','min','max'}:raise ValueError('Unknown custom parameter schema fields')
  name=p.get('name')
  if not isinstance(name,str) or not re.fullmatch('[a-z][a-z0-9_]{0,47}',name) or name in RESERVED or keyword.iskeyword(name) or name in names:raise ValueError('Invalid or reserved parameter name')
  names.add(name)
  if p.get('type') not in TYPES:raise ValueError('Unsupported custom parameter type')
  for key in ('units','description'):text(p.get(key),'parameter '+key,1024)
  if type(p.get('required'))is not bool:raise ValueError('Explicit parameter required flag needed')
  if not p['required'] and 'default' not in p:raise ValueError('Optional custom parameter requires a defined default')
  for key in ('min','max'):
   if key in p and (type(p[key]) not in (int,float) or not math.isfinite(p[key])):raise ValueError('Finite parameter domain required')
  if 'min'in p and 'max'in p and p['min']>p['max']:raise ValueError('Invalid parameter domain')
 expression(result['expression'],names,result['pbc']);expression_type(result)
 parameter_values(result,{p['name']:p['default'] for p in params if 'default'in p},complete=False)
 return result

def parameter_values(spec,values,complete=True):
 if not isinstance(values,dict) or set(values)-{p['name'] for p in spec['parameters']}:raise ValueError('Only confirmed formula parameter names are accepted')
 result=copy.deepcopy(values);missing=[]
 for p in spec['parameters']:
  name=p['name']
  if name not in result and 'default'in p:result[name]=copy.deepcopy(p['default'])
  if name not in result or result[name] is None:missing.append(name);continue
  value=result[name];kind=p['type']
  def scalar(v):
   if type(v)not in ((int,) if kind.startswith('integer') else (int,float)) or not math.isfinite(v):raise ValueError('Wrong finite parameter type: '+name)
   if 'min'in p and v<p['min'] or 'max'in p and v>p['max']:raise ValueError('Parameter outside confirmed domain: '+name)
  if kind in ('number','integer'):scalar(value)
  else:
   if not isinstance(value,list) or not value or len(value)>256:raise ValueError('Bounded parameter array required: '+name)
   for row in value:
    if kind=='number_matrix':
     if not isinstance(row,list) or not row or len(row)>32 or not isinstance(value[0],list) or len(row)!=len(value[0]):raise ValueError('Rectangular bounded matrix required')
     for v in row:scalar(v)
    else:scalar(row)
 if complete and missing:raise ValueError('Missing formula parameters: '+', '.join(missing))
 return result,missing

def expression(value,names,pbc):
 text(value,'expression',4096);tree=ast.parse(value,mode='eval')
 if sum(1 for _ in ast.walk(tree))>512:raise ValueError('Formula expression is too large')
 def emit(n):
  if isinstance(n,ast.Name):
   if n.id in names:return 'self._cvp_'+n.id
   if n.id in ('pos','cell'):return n.id
   if n.id=='side_array':raise ValueError('Neighbor-dependent custom formulas need a reviewed neighbor adapter; use the actual pyGAS library first')
   if n.id=='pi':return 'torch.pi'
   raise ValueError('Unknown formula symbol: '+n.id)
  if isinstance(n,ast.Constant) and type(n.value)in (int,float):
   if not math.isfinite(n.value) or abs(n.value)>1e12:raise ValueError('Unbounded formula constant')
   return repr(n.value)
  if isinstance(n,ast.BinOp) and type(n.op)in (ast.Add,ast.Sub,ast.Mult,ast.Div,ast.Pow):
   if isinstance(n.op,ast.Pow)and(not isinstance(n.right,ast.Constant)or type(n.right.value)not in(int,float)or abs(n.right.value)>16):raise ValueError('Formula powers require an explicit bounded constant exponent in [-16,16]')
   op={ast.Add:'+',ast.Sub:'-',ast.Mult:'*',ast.Div:'/',ast.Pow:'**'}[type(n.op)];return '('+emit(n.left)+op+emit(n.right)+')'
  if isinstance(n,ast.UnaryOp) and type(n.op)in (ast.UAdd,ast.USub):return ('+' if isinstance(n.op,ast.UAdd) else '-')+'('+emit(n.operand)+')'
  if isinstance(n,ast.Subscript):return emit(n.value)+'['+emit_index(n.slice)+']'
  if isinstance(n,(ast.Tuple,ast.List)):
   if len(n.elts)>32:raise ValueError('Formula tuple/list too large')
   return ('[' if isinstance(n,ast.List) else '(')+', '.join(emit(e) for e in n.elts)+(']' if isinstance(n,ast.List) else ',)')
  if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id in FUNCTIONS and not n.keywords:
   function,minimum,maximum=FUNCTIONS[n.func.id]
   if not minimum<=len(n.args)<=maximum:raise ValueError('Wrong formula function arity: '+n.func.id)
   if n.func.id=='mic' and pbc!='row_mic':raise ValueError('mic requires an explicitly confirmed row_mic convention')
   return function+'('+', '.join(emit(a) for a in n.args)+( ', dim=-1' if n.func.id=='cross' else ', dim=0' if n.func.id=='logsumexp' else '')+')'
  raise ValueError('Unsupported formula expression; discuss a supported primitive or an explicitly reviewed extension')
 def emit_index(n):
  if isinstance(n,ast.Slice):return ':'.join('' if x is None else emit(x) for x in (n.lower,n.upper,n.step))
  if isinstance(n,ast.Tuple):return ', '.join(emit_index(e) for e in n.elts)
  return emit(n)
 return emit(tree.body)

def expression_type(spec,values=None):
 """Conservative static tensor/type check; no execution of user expressions."""
 values=values or {p['name']:p['default'] for p in spec['parameters'] if 'default'in p}
 params={p['name']:p for p in spec['parameters']};tree=ast.parse(spec['expression'],mode='eval')
 # (kind, shape); None dimension means a bounded typed value whose length is not set.
 def scalar_index(n):
  if isinstance(n,ast.Constant)and type(n.value)is int:return n.value
  if isinstance(n,ast.Name)and params.get(n.id,{}).get('type')=='integer':return values.get(n.id)
  raise ValueError('Formula indexes must be declared integers or integer literals')
 def broadcast(a,b):
  result=[]
  for x,y in zip((1,)*(max(len(a),len(b))-len(a))+a,(1,)*(max(len(a),len(b))-len(b))+b):
   if x==y:result.append(x)
   elif x==1:result.append(y)
   elif y==1:result.append(x)
   elif x is None or y is None:result.append(None)
   else:raise ValueError('Formula tensor dimensions cannot broadcast')
  return tuple(result)
 def tensor(t,label):
  if t[0]!='tensor':raise ValueError(label+' requires a Tensor expression, not a plain number/list')
  return t[1]
 def infer(n):
  if isinstance(n,ast.Name):
   if n.id in ('pos','cell'):return ('tensor',(None,3)if n.id=='pos'else(3,3))
   if n.id=='pi':return ('number',())
   if n.id in params:
    p=params[n.id];kind=p['type'];value=values.get(n.id)
    if kind in ('integer','number'):return ('number',())
    if kind in ('integer_vector','number_vector'):return ('tensor',(len(value)if isinstance(value,list)else None,))
    return ('tensor',(len(value)if isinstance(value,list)else None,len(value[0])if isinstance(value,list)and value and isinstance(value[0],list)else None))
  if isinstance(n,ast.Constant)and type(n.value)in(int,float):return ('number',())
  if isinstance(n,ast.UnaryOp):return infer(n.operand)
  if isinstance(n,ast.BinOp):
   a,b=infer(n.left),infer(n.right)
   if a[0]not in ('tensor','number')or b[0]not in ('tensor','number'):raise ValueError('Arithmetic needs numeric scalars or tensors')
   return ('tensor'if 'tensor'in(a[0],b[0])else'number',broadcast(a[1],b[1]))
  if isinstance(n,(ast.Tuple,ast.List)):return ('sequence',tuple(infer(x)for x in n.elts))
  if isinstance(n,ast.Subscript):
   shape=tensor(infer(n.value),'Indexing');parts=n.slice.elts if isinstance(n.slice,ast.Tuple)else[n.slice]
   if len(parts)>len(shape):raise ValueError('Too many formula tensor indexes')
   result=[]
   for dimension,index in zip(shape,parts):
    if isinstance(index,ast.Slice):
     start=0 if index.lower is None else scalar_index(index.lower);stop=dimension if index.upper is None else scalar_index(index.upper);step=1 if index.step is None else scalar_index(index.step)
     if step is not None and step<1:raise ValueError('Formula slices require positive integer steps')
     result.append(len(range(start,stop,step))if all(type(v)is int for v in(start,stop,step))else None)
    elif isinstance(index,ast.Name)and params.get(index.id,{}).get('type')=='integer_vector':result.append(len(values[index.id])if isinstance(values.get(index.id),list)else None)
    elif isinstance(index,(ast.List,ast.Tuple)):
     for child in index.elts:scalar_index(child)
     result.append(len(index.elts))
    else:
     actual=scalar_index(index)
     if actual is not None and (actual<0 or dimension is not None and actual>=dimension):raise ValueError('Formula index is outside its statically known dimension')
   return ('tensor',tuple(result)+shape[len(parts):])
  if isinstance(n,ast.Call)and isinstance(n.func,ast.Name)and n.func.id in FUNCTIONS:
   name=n.func.id;args=[infer(a)for a in n.args]
   if name=='stack':
    if args[0][0]!='sequence'or not args[0][1]:raise ValueError('stack requires a nonempty literal list/tuple of Tensor expressions')
    shapes=[tensor(t,'stack item')for t in args[0][1]]
    if any(t!=shapes[0]for t in shapes):raise ValueError('stack items must have the same known shape')
    return ('tensor',(len(shapes),)+shapes[0])
   first=tensor(args[0],name)
   if name in ('norm','sum','mean'):return ('tensor',())
   if name=='logsumexp':
    if len(first)!=1:raise ValueError('Stable logsumexp supports an explicit one-dimensional Tensor stack only')
    return ('tensor',())
   if name in ('sqrt','exp','log','sin','cos','abs'):return ('tensor',first)
   if name in ('dot','cross'):
    second=tensor(args[1],name)
    if len(first)!=1 or first!=second or name=='cross'and first!=(3,):raise ValueError(name+' requires matching 1D tensors'+(' of length 3'if name=='cross'else''))
    return ('tensor',()if name=='dot'else first)
   if name=='mic':
    if not first or first[-1]!=3 or tensor(args[1],name)!=(3,3):raise ValueError('Fractional row wrap needs (...,3) vectors and a (3,3) row cell')
    return ('tensor',first)
   if name=='atan2':return ('tensor',broadcast(first,tensor(args[1],name)))
   if name=='clamp':
    if args[1][0]!='number'or args[2][0]!='number':raise ValueError('clamp limits must be numeric scalar values')
    return ('tensor',first)
  raise ValueError('Unsupported typed formula expression')
 # Check every intermediate, including reduced tensors, before importing Torch.
 for node in ast.walk(tree):
  if not isinstance(node,(ast.Name,ast.Constant,ast.UnaryOp,ast.BinOp,ast.List,ast.Tuple,ast.Subscript,ast.Call)):continue
  # Function/operator identifiers and literal sequence/index helper nodes have
  # no standalone Tensor shape. The root typed inference still validates them.
  try:kind0,shape0=infer(node)
  except ValueError:continue
  if kind0=='tensor'and(len(shape0)>4 or math.prod(256 if value is None else value for value in shape0)>65536):raise ValueError('Formula intermediate exceeds rank4 / 65536 element CPU authoring budget')
 kind,shape=infer(tree.body)
 if kind!='tensor':raise ValueError('CV expression must produce a Tensor; a constant/plain number is not a supported differentiable CV')
 if all(type(v)is int for v in shape):
  count=math.prod(shape)
  if count!=spec['output_size']:raise ValueError('Formula output size differs from the confirmed fixed output_size')
 return {'kind':kind,'shape':shape,'scope':'Conservative static type/shape checks; actual saved primitive output and derivatives still require numerical validation'}


def referenced_atoms(spec,values,n_atoms):
 """Derive FD coverage from actual formula indexes, never a guessed CV group."""
 if type(n_atoms)is not int or n_atoms<1 or any(type(index)is not int or not 0<=index<n_atoms for index in spec['atom_selection']):raise ValueError('Confirmed atom_selection exceeds actual zero-based reference structure')
 tree=ast.parse(spec['expression'],mode='eval');parents={child:parent for parent in ast.walk(tree)for child in ast.iter_child_nodes(parent)};used=[]
 def integer(node):
  if isinstance(node,ast.Constant)and type(node.value)is int:return node.value
  if isinstance(node,ast.Name)and type(values.get(node.id))is int:return values[node.id]
  raise ValueError('Position indexing needs a declared integer parameter or integer literal')
 def add(index):
  if type(index)is not int or not 0<=index<n_atoms:raise ValueError('Formula position index exceeds actual zero-based reference atoms')
  if index not in used:used.append(index)
 def indices(node):
  if isinstance(node,ast.Tuple):return indices(node.elts[0])
  if isinstance(node,ast.Slice):
   start=0 if node.lower is None else integer(node.lower);stop=n_atoms if node.upper is None else integer(node.upper);step=1 if node.step is None else integer(node.step)
   if start<0 or stop<0 or stop>n_atoms or step<1:raise ValueError('Explicit positive position slice within actual structure required')
   return list(range(start,stop,step))
  if isinstance(node,ast.Name)and isinstance(values.get(node.id),list):return values[node.id]
  if isinstance(node,(ast.Tuple,ast.List)):return [integer(n)for n in node.elts]
  return [integer(node)]
 for node in ast.walk(tree):
  if isinstance(node,ast.Name)and node.id=='pos':
   parent=parents.get(node)
   group=indices(parent.slice)if isinstance(parent,ast.Subscript)and parent.value is node else list(range(n_atoms))
   for index in group:add(index)
 if not set(used).issubset(set(spec['atom_selection'])):raise ValueError('Formula refers to atoms outside its confirmed allowed group')
 return used


def module_source(spec):
 spec=schema(spec);identity=sha(spec);name='StudioCustom_'+identity[:16]
 params=spec['parameters'];signature=', '.join(p['name']+('='+repr(p['default'])if not p['required']else'') for p in params);lines=[]
 for p in params:
  key=p['name'];kind=p['type']
  if kind=='integer':lines.append('        self._cvp_'+key+' = int('+key+')')
  elif kind=='number':lines.append('        self._cvp_'+key+' = float('+key+')')
  else:lines.append('        self.register_buffer('+repr('_cvp_'+key)+', torch.tensor('+key+', dtype='+('torch.long' if kind=='integer_vector' else 'torch.float64')+'))')
 body=expression(spec['expression'],{p['name'] for p in params},spec['pbc'])
 source='''# Deterministically generated only after a human formula approval.
# Generator: typed-formula-v1; PBC row_mic means component-wise fractional row wrap.
# It is not a closest-image algorithm for an arbitrary strongly triclinic cell.
# Formula/spec SHA256: '''+identity+'''
import torch

def _studio_mic(vector: torch.Tensor, cell: torch.Tensor) -> torch.Tensor:
    fractional = torch.matmul(vector, torch.linalg.inv(cell))
    return torch.matmul(fractional - torch.round(fractional), cell)

class '''+name+'''(torch.nn.Module):
    def __init__(self'''+(', *, '+signature if signature else '')+'''):
        super().__init__()
'''+('\n'.join(lines)+'\n' if lines else '')+'''
    def forward(self, pos: torch.Tensor, cell: torch.Tensor, side_array: torch.Tensor) -> torch.Tensor:
        # Same nominal positions/coordinate gradient; cell AD holds fractional positions.
        # This matches the pyGAS cell-gradient -> virial convention, not a partial
        # derivative that silently fixes Cartesian coordinates during strain.
        fractions = torch.matmul(pos, torch.linalg.inv(cell.detach()))
        pos = torch.matmul(fractions, cell)
        value = '''+body+'''
        return value.reshape(-1)
'''
 ast.parse(source)
 return {'class_name':name,'source':source,'spec_sha256':identity,'code_sha256':hashlib.sha256(source.encode('utf8')).hexdigest(),'output_size':spec['output_size'],'forward_args':['pos','cell','side_array'],'scope':'Generated primitive source only; numerical/serialization/target validation not_run'}


def fd_atoms(indices):
 """One deterministic coverage rule shared by human consent and actual numerics."""
 if not isinstance(indices,list)or not indices or any(type(i)is not int or i<0 for i in indices)or len(set(indices))!=len(indices):raise ValueError('Distinct actual referenced atoms required')
 return list(indices)if len(indices)<=8 else[indices[round(i*(len(indices)-1)/7)]for i in range(8)]
