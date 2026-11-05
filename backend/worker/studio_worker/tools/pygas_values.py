"""Data-only graph-value serializer candidate; no import or evaluation of user code."""
import ast,copy,json,math,re
DTYPES={"torch.double","torch.float64","torch.float32","torch.float","torch.long","torch.int64","torch.int32"}
# Public input metadata and validation share these exact policy constants.
GRAPH_KEYS=frozenset({'version','mode','nodes','edges','settings','parameter_format','metadata'})
SETTINGS_KEYS=frozenset({'mode','class_name','atoms_path','pt_path','dtype_expr','device_expr','cv_internal_dtype_expr','artifact_formats','deployment_backend','cutoff','max_neighbors','max_cv_nums','history_size','opes_kernel_capacity','opes','cast_history_internal_dtype','scientific_metadata','workflow_path'})
NODE_KEYS=frozenset({'id','kind','class_name','alias','title','params','output_size','x','y','position','metadata','parameter_dtypes'})
EDGE_KEYS=frozenset({'id','source','target'})
ENDPOINT_KEYS=frozenset({'node','port'})
REDUCE_PARAMETER_KEYS=frozenset({'operation'})
REDUCE_OPERATIONS=frozenset({'mean','sum','first','identity'})
STRUCTURE_DERIVED_PARAMS=frozenset({'n_atoms','numbers','atomic_types'})

def _safe_keys(keys):
 names=sorted(key if isinstance(key,str) and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,63}',key) else '<nonstandard-key>' for key in keys)
 return ', '.join(names[:8])+(' (additional keys omitted)' if len(names)>8 else '')

def _node_location(index,node):
 name=node.get('id') if isinstance(node,dict) else None
 return 'nodes['+str(index)+']'+(' ('+name+')' if isinstance(name,str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,80}',name) else '')

def studio_graph_parameter_policy(param):
 if param.get('name') in STRUCTURE_DERIVED_PARAMS:return {'policy':'structure_derived','serialize':'omit','required_in_graph':False,'value_source':'authorized atoms input; do not supply this constructor field in graph params'}
 return None

def studio_graph_input_contract():
 import hashlib
 from pathlib import Path
 return {'schema_version':1,'partial':True,'validation':'not_run','source':{'name':'studio_worker/tools/pygas_values.py','sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},'validator':['compiler_graph','normalize_graph'],'scope':'Studio graph input serialization rules only; not a complete native/scientific/runtime schema. No values or intent are automatically repaired.','allowed_properties':{'graph':sorted(GRAPH_KEYS),'settings':sorted(SETTINGS_KEYS),'node':sorted(NODE_KEYS),'edge':sorted(EDGE_KEYS),'endpoint':sorted(ENDPOINT_KEYS)},'reduce':{'kind':'reduce','parameter_path':'params.operation','allowed_params':sorted(REDUCE_PARAMETER_KEYS),'operations':sorted(REDUCE_OPERATIONS),'required_when':'complete rendering','example':{'id':'reduce0','kind':'reduce','params':{'operation':'mean'}}},'structure_derived':{'parameter_names':sorted(STRUCTURE_DERIVED_PARAMS),'serialize':'omit','value_source':'authorized atoms input','constructor_required_is_separate':True},'module_parameters':{'when':'catalog parameter is_module_param is true','serialize':'graph connection; omit direct constructor value'},'endpoints':{'shape':{'node':'node id','port':'registered port name'},'exact_properties':sorted(ENDPOINT_KEYS)}}

def literal(node,depth=0):
 if depth>12:raise ValueError("Parameter nesting exceeds 12")
 if isinstance(node,ast.Constant) and (node.value is None or type(node.value) in (int,float,bool,str)):
  value=node.value
  if isinstance(value,float) and not math.isfinite(value):raise ValueError("Nonfinite parameter")
  return value
 if isinstance(node,(ast.List,ast.Tuple)) and len(node.elts)<=20000:return [literal(item,depth+1) for item in node.elts]
 if isinstance(node,ast.UnaryOp) and isinstance(node.op,(ast.USub,ast.UAdd)):
  value=literal(node.operand,depth+1)
  if type(value) in (int,float):return -value if isinstance(node.op,ast.USub) else value
 if isinstance(node,ast.Attribute) and isinstance(node.value,ast.Name) and node.value.id in ("torch","math","np") and node.attr=="pi":return math.pi
 if isinstance(node,ast.BinOp) and isinstance(node.op,(ast.Add,ast.Sub,ast.Mult,ast.Div)):
  left,right=literal(node.left,depth+1),literal(node.right,depth+1)
  if type(left) not in (int,float) or type(right) not in (int,float):raise ValueError("Numeric constants required")
  value=left+right if isinstance(node.op,ast.Add) else left-right if isinstance(node.op,ast.Sub) else left*right if isinstance(node.op,ast.Mult) else left/right
  if math.isfinite(value):return value
 raise ValueError("Only structured data accepted; custom code requires formula discussion")
def tensor_shape(value):
 if type(value) in (int,float):return ()
 if not isinstance(value,list):raise ValueError("Tensor values must be finite numeric data")
 shapes=[tensor_shape(v) for v in value]
 if shapes and any(shape!=shapes[0] for shape in shapes):raise ValueError("Ragged tensor data refused")
 return (len(value),)+(shapes[0] if shapes else ())
def value_expression(value,param,legacy=True):
 editor=param.get("editor_hint",{});tensor=param.get("type_hint")=="tensor" or editor.get("serializer")=="tensor";dtype=editor.get("tensor_dtype") or param.get("default_tensor_dtype")
 if param.get("name")=="dtype" and isinstance(value,str) and (value if value.startswith("torch.") else "torch."+value) in DTYPES:
  canonical={"double":"float64","float":"float32","long":"int64"}.get(value.removeprefix("torch."),value.removeprefix("torch."))
  if editor.get("editor")=="enum" and canonical not in editor.get("options",[]):raise ValueError("Unsupported dtype option for this constructor")
  return "torch."+canonical
 if param.get("name")=="device" and isinstance(value,str):
  if re.fullmatch(r"(?:cpu|cuda(?::[0-9]{1,2})?)",value):return "torch.device("+repr(value)+")"
  if legacy and re.fullmatch(r"torch\.device\(['\"](?:cpu|cuda(?::[0-9]{1,2})?)['\"]\)",value):return value
 if value is None and param.get("default_is_literal") and param.get("default_value") is None and not param.get("required"):return "None"
 if param.get("name")=="internal_dtype":
  if value is None or legacy and value=="None":return "None"
  if isinstance(value,str):
   name=value.removeprefix("torch.");name={"double":"float64","float":"float32","long":"int64"}.get(name,name)
   if editor.get("editor")=="enum" and name not in editor.get("options",[]):raise ValueError("Unsupported internal_dtype option for this constructor")
   if "torch."+name in DTYPES:return "torch."+name
  raise ValueError("Choose an actual constructor internal_dtype option")
 if isinstance(value,str) and legacy:
  text=value.strip()
  if not text:raise ValueError("Empty parameter")
  try:node=ast.parse(text,mode="eval").body
  except SyntaxError as error:raise ValueError("Typed parameter data required") from error
  if isinstance(node,ast.Call):
   if not isinstance(node.func,ast.Attribute) or not isinstance(node.func.value,ast.Name) or node.func.value.id!="torch" or node.func.attr!="tensor" or len(node.args)!=1 or len(node.keywords)>1 or any(k.arg!="dtype" for k in node.keywords):raise ValueError("Arbitrary calls refused")
   tensor=True
   if node.keywords:
    dtype=ast.unparse(node.keywords[0].value)
    if dtype not in DTYPES:raise ValueError("Unsupported tensor dtype")
   value=literal(node.args[0])
  else:value=literal(node)
 encoded=json.dumps(value,allow_nan=False)
 if len(encoded.encode())>256*1024:raise ValueError("Parameter exceeds 256 KiB")
 value=literal(ast.parse(repr(value),mode="eval").body)
 if editor.get("editor") in ("integer_vector","integer_matrix"):
  def integer_data(item):
   if isinstance(item,list):return all(integer_data(v) for v in item)
   return type(item)is int and item>=0
  shape=tensor_shape(value)
  if not integer_data(value) or not isinstance(value,list):raise ValueError("Nonnegative integer indices required")
  expected=editor.get("shape")
  if expected and (len(shape)!=len(expected) or any(n is not None and n!=actual for n,actual in zip(expected,shape))):raise ValueError("Index shape does not match registered parameter")
 if editor.get("editor")=="number" and type(value) not in (int,float):raise ValueError("Numeric parameter required")
 if editor.get("editor")=="enum" and value not in editor.get("options",[]):raise ValueError("Unsupported parameter option")
 if editor.get("tensor_dtype"):dtype=editor["tensor_dtype"]
 hint=param.get("type_hint")
 if hint=="int" and type(value)is not int:raise ValueError(param["name"]+" requires an integer")
 if hint=="float" and type(value) not in (int,float):raise ValueError(param["name"]+" requires a number")
 if tensor:tensor_shape(value)
 return "torch.tensor("+repr(value)+(", dtype="+dtype if dtype else "")+")" if tensor else repr(value)

def compiler_graph(graph,catalog,*,require_complete=True):
 if not isinstance(graph,dict) or not isinstance(graph.get("nodes"),list) or len(graph["nodes"])>128:raise ValueError("Bounded actual graph required")
 if len(json.dumps(graph,allow_nan=False).encode())>1024*1024:raise ValueError("Graph exceeds 1 MiB")
 if set(graph)-GRAPH_KEYS:raise ValueError("graph: Unknown graph fields: "+_safe_keys(set(graph)-GRAPH_KEYS))
 result=copy.deepcopy(graph);settings=result.get("settings",{})
 allowed_settings=SETTINGS_KEYS
 if not isinstance(settings,dict):raise ValueError("settings: expected object")
 if set(settings)-allowed_settings:raise ValueError("settings: Unknown graph settings: "+_safe_keys(set(settings)-allowed_settings))
 for key in ("atoms_path","pt_path","workflow_path"):
  if key in settings and (not isinstance(settings[key],str) or any(ord(c)<32 or c in '\\"' for c in settings[key])):raise ValueError("Unsafe generated I/O name")
 if len(result.get("edges",[]))>512:raise ValueError("Graph exceeds 512 edges")
 for edge_index,edge in enumerate(result.get("edges",[])):
  if not isinstance(edge,dict):raise ValueError("edges["+str(edge_index)+"]: expected object")
  if set(edge)-EDGE_KEYS:raise ValueError("edges["+str(edge_index)+"]: Unknown edge fields: "+_safe_keys(set(edge)-EDGE_KEYS))
  for side in ("source","target"):
   if not isinstance(edge.get(side),dict) or set(edge[side])!=ENDPOINT_KEYS or any(not isinstance(v,str) for v in edge[side].values()):raise ValueError("Structured graph endpoints required")
 for key,allowed in (("dtype_expr",{"torch.double","torch.float64","torch.float32","torch.float"}),("cv_internal_dtype_expr",{"torch.double","torch.float64","torch.float32","torch.float","None"})):
  if key in settings and settings[key] not in allowed:raise ValueError("Unsupported "+key)
 if "device_expr" in settings and re.fullmatch(r"torch\.device\(['\"](?:cpu|cuda(?::[0-9]{1,2})?)['\"]\)",str(settings["device_expr"])) is None:raise ValueError("Unsupported device_expr")
 for node_index,node in enumerate(result["nodes"]):
  if not isinstance(node,dict):raise ValueError(_node_location(node_index,node)+': expected object')
  unknown=set(node)-NODE_KEYS
  if unknown:raise ValueError(_node_location(node_index,node)+': Unknown graph node fields: '+_safe_keys(unknown)+('; reduce operation belongs in params.operation' if node.get('kind')=='reduce' and 'operation' in unknown else ''))
  kind=node.get("kind")
  if kind in ("input","output","collect"):
   if node.get("params"):raise ValueError("This node has no constructor parameters")
   continue
  if kind=="reduce":
   values=node.get("params",{})
   if not isinstance(values,dict)or set(values)-REDUCE_PARAMETER_KEYS:raise ValueError("Explicit reduction operation required")
   operation=values.get("operation")
   if operation in(None,""):
    if require_complete:raise ValueError("Explicit reduction operation required")
    continue
   if operation not in REDUCE_OPERATIONS:raise ValueError("Unsupported explicit reduction")
   continue
  entry=next((entry for entry in catalog.get(kind,[]) if entry["name"]==node.get("class_name")),None)
  if entry is None:raise ValueError("Class absent from registered GUI catalog")
  values=node.get("params",{})
  if not isinstance(values,dict) or set(values)-{p["name"] for p in entry["params"]}:raise ValueError("Unknown constructor parameter")
  dtypes=node.get("parameter_dtypes",{})
  if not isinstance(dtypes,dict) or set(dtypes)-set(values) or any(dtype not in DTYPES for dtype in dtypes.values()):raise ValueError("Unsupported tensor datatype metadata")
  for key in dtypes:
   definition=next(p for p in entry["params"] if p["name"]==key)
   if definition.get("type_hint")!="tensor" and definition.get("editor_hint",{}).get("serializer")!="tensor":raise ValueError("Tensor dtype metadata cannot change a scalar constructor parameter")
  serialized={}
  for param in entry["params"]:
   name=param["name"];value=values.get(name);present=name in values and value!=""
   if name in STRUCTURE_DERIVED_PARAMS:
    if present:raise ValueError(_node_location(node_index,node)+".params."+name+" is structure-derived; omit this graph parameter; supplied from the authorized atoms input")
    continue
   if param.get("is_module_param"):
    if present:raise ValueError(name+" requires a graph connection")
    continue
   if present:
    effective=copy.deepcopy(param)
    if effective.get("type_hint")=="tensor" or effective.get("editor_hint",{}).get("serializer")=="tensor":effective["default_tensor_dtype"]=settings.get("dtype_expr","torch.double")
    if name in dtypes:effective["editor_hint"]={**effective.get("editor_hint",{}),"serializer":"tensor","tensor_dtype":dtypes[name]}
    serialized[name]=value_expression(value,effective,legacy=graph.get("parameter_format")!="structured-v1")
   elif param.get("required") and require_complete:raise ValueError(node.get("id",kind)+"."+name+" required")
  node["params"]=serialized
 return result

def normalize_graph(graph,catalog,*,require_complete=False):
 """Convert safe legacy data expressions once; preserve dtype metadata and node/edge IDs."""
 if graph.get("parameter_format")=="structured-v1":
  compiler_graph(graph,catalog,require_complete=require_complete);return copy.deepcopy(graph)
 compiled=compiler_graph(graph,catalog,require_complete=require_complete);result=copy.deepcopy(graph);result["parameter_format"]="structured-v1"
 for node,source in zip(result["nodes"],compiled["nodes"]):
  if node.get("kind") in ("input","output","collect","reduce"):continue
  values={};dtypes={}
  for name,expression in source.get("params",{}).items():
   parsed=ast.parse(expression,mode="eval").body
   if isinstance(parsed,ast.Call):
    if isinstance(parsed.func,ast.Attribute) and parsed.func.attr=="device":values[name]=literal(parsed.args[0]);continue
    values[name]=literal(parsed.args[0])
    definition=next(p for p in catalog[node["kind"]] if p["name"]==node["class_name"])
    parameter=next(p for p in definition["params"] if p["name"]==name)
    if parsed.keywords and (parameter.get("type_hint")=="tensor" or parameter.get("editor_hint",{}).get("serializer")=="tensor"):dtypes[name]=ast.unparse(parsed.keywords[0].value)
   elif isinstance(parsed,ast.Attribute) and expression in DTYPES:values[name]=expression.removeprefix("torch.")
   else:values[name]=literal(parsed)
  node["params"]=values
  if dtypes:node["parameter_dtypes"]=dtypes
 compiler_graph(result,catalog,require_complete=require_complete)
 return result
