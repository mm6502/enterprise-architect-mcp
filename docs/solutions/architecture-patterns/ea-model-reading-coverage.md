---
title: "What a production-scale EA export actually contains — measurements behind the reading-completeness work"
date: 2026-08-23
category: architecture-patterns
module: tools
problem_type: measurement_record
component: model-reading
severity: high
applies_when:
  - Deciding whether an EA reading tool needs paging, an index, or a cap
  - Judging whether a schema shape seen in a small export generalises
  - Reopening a decision this repository already settled by measurement
  - Building a test fixture that must stand in for a model nobody can commit
tags:
  - enterprise-architect
  - sqlite
  - measurement
  - completeness
  - search
  - schema
---

# What a production-scale EA export actually contains

## Context

The reading-completeness work was planned against an anonymous production `.qea` export of
substantial scale, queried read-only. Every design choice in it was settled by counting rows in
that file rather than by reasoning about EA in general. The export itself cannot be committed or
described, and the plan that carried these figures has been retired — so the measurements are
recorded here, each with the conclusion it supported.

The scale, for calibration:

| Dimension | Count |
| --- | --- |
| Tables | 100 |
| Elements (`t_object`) | ~70,000 |
| Connectors (`t_connector`) | ~80,000 |
| Diagrams (`t_diagram`) | ~10,000 |
| Packages (`t_package`) | ~10,000 |
| File size | ~650 MB |

## Measurements and what each one decided

### Feature links are common, and the anchor letter is not a constant

About 16,000 of the ~80,000 connectors carry an `LFSP=` or `LFEP=` token in `StyleEx`. Across
~26,000 ends, `LFSP` ends in `L` ~14,500 times and in `R` 1,176; `LFEP` ends in `R` ~9,300 times,
in `L` ~1,145, and carries no trailing letter at all 147 times.

**Decided:** the braced GUID is matched by shape and whatever trails it is discarded. Stripping a
literal `L` after `LFSP` would corrupt 1,176 GUIDs and leave 147 unmatched.

A second measurement decided the lookup form. Over 200 randomly drawn attribute GUIDs,
`ea_guid = ? COLLATE NOCASE` searches the unique index at 0.14 ms while `UPPER(ea_guid) = UPPER(?)`
falls back to a full scan at 17.12 ms — 143× slower, paid once per connector end.

**Decided:** case-insensitivity is written as a collation, never as a function on the column.

### `t_diagramlinks` is an index, not a source of truth

~107,000 connector-diagram pairs have both endpoints on a diagram. 2,723 of them (2.6%, spread over
~1,150 of the ~8,100 diagrams carrying such a pair) have no `t_diagramlinks` row — and 116 of those
diagrams have no row in that table at all. Conversely, 2,745 pairs recorded in the links table do
not have both endpoints present. 9,855 rows are flagged `Hidden = 1`.

**Decided:** the connector set for a diagram is the union of the link rows and the implied
connectors, hidden ones returned with a flag rather than filtered.

A testing note that outlived the plan: the diagram that motivated the work happened to be complete
(23 implied connectors, 23 link rows), so a single-diagram test would not have caught this.

### Character entities dominate, and `LIKE` cannot reach them

~22,000 of ~29,000 non-empty element notes (77%) and ~27,000 attribute notes store text with numeric
character entities. Separately, roughly 8,000 element names contain an uppercase Slovak diacritic, and
SQLite's `LIKE` folds case for ASCII only.

**Decided:** search matches over text the server has decoded and folded in JavaScript, not over the
column as stored. Neither half can be expressed in SQL — `upper()` does not reach `Ľ`, and the
decoded form exists nowhere in the file.

The cost of not doing this was measured over eight representative queries: the `LIKE` implementation
returned the correct count **zero times** — 148 of ~7,400 for one term, 0 of 151 for the same term in
caps, 1,565 of 2,472 for a term typed correctly with diacritics.

### Structural escapes are content, and decoding them destroys it

The markup census over all ~29,000 non-empty element notes and ~34,000 attribute notes found 4,050
notes using `<li>`, 3,838 `<ul>`, 321 `<ol>`, and **not one** `<table>`, `<img>`, `<div>`, `<span>`
or script tag. `&lt;` and `&gt;` are used for UML stereotype notation and for operators inside
specification text.

**Decided:** decode character entities, keep structural escapes escaped, keep the markup, and
declare the field's type.

### Link targets cannot be classified by enumeration

A census of every anchor target in element and attribute notes returned 2,230 `$element`, **234
bare `https`**, 97 UNC, 83 `$inet`, 35 `$diagram`, 18 `$feature`, 18 `$package`, 18 with no scheme,
10 bare `http`, 4 `file` and 4 `$matrix`.

**Decided:** four schemes are model-internal and everything else is external by default. The single
most common external form is one an enumerated list built from the obvious cases does not name.

### Caps: measured, not assumed

- Of ~16,000 elements carrying attributes, **17** exceed 50; the largest holds 170. Of ~5,450
  carrying operations, **one** exceeds 50, holding 1,104. Medians are 3 and 2.
  **Decided:** raise the inline cap, add no paging parameter — it would exist for 18 elements
  out of ~70,000.
- Element notes: median 150 characters, p99 2,614, longest 24,353; 9.0 MB in total, two above
  16 kB, none above 64 kB. Scenario text tops out at 206, constraint notes 3,894, attribute
  notes 16,053.
  **Decided:** no paging shape for long text. The only text truncation is the search preview,
  which carries an explicit flag.
- The heaviest diagram payload, assembled in full rather than estimated, is 137 kB — and payload
  follows note text rather than connector count, since a 250-connector diagram serialised smaller
  than a 114-connector one.
  **Decided:** the connector list on a diagram is returned whole.

### Duplicate names make a name alone useless

~800 diagram names, ~1,100 package names and ~7,600 element names are duplicated.

**Decided:** every result that names a package carries the full path, and the resolver returns
ranked candidates rather than a single answer.

### The dotted path is recoverable by matching, not by splitting

1,308 package names contain a dot of their own, and only 493 of those are a numbering form a
splitter could learn. But a resolver that walks the tree and admits a child whose name is a prefix
of the unconsumed remainder recovered the true node in **800 of 800** inverted cases, uniquely in
78.1%. Of 154 ambiguous diagram paths in a 500-diagram sample, 152 hold exactly one diagram.

**Decided:** the path form is admitted, resolved by matching against real names. The earlier
conclusion that no rule could reach it was correct about the facts and wrong about what followed
from them — it assumed the resolver must split on the separator.

### Scenario steps lose cross-references, not just tidiness

Across 4,721 scenarios the model records 16,861 steps. `link` carries a target GUID on **1,262**
steps; `uses` names another use case on 273; `useslist` carries matching GUIDs on 204; `result` on
142; `state` is populated nowhere; `trigger` is present on every step. `t_objectscenarios.Notes` —
168 rows, 425 kB, longest 11,868 characters — was named in the tool's own `SELECT` and never
reached the response.

1,081 elements carry two or more scenarios and one carries 19.

**Decided:** return every step attribute; number steps within a scenario rather than within an
element; a bare *step N* against a multi-scenario element returns all matching steps.

Worth recording: the column-coverage metric scored this the *narrowest* gap in the server at 43%
unreturned. The proportion of unreturned columns did not predict the value of what was lost.

### Constraints belong to the element

The model holds 3,783 constraint rows: 2,117 pre-conditions, 1,169 post-conditions, 279 invariants,
210 of type `Process` — where named business rules live — and 8 in rarer variants. **161 elements
carry 304 constraint rows and have no scenario at all.**

**Decided:** constraints hang on the element tool, not the scenario tool. Attaching them to
scenarios was the obvious placement and would have answered "none found" for content that exists.

### The rowid alias test that `pk > 0` gets wrong

Of 100 tables, only 24 have the single-column `INTEGER` primary key that aliases the rowid; 45 have
a single-column key of another declared type, 22 a composite key, and 9 none. `PRAGMA index_list`
returns 223 indexes across the 100 tables.

**Decided:** the rowid alias is reported only where exactly one column carries `pk > 0` *and* its
declared type is `INTEGER`, compared case-insensitively. Testing `pk > 0` alone would announce a
non-existent fast path on 67 of the 91 keyed tables.

### Column coverage is uniformly narrow

Returned columns against source table width: connectors 17 of 79, search 10 of 57, element 14 of 57
plus 9 of 27 and 6 of 27, diagram elements 6 of 29, package tree 3 of 23 — between 67% and 87%
unreturned in every case, with only scenarios lower at 4 of 7.

**Decided:** the source-table declaration binds every tool with no carve-out for narrow reads. A
rule discriminating by width would have to draw its line inside a band the data shows no gap in.

### Search substrate: the trade, at the scope actually adopted

Both arms built over identical text — element name and note plus scenario text, constraint notes,
and attribute and operation names and notes, ~234,000 entries — each in its own process, memory
sampled after a forced collection, the pair run twice in alternating order:

| Substrate | Build | Resident | Median query |
| --- | --- | --- | --- |
| Folded corpus in memory | 1,413 / 1,861 ms | 172.0 / 171.8 MB | 25.5 / 44.8 ms |
| Temp `fts5` trigram index | 6,349 / 9,062 ms | 165.7 / 168.8 MB | 4.1 / 10.1 ms |

Both returned identical hit counts on every term, including ten arranged as with-and-without-diacritic
pairs of the same Slovak word.

**Decided:** the folded corpus, built lazily on first search. Three things were expected to decide
this and none survived measurement — memory came out at parity, semantics came out identical, and
the index needs no sidecar file (`CREATE VIRTUAL TABLE` against the export fails read-only, but the
same statement against `temp` succeeds). What remains is one trade: the index pays for itself after
**208 to 231 searches in a single process**, against sessions that run to tens. That observed
number, not a projection, is the trigger to switch.

Two findings recorded so a future switch does not rediscover them: the *trigram* tokenizer is
required rather than FTS5 generally — the ordinary tokenizer matches token prefixes, loses four to
five hits per term and returns 0 of 168 for an infix — and the trigram tokenizer silently returns
zero for terms shorter than three characters, so a scan fallback below that length is part of the
work.

Two rejected variants, on their results rather than on principle: a folding function called from
SQL is semantically identical and costs a median 333 ms against 41 ms, because the fold is
recomputed per row per query and `EXPLAIN QUERY PLAN` reports a scan even when the function is
declared deterministic; and substituting a wildcard for every accentable letter fails twice over —
`_` cannot match an entity-encoded diacritic (losing 1,063 of 1,401 matches on notes), and since
Slovak accents 14 of 26 letters the pattern degenerates to seven consecutive wildcards returning
~63,000 of ~70,000 rows.

### Slovak ordering cannot be done in SQL at all

`'A' = 'a' COLLATE NOCASE` is true; `'Č' = 'č'`, `'Š' = 'š'`, `'Ľ' = 'ľ'` and `'Ž' = 'ž'` are all
false. There is no `CREATE COLLATION` statement — the form is a syntax error, not an unsupported
feature — `node:sqlite` exposes no collation registration, and ICU is not compiled into the shipped
build. Binary collation puts every accented initial after `Z`, affecting ~2,570 element names and
~400 package names (3.9% and 3.8%).

**Decided:** don't order enumeration by name at all. `ea_search`, `ea_list_elements` and
`ea_list_diagrams` order by storage identity, because these tools return a *window* and any
alphabetical cut selects against accented initials rather than merely reordering them: measured
across the packages that truncate, accented initials held 1.3% of visible slots under binary
ordering and 2.0% under collation, against 3.0% under identity order and 3.9% model-wide. The
artificiality is stated in each tool description so no agent reads meaning into adjacency.

Retrieval-time collation with `Intl.Collator` — measured at 0.71–1.53 ms per 500 names, locale from
`EA_LOCALE` with the host default, since the export does not record its language — survives only in
`ea_get_scenarios`, where the whole set is returned and truncation cannot happen. That boundary is
the point: collation is a presentation choice when everything is shown and a selection bias when it
is not.

### Tagged values are not worth a typed tool

`t_objectproperties` holds ~387,000 rows, overwhelmingly profile machinery. Property names that read
as prose account for ~9,700 rows, about 2.5%; admitting single-word Slovak names brings it to roughly
3.4%. On connectors the analyst share is 436 of ~95,000, or 0.5%. The named ones are `Owner` (1,620
populated of 2,284 rows), `Stav` (1,429 of 2,289), `Typ` (1,196 of 1,198).

**Decided:** deferred — and the deferral is safe precisely because the analyst-authored set is
small and nameable, so the filter is cheap when a need arrives.

## Method notes worth keeping

Three of these measurements were wrong on the first pass, and each failure is a reusable warning.

- **A probe needs a control arm.** The feature-link census first reported 0.2% resolution for
  undrawn connectors, which reads as evidence that their links are stale. The control arm —
  connectors that are certainly live — returned 0.4%, which located the fault in the probe rather
  than in the data. It had left the trailing anchor letter inside the lookup key.
- **Do not join columns with a NUL for SQL-side matching.** SQLite's `LIKE`, `GLOB` and `length()`
  all stop at an embedded NUL even though the bytes are stored whole. The value is present, the
  index sees it, and the comparison does not — answers come back short and confident.
- **Measure substrates in separate processes, at the same record shape.** The first substrate
  benchmark compared arms at different record shapes and its memory column carried that difference
  rather than the substrates'. The re-run in identical processes over identical text reversed the
  conclusion the memory figures had supported.
- **Table coverage is computed from an explicit list, not by searching prose for table names.** The
  first attempt reported `t_objectscenarios` as uncovered, which is false — the document discussed
  it only through the name of the tool that reads it.

## Related

- [docs/solutions/design-patterns/like-relevance-ranking-over-fts5.md](../design-patterns/like-relevance-ranking-over-fts5.md)
- [docs/solutions/design-patterns/mcp-tool-inline-detail-with-truncation.md](../design-patterns/mcp-tool-inline-detail-with-truncation.md)
- [docs/solutions/architecture-patterns/mcp-server-readonly-sqlite-architecture.md](mcp-server-readonly-sqlite-architecture.md)
- `test/helpers/ea-schema.ts` — the schema the fixtures reproduce; compare it against a real export
  whenever one is at hand.
