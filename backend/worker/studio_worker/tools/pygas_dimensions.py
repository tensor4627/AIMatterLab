"""Source-bound AIMatterLab guards after the real pyGAS graph validator; no engine import."""
import ast,math
if __package__:
 from studio_worker.tools.pygas_values import literal,tensor_shape
else:
 from studio_worker.tools.pygas_values import literal,tensor_shape

def data(expression):
 node=ast.parse(expression,mode="eval").body
 if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and isinstance(node.func.value,ast.Name) and node.func.value.id=="torch" and node.func.attr=="tensor" and len(node.args)==1:
  return literal(node.args[0])
 return literal(node)

def flatten(value):
 return [x for item in value for x in flatten(item)] if isinstance(value,list) else [value]

def validate_dimensions(compiled,receipt,plan,structure=None):
 """Only validated source-matched semantics activate extra constructor checks.

 Input must be the allowlisted serializer output and actual validate_graph plan.
 This is a static pre-render guard, never a numerical or physical certificate.
 """
 size=plan.get("cv_size")
 if type(size)is not int or size<1:raise ValueError("Actual renderer CV dimension required")
 catalog=receipt["catalog"];files=receipt["source"]["files"];warnings=[]
 nodes={node["id"]:node for node in compiled["nodes"]}
 def scalar_output(identifier,seen=None):
  seen=set() if seen is None else seen
  if identifier in seen:return False
  seen.add(identifier);node=nodes.get(identifier,{})
  if node.get("kind")=="cv":
   entry=next((item for item in catalog.get("cv",[]) if item["name"]==node.get("class_name")),None)
   return bool(entry and entry.get("output_size")==1 and entry.get("semantics",{}).get("graph_support")!="blocked")
  if node.get("kind")=="reduce":
   operation=node.get("params",{}).get("operation")
   if operation in ("mean","sum","first"):return True
   incoming=[e["source"]["node"] for e in compiled.get("edges",[]) if e.get("target")=={"node":identifier,"port":"value"}]
   return operation=="identity" and len(incoming)==1 and scalar_output(incoming[0],seen)
  return False
 for node in compiled["nodes"]:
  if node.get("kind")=="reduce" and node.get("params",{}).get("operation")=="identity" and not scalar_output(node["id"]):raise ValueError("identity preserves vector size but this registered planner counts every Reduce as one CV; only source-confirmed scalar input may use identity")
 for node in compiled["nodes"]:
  kind=node.get("kind")
  entry=next((item for item in catalog.get(kind,[]) if item["name"]==node.get("class_name")),None)
  if not entry:continue
  if entry["source"]["sha256"]!=files.get(entry["source"]["name"]):raise ValueError("Catalog/source hash mismatch")
  params=node.get("params",{});names={p["name"] for p in entry["params"] if p.get("editor_hint",{}).get("editor") in ("integer_vector","integer_matrix")} | {"sigma","scale","pdl","temp","bias_factor"};parsed={name:data(expr) for name,expr in params.items() if name in names}
  # Source-bound hints distinguish atom indexes from species-pair bond filters.
  for definition in entry["params"]:
   name=definition["name"];hint=definition.get("editor_hint",{})
   if name not in parsed or hint.get("editor") not in ("integer_vector","integer_matrix"):continue
   if hint.get("provenance",{}).get("sha256")!=entry["source"]["sha256"]:raise ValueError("Stale index editor semantics")
   if name=="bonds":
    if any(type(n)is not int or not 1<=n<=118 for n in flatten(parsed[name])):raise ValueError("bonds requires atomic-number pairs in 1..118, not atom indexes")
   elif structure is not None:
    count=structure.get("n_atoms")
    if type(count)is not int or count<1:raise ValueError("Actual structure atom count required")
    if any(n>=count for n in flatten(parsed[name])):raise ValueError(node["id"]+"."+name+" exceeds actual zero-based atom indexes")
  semantics=entry.get("semantics",{})
  if semantics and (semantics.get("sha256")!=entry["source"]["sha256"] or semantics.get("source")!=entry["source"]["name"]):raise ValueError("Stale class semantics")
  if kind=="cv" and semantics.get("output_rank")==0:
   outgoing=[edge for edge in compiled.get("edges",[]) if edge.get("source",{}).get("node")==node["id"]]
   if any(nodes.get(edge.get("target",{}).get("node"),{}).get("kind")!="reduce" for edge in outgoing):raise ValueError(entry["name"]+" returns a 0D scalar; add an explicit Reduce identity reshape before Collect. Catalog output_size=1 is not a rank-one tensor")
  if semantics.get("graph_support")=="blocked":raise ValueError(entry["name"]+": "+semantics["reason"])
  if kind=="cv" and entry.get("output_size") is None:
   outgoing=[edge for edge in compiled.get("edges",[]) if edge.get("source",{}).get("node")==node["id"]]
   if any(nodes.get(edge.get("target",{}).get("node"),{}).get("kind")!="reduce" or nodes[edge["target"]["node"]].get("params",{}).get("operation") not in ("mean","sum") for edge in outgoing):raise ValueError("Dynamic CV size is not established by a declared output_size; use an explicit scientifically intended mean/sum or a source-verified fixed-shape adapter")
  if kind=="cv" and node.get("output_size") is not None and entry.get("output_size") is not None and node["output_size"]!=entry["output_size"]:raise ValueError("Declared CV size conflicts with the actual registered catalog")
  # These source-bound legacy MetaD families share sigma/scale definitions.
  if kind=="bias" and "sigma" in params and "scale" in params and semantics.get("scale_rule"):
   sigma=flatten(parsed["sigma"]);scale=flatten(parsed["scale"])
   if len(sigma)!=size or len(scale)!=size:raise ValueError(node["id"]+": sigma and scale must match the full ordered CV dimension "+str(size))
   if any(s!=0 and v<=0 for s,v in zip(scale,sigma)):raise ValueError(node["id"]+": active sigma must be positive")
   if not any(s!=0 for s in scale):warnings.append({"node":node["id"],"field":"scale","reason":"All CV dimensions are disabled; this bias cannot drive exploration"})
   if any(s not in (0,1) for s in scale):warnings.append({"node":node["id"],"field":"scale","reason":"Nonzero scale values select dimensions; their magnitude does not normalize CVs"})
   if "pdl" in parsed:
    pdl=parsed["pdl"]
    if tensor_shape(pdl)!=(size,2) or any(row[1]<=row[0] for row in pdl):raise ValueError(node["id"]+": pdl requires ordered positive-period [lower,upper] bounds for every CV")
    if any(abs(row[0]+row[1])>1e-12*max(1,abs(row[0]),abs(row[1])) for row in pdl):warnings.append({"node":node["id"],"field":"pdl","reason":"This source wraps CV differences using the domain midpoint; asymmetric bounds need an explicit numerical comparison and are not assumed PLUMED-equivalent"})
   if "temp" in parsed and (type(parsed["temp"]) not in (int,float) or parsed["temp"]<=0):raise ValueError(node["id"]+": temp must be positive in K")
   if "bias_factor" in parsed and (type(parsed["bias_factor"]) not in (int,float) or parsed["bias_factor"]<=1):raise ValueError(node["id"]+": bias_factor must exceed one")
  if kind=="cv" and entry["name"]=="Volume" and semantics:
   scale=parsed.get("scale",1.0)
   if type(scale) not in (int,float) or scale==0:raise ValueError("Volume.scale must be nonzero")
 return {"status":"passed","scope":"Source-bound static dimension/index checks only; numerical, serialized and target validation not_run","warnings":warnings}
