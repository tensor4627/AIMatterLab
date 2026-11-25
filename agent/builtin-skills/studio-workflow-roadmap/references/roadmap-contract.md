# Roadmap shape and example

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
