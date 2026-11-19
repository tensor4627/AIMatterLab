# Generated from contracts/workflows/roadmap.schema.json by sync-tool-contracts.mjs.
import json

ROADMAP_SCHEMA = json.loads(r'''{
  "$id": "studio.workflow-roadmap/1",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "resources", "inputs", "steps", "outputs"],
  "properties": {
    "schema_version": {"type": "integer", "const": 1},
    "tool_group":{"type":"object","additionalProperties":false,"required":["id","version"],"properties":{
      "id":{"type":"string","pattern":"^[a-z][a-z0-9.-]{0,95}$"},"version":{"type":"string","pattern":"^[a-f0-9]{64}$"}
    },"description":"Optional exact saved AIMatterLab tool-group version instantiated by these step IDs."},
    "resources": {
      "type": "array", "maxItems": 256,
      "items": {
        "type": "object", "additionalProperties": false, "required": ["id", "label"],
        "properties": {
          "id": {"type": "string", "pattern": "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$"},
          "label": {"type": "string", "pattern": "\\S", "maxLength": 160},
          "short_label": {"type":"string","pattern":"^\\S(?:[^\\r\\n]*\\S)?$","maxLength":16,"description":"Compact display name for this resource. Keep its full name in label."},
          "format": {"type": "string", "pattern": "\\S", "maxLength": 80},
          "requirements": {"type": "array", "maxItems": 12, "items": {"type": "string", "pattern": "\\S", "maxLength": 240}, "description": "Observable requirements for this resource, such as fields, units, sampling interval or time coverage."},
          "checks": {"type":"array","maxItems":48,"items":{"type":"object","additionalProperties":false,"required":["requirement","fact","op","value"],"properties":{
            "requirement":{"type":"string","minLength":1,"maxLength":240},"fact":{"type":"string","pattern":"^[a-z][a-z0-9_]{0,63}$"},
            "op":{"type":"string","enum":["eq","ge","le","contains"]},"value":{"type":["number","string"],"maxLength":160}
          }},"description":"Checks against observed output facts, linked to the exact original requirement text."},
          "field": {"type": "string", "maxLength": 200, "description": "Existing task parameter dot path for an initial input."},
          "file_name": {"type": "string", "pattern": "^[^/\\\\\\u0000-\\u001f]+$", "maxLength": 255, "description": "Select one exact basename from the bound file field or files list."},
          "basis": {"type": "string", "enum": ["user", "inferred"], "description": "User-specified or inferred initial input / requested deliverable. An omitted basis at a boundary is unconfirmed."}
        }
      }
    },
    "inputs": {"type": "array", "maxItems": 256, "items": {"type": "string", "maxLength": 64}, "description": "Initial resource IDs."},
    "steps": {
      "type": "array", "maxItems": 80,
      "items": {
        "type": "object", "additionalProperties": false, "required": ["id", "tool", "label", "inputs", "outputs"],
        "properties": {
          "id": {"type": "string", "pattern": "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$"},
          "tool": {"type": "string", "pattern": "\\S", "maxLength": 160},
          "parameter_field":{"type":"string","maxLength":200,"description":"Optional dot path into the task form containing this invocation's engine parameters."},
          "label": {"type": "string", "pattern": "\\S", "maxLength": 160},
          "short_label": {"type":"string","pattern":"^\\S(?:[^\\r\\n]*\\S)?$","maxLength":16,"description":"Compact display name for this invocation. Keep its full name in label."},
          "runtime_labels": {"type":"object","additionalProperties":false,"description":"Display names for the corresponding runtime ports. An omitted full label uses the original runtime name.","properties":{
            "top":{"type":"object","additionalProperties":false,"required":["short_label"],"properties":{"short_label":{"type":"string","pattern":"^\\S(?:[^\\r\\n]*\\S)?$","maxLength":16},"label":{"type":"string","pattern":"\\S","maxLength":160}}},
            "bottom":{"type":"object","additionalProperties":false,"required":["short_label"],"properties":{"short_label":{"type":"string","pattern":"^\\S(?:[^\\r\\n]*\\S)?$","maxLength":16},"label":{"type":"string","pattern":"\\S","maxLength":160}}}
          }},
          "inputs": {"type": "array", "maxItems": 64, "items": {
            "type": "object", "additionalProperties": false, "required": ["port", "resource"],
            "properties": {"port": {"type": "string", "pattern": "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$"}, "resource": {"type": "string", "maxLength": 64}}
          }},
          "outputs": {"type": "array", "maxItems": 64, "items": {
            "type": "object", "additionalProperties": false, "required": ["port", "resource"],
            "properties": {"port": {"type": "string", "pattern": "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$"}, "resource": {"type": "string", "maxLength": 64}}
          }},
          "runtime": {"type": "object", "additionalProperties": false, "description": "Named in-process components of this invocation, attached at its top/bottom midpoint.",
            "properties": {"top": {"type": "string", "pattern": "\\S", "maxLength": 120}, "bottom": {"type": "string", "pattern": "\\S", "maxLength": 120}}
          }
        }
      }
    },
    "outputs": {"type": "array", "maxItems": 256, "items": {"type": "string", "maxLength": 64}, "description": "Requested final resource IDs, in user-facing order."}
  }
}''')
