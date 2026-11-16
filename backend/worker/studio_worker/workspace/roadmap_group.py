"""Bind a saved versioned tool-group recipe to a conversation's resource IDs."""
import json
from studio_worker.workspace.group_contract import group_version
from studio_worker.workspace.roadmap_tools import TOOLS, file_identity


ALIASES = {"gpumd.md":{"run-in":"control","model-xyz":"structure","dump-xyz":"trajectory","thermo-out":"thermodynamics"}}


def bind_group(graph, bundle):
    ref = graph.get("tool_group")
    if ref is None and bundle is None:
        return {}
    if not ref or not bundle or group_version(bundle["definition_text"]) != ref["version"]:
        raise ValueError("Exact registered group definition required")
    definition = json.loads(bundle["definition_text"])
    nodes = {node["id"]:node for node in graph["steps"]}
    features = bundle["features"]
    if (definition["id"]!=ref["id"] or set(nodes)!={step["id"] for step in definition["steps"]}
            or set(nodes)!=set(features)):
        raise ValueError("Frozen group and graph invocations differ")

    def resource(step_id, side, name):
        node = nodes[step_id]
        port = ALIASES.get(node["tool"],{}).get(name,name)
        matches = [b["resource"] for b in node[side] if b["port"]==port]
        if len(matches)!=1:
            raise ValueError("Frozen group port is missing in graph: "+step_id+"."+name)
        return matches[0]

    bound = {}
    for step in definition["steps"]:
        key=step["id"]
        feature=features[key]
        tool=nodes[key]["tool"]
        if (feature["package_version"]!=step["package_version"] or feature["engine"]!=tool or tool not in TOOLS):
            raise ValueError("Group package or engine differs from frozen invocation")
        if tool=="gpumd.md":
            matches = feature["command"]==["{executable:gpumd}"]
        else:
            files=TOOLS[tool]["files"]
            matches=(tool=="trajectory.density" and feature["command"]==["{python}","-I","{entrypoint}"]
                     and feature["entrypoint_sha256"]==file_identity(files["density-analysis.py"])["sha256"])
        if not matches:
            raise ValueError("The saved group operation has no equivalent registered executable adapter")
        for port, source in step["inputs"].items():
            rid=resource(key,"inputs",port)
            if "input_id" in source:
                matches = rid==source["input_id"] and rid in graph["inputs"]
            elif "step_id" in source:
                matches = rid==resource(source["step_id"],"outputs",source["port_id"])
            else:
                matches=False
            if not matches:
                raise ValueError("Frozen group input binding differs: "+key+"."+port)
        bound[key]={"tool_id":step["tool_id"],"function_id":step["function_id"],**feature,"depends_on":step.get("depends_on",[])}
    for output in definition["outputs"]:
        if resource(output["step_id"],"outputs",output["port_id"]) not in graph["outputs"]:
            raise ValueError("Missing frozen group deliverable: "+output["id"])
    return bound
