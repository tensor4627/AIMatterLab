---
name: studio-cv-bias-planning
description: Turn a scientific CV/bias request into actual pyGAS library composition and source-backed parameter forms, using PLUMED examples only after checking semantics; discuss a formula before creating a missing custom CV.
---

# Library-first CV and bias planning

1. Define the requested observable from the structure, topology or scientific question. For implementation, use `inspect_pygas_catalog(source_id="pygas")` and exact class names to check the registered CV, Bias, Switch and Neighbor sources. Start with a suitable existing composition or an approved revision in the user's library.
2. Wire Neighbor → CV → optional switch or reduction → ordered fixed-size collector → bias or CV-only output. Check the real signatures, shapes, index convention, units and periodic domain. Choose a scientifically justified group or reduction before turning per-atom values into scalars. A zero-dimensional scalar needs an explicit length-one adapter for the collector.
3. If using a PLUMED example, check the corresponding implementation's formula, index base, PBC, domain, normalization and units. Read only the `plumed.json` and `pygas.json` documents offered on the current route.
4. Publish actual library names and structured constructor values with provenance. Distinguish source defaults, measured or derived values, user choices and pilot proposals. Use structured module references. Display the intended observable, ordered atoms or groups, reduction, units, domain and bias family first.
5. Use `render_pygas_workflow` with the existing `studioTaskId`. On updates pass the canonical graph path, exact graph/source CAS receipt and current catalog files. Re-read a conflicting revision and reconcile manual edits. Keep the graph and generated source paired. A rendered graph is authoring evidence. The serialized artifact needs an actual reload and checks on the authorized target. An explicitly selected AOTI or dual format requires compatible target preflight without backend fallback.

For a paper design of fixed umbrella sampling or WTMetaD, use `sampling.enhanced-plan` and read the matching focused document, [fixed umbrella and tagged coordination](references/umbrella.md) or [well-tempered metadynamics](references/wtmetad.md). For implementation use the matching `pygas.bias` or `sampling.gpumd` route and its registered-source guidance. Use `analysis.wtmetad` for the corresponding reweighting contract.

When offered on the current route, read [composition details](references/composition-details.md) for mapping hazards, parameter defaults, tensor shapes and bias history. For workflow file and compiler mechanics use `workflow.authoring` and its pyGAS graph reference.

## When a CV is missing

For a missing or non-equivalent observable, use `pygas.custom-cv`. Explain the mathematical definition, units, atom groups, periodicity and the observed gap in the catalog. A discussion can end here. For a requested private primitive, read [custom definition and numerical review](references/custom-review.md) by its advertised document ID on that route. `propose_custom_cv` saves a typed formula draft in the current conversation. This tool never approves, generates implementation code, checks numerics or executes. Follow the human formula and code reviews and the selected revision's numerical check before reusing it.
