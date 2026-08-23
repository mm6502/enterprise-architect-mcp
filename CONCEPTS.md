# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Enterprise Architect domain

### QEA file

A Sparx Enterprise Architect model export in SQLite format (`.qea` extension). Contains the full analysis model — packages, elements, connectors, diagrams, scenarios — as relational tables (`t_object`, `t_package`, `t_connector`, etc.). The MCP server opens it read-only.

### EA model

The analysis model stored in a QEA file. Represents business analysis artifacts — use cases, requirements, screens, classes, domain model elements — and their relationships. The server exposes it through `ea_*` MCP tools.

### Element

A named entity in the EA model (use case, class, requirement, screen, component, interface). Stored in `t_object`. Elements belong to packages and connect to each other through connectors.

### Connector

A typed relationship between two elements — Realisation, Dependency, Association, Generalization, etc. Stored in `t_connector`. Direction matters: each connector has a source and target element.

### Feature link

A connector end attached to a specific attribute or operation rather than to the element as a whole. EA records it in `t_connector.StyleEx` as `LFSP=<guid>L;` (source end) and `LFEP=<guid>R;` (target end). This is what makes an arrow mean "this field maps to that field" rather than "these two elements are related".

### Diagram

A named view placing elements and connectors on a canvas. Stored in `t_diagram`; membership in `t_diagramobjects` (elements) and `t_diagramlinks` (connectors). Analysts use diagrams as specifications — a mapping diagram is authoritative about which source field fills which target field.

### Constraint

A rule attached to an element, stored in `t_objectconstraint` with a type of `Pre-condition`, `Post-condition`, `Invariant`, or `Process`. Use case scenario steps reference constraints by name, so a step often cannot be acted on without them. `Process` constraints are where named business rules — logging, validation, calculation — are specified.

### Scenario

A use case flow describing a sequence of steps. Each use case element can have a basic path, alternate paths, and exception paths. Steps are stored as XML in the element's scenario data.
