---
name: studio-workflow-roadmap
description: Plan a conversation-owned AIMatterLab calculation backwards from its requested products, identify inputs to confirm or supply, and save the tool invocations and artifact handoffs in the task roadmap.
---

# Plan from deliverables

1. Translate the request into observable products. For “run MD”, trajectory frames and thermodynamic samples are candidate outputs. Identify which are requested, what quantities, units, interval and time range matter, and whether files must be retained. An explicit choice or a delegated choice settles the corresponding ambiguity. Keep inferred choices visible for confirmation.
2. For each product, identify the invocation and output port that can provide it. Read the chosen tool/function I/O declaration, `describe_engine`, the applicable execution guidance and existing task inputs as available. For a registered tool group, follow its frozen port bindings and exact versions. An ordering-only `depends_on` has no artifact to connect. Check format, units, cell/atom identity, model loader, sampling cadence or another constraint when it matters for that consumer.
3. Walk each required port backwards to an existing user input or another output. Reuse the same resource ID for every consumer of the same artifact. Use separate resources for changed versions, replicas and conversions. A repeated tool invocation has its own step ID. A potential or bias called at every MD step belongs inside that MD invocation, while an independent training, export or bias build produces a normal file handoff. Describe optional in-process components on the top/bottom runtime ports only when the selected interface establishes them.
4. Bind each initial input to a real editable parameter using `field` and the corresponding form field, with null or an empty list for a missing value. Distinguish supplied facts from guesses. Ask about unresolved physical choices and missing user-owned inputs together, within the current delegation. A resource can lack a producer in a partial draft. Keep the open end visible and update the same task as answers arrive.
5. Use the optional top-level `roadmap` of `present_task` when advertised by the connected service. Keep actual engine inputs in `parameters`, the editable form in `steps`, and its outstanding fields in `missing_fields`. A parameter-only update may omit the roadmap. Update the full graph when goals or handoffs change. On an older service, preserve the form and describe the plan in the conversation.

## Stored shape

When the advertised schema supports `short_label`, give every input, intermediate, requested output and tool invocation a concise display name. Keep the full descriptive name in `label` for hover and detail. Prefer a familiar domain abbreviation or a few words in the user's language. Distinguish repeated steps or similarly named files in this graph. For in-process modules, keep the registered identity in `runtime`. Provide `short_label` under the matching `runtime_labels.top` or `runtime_labels.bottom`. Include a descriptive `label` there when the runtime identity is a technical identifier.

`schema_version` is 1. `resources` declares each stable ID, human label, optional format, and for a boundary its `basis` (`user` for supplied, confirmed or explicitly delegated intent, `inferred` for a proposal). Record observable product or input conditions in its optional `requirements` list, including requested fields, units, intervals or time range. Bind the corresponding settings in the actual engine control input before execution. A bound parameter value can still be missing. `inputs` and `outputs` are initial and requested resource ID lists. A step has an ID, tool/function identity, label and arrays of `{port,resource}` bindings. Its optional `runtime.top` and `runtime.bottom` name components sharing that invocation. Never put credentials, job state or private file contents into a label.

```json
{
  "schema_version": 1,
  "resources": [
    {"id":"system","label":"Initial atomic structure","short_label":"Structure","format":"extxyz","field":"structure_file","basis":"user"},
    {"id":"potential","label":"Neuroevolution potential file","short_label":"NEP","field":"potential_file","basis":"user"},
    {"id":"control","label":"MD control file","short_label":"MD controls","field":"control_file","basis":"inferred"},
    {"id":"frames","label":"Molecular dynamics trajectory frames","short_label":"Trajectory","format":"extxyz","basis":"inferred"},
    {"id":"thermo","label":"Thermodynamic series","short_label":"Thermo","requirements":["Temperature in K"],"checks":[{"requirement":"Temperature in K","fact":"fields","op":"contains","value":"temperature_K"}],"basis":"inferred"}
  ],
  "inputs":["system","potential","control"],
  "steps":[{"id":"md-1","tool":"gpumd.md","label":"Molecular dynamics sampling","short_label":"MD",
    "inputs":[{"port":"structure","resource":"system"},{"port":"potential","resource":"potential"},{"port":"control","resource":"control"}],
    "outputs":[{"port":"trajectory","resource":"frames"},{"port":"thermodynamics","resource":"thermo"}]}],
  "outputs":["frames","thermo"]
}
```

The example uses one MD invocation. Replace its ports, input bindings and outputs with the selected mode's actual contract and recording settings. On a task with a shared `parameters.files` list, bind a resource with `"field":"files","file_name":"run.in"` to resolve one exact basename across edits and reordering. Ambiguous basenames remain unresolved. For a generated control file, author it from agreed settings and bind the saved file, or model a real upstream producer. If a later analysis consumes frames, bind its input to `frames`. Keep frames among final outputs only when the user wants them delivered.

## Prepare the review and read the receipt

For a reproducible native MD run, bind initial velocities in the structure or set an explicit velocity seed before integration. A native in-process potential can be identified by the registered runtime component ID `potential`.

Preserve each original delivery requirement in its resource. For each measurable condition add a `checks` entry with the exact `requirement`, observed `fact`, comparison `op` (`eq`, `ge`, `le`, `contains`) and `value`. Surface an unmapped condition for human review. Bind a step-specific parameters object using `parameter_field`, especially when a tool is invoked twice. A saved group uses `tool_group: {id, version}` with its exact registered version, input and step IDs, functions, ports and dependencies.

| Registered local tool | Inputs | Outputs and observed facts |
| --- | --- | --- |
| `gpumd.md` | `structure`, `potential`, `control`. Bind a saved structure, a self-contained NEP3/4 or Tersoff potential, and native `run.in`. | `trajectory` reports `samples`, `atoms`, `fields`, `first_time_fs`, `last_time_fs` and, for regularly spaced frames, `interval_fs`. `thermodynamics` reports `samples`, `columns` and known `fields` such as `temperature_K`. Enable the requested dumps in the control file. |
| `trajectory.density` | Bind `trajectory` to the resource produced at the MD trajectory port. Requires timestamped extended XYZ and periodic 3D cells. | `density` (CSV) contains time, atom count, cell volume in cubic angstroms and atom number density in inverse cubic angstroms. The analysis also records a digest of the bytes it parsed. |

To add number density to the example, append a resource `number-density` and a `trajectory.density` step with input `{port:"trajectory",resource:"frames"}` and output `{port:"density",resource:"number-density"}`. Include the analysis and any requested original MD data in final outputs. For an explicit expectation of ten trajectory samples, attach `{"requirement":"10 frames","fact":"samples","op":"eq","value":10}` and include “10 frames” in the trajectory requirements.

In the parameter panel the user reviews the snapshot and confirms the whole graph. Each node uses its frozen environment, executable, parameters and inputs. Future input bytes are resolved by the frozen producer step and port after the producer exits. Read its run ID and SHA-256 alongside the consumer's input snapshot and consumption receipt. Report each goal as passed, failed, unavailable or awaiting human review. For an unknown submission inspect the existing run. For a tool outside the registered execution contracts, retain its plan and identify the missing adapter.
