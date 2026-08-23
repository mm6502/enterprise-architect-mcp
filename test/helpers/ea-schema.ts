/**
 * The subset of the Enterprise Architect schema the server reads, as one DDL script.
 *
 * Both fixtures — the unit-test model and the eval model — create their tables from
 * here. They differ in data on purpose; a difference in table shape would mean a tool
 * passes one and fails the other for a reason that has nothing to do with the tool.
 *
 * Column names, types and quoting mirror a real `.qea` export, including the awkward
 * parts: `"Default"` and `"Constraint"` are SQL reserved words, and the tables carry
 * no foreign keys because the export has none.
 */
export const EA_SCHEMA = `
  CREATE TABLE t_package (
    Package_ID INTEGER PRIMARY KEY,
    Name TEXT,
    Parent_ID INTEGER DEFAULT 0,
    ea_guid TEXT,
    TPos INTEGER DEFAULT 0
  );

  CREATE TABLE t_object (
    Object_ID INTEGER PRIMARY KEY,
    Object_Type TEXT,
    Name TEXT,
    Alias TEXT,
    Stereotype TEXT,
    Package_ID INTEGER,
    Note TEXT,
    Status TEXT,
    Author TEXT,
    CreatedDate TEXT,
    ModifiedDate TEXT,
    Phase TEXT,
    Complexity TEXT,
    ea_guid TEXT
  );

  CREATE TABLE t_attribute (
    ID INTEGER PRIMARY KEY,
    Object_ID INTEGER,
    Name TEXT,
    Type TEXT,
    Scope TEXT,
    Stereotype TEXT,
    Notes TEXT,
    LowerBound TEXT,
    UpperBound TEXT,
    "Default" TEXT,
    Pos INTEGER,
    ea_guid TEXT
  );

  CREATE TABLE t_operation (
    OperationID INTEGER PRIMARY KEY,
    Object_ID INTEGER,
    Name TEXT,
    Type TEXT,
    Scope TEXT,
    Stereotype TEXT,
    Notes TEXT,
    Pos INTEGER,
    ea_guid TEXT
  );

  CREATE TABLE t_operationparams (
    OperationID INTEGER,
    Name TEXT,
    Type TEXT,
    Kind TEXT,
    Notes TEXT,
    Pos INTEGER
  );

  CREATE TABLE t_connector (
    Connector_ID INTEGER PRIMARY KEY,
    Connector_Type TEXT,
    SubType TEXT,
    Name TEXT,
    Direction TEXT,
    Stereotype TEXT,
    Notes TEXT,
    SourceCard TEXT,
    DestCard TEXT,
    Start_Object_ID INTEGER,
    End_Object_ID INTEGER,
    SourceRole TEXT,
    DestRole TEXT,
    StyleEx TEXT
  );

  CREATE TABLE t_diagram (
    Diagram_ID INTEGER PRIMARY KEY,
    Name TEXT,
    Diagram_Type TEXT,
    Package_ID INTEGER,
    Notes TEXT,
    ea_guid TEXT
  );

  CREATE TABLE t_diagramobjects (
    Diagram_ID INTEGER,
    Object_ID INTEGER,
    Sequence INTEGER
  );

  CREATE TABLE t_diagramlinks (
    DiagramID INTEGER,
    ConnectorID INTEGER,
    Hidden INTEGER DEFAULT 0
  );

  CREATE TABLE t_objectscenarios (
    Object_ID INTEGER,
    Scenario TEXT,
    ScenarioType TEXT,
    XMLContent TEXT,
    Notes TEXT,
    ea_guid TEXT
  );

  CREATE TABLE t_objectconstraint (
    Object_ID INTEGER,
    "Constraint" TEXT,
    ConstraintType TEXT,
    Weight REAL DEFAULT 0,
    Notes TEXT,
    Status TEXT
  );

  CREATE UNIQUE INDEX uq_attribute_eaguid ON t_attribute(ea_guid);
  CREATE UNIQUE INDEX uq_operation_eaguid ON t_operation(ea_guid);
`;

/** Every table the server may read. Used to check a fixture seeds all of them. */
export const EA_TABLES = [
  "t_package",
  "t_object",
  "t_attribute",
  "t_operation",
  "t_operationparams",
  "t_connector",
  "t_diagram",
  "t_diagramobjects",
  "t_diagramlinks",
  "t_objectscenarios",
  "t_objectconstraint",
] as const;
