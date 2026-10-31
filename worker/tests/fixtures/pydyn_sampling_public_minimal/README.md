These fixtures preserve selected public PyDyn contract method and field bodies from the source revision recorded in `contracts.json`. Relative module names and original source/excerpt hashes describe provenance; the fixture wrappers are deliberately incomplete and must never be imported or executed.

The protocol tests decode the JSON strings into an isolated temporary registered source, record synthetic observations, and exercise only the AST reader. JSON escaping preserves original UTF-8/CRLF excerpt bytes independently of checkout line-ending rules. The synthetic receipt is test evidence only, not a real environment probe or scientific result.

The fixture contains no scientific driver, model, dataset, runtime receipt, environment registration, user identity or machine-specific path. A few unadvertised public methods are retained solely to prove that source presence does not grant arbitrary selector access.
