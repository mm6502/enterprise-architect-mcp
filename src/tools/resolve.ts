import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "../database.js";
import type { ModelAccess } from "../model-session.js";
import { READ_ONLY } from "./annotations.js";
import { z } from "zod";
import { buildPackagePath } from "../package-path.js";
import { foldText } from "../text.js";

interface ResolveCandidate {
  type: "element" | "diagram" | "package";
  id: number;
  name: string;
  match: "exact" | "prefix" | "guid";
  fullPackagePath: string;
  eaGuid: string | null;
  objectType?: string;
}

function isBracedGuid(ref: string): boolean {
  return /^\{[^}]+\}$/.test(ref.trim());
}

function resolveByGuid(db: Database, guid: string, kind?: string): ResolveCandidate[] {
  const candidates: ResolveCandidate[] = [];

  if (!kind || kind === "element") {
    const rows = db.prepare(
      "SELECT Object_ID, Object_Type, Name, Package_ID, ea_guid FROM t_object WHERE ea_guid = ? COLLATE NOCASE"
    ).all(guid) as any[];
    for (const r of rows) {
      candidates.push({
        type: "element", id: r.Object_ID, name: r.Name,
        match: "guid",
        fullPackagePath: buildPackagePath(db, r.Package_ID),
        eaGuid: r.ea_guid, objectType: r.Object_Type,
      });
    }
  }

  if (!kind || kind === "diagram") {
    const rows = db.prepare(
      "SELECT Diagram_ID, Name, Package_ID, ea_guid FROM t_diagram WHERE ea_guid = ? COLLATE NOCASE"
    ).all(guid) as any[];
    for (const r of rows) {
      candidates.push({
        type: "diagram", id: r.Diagram_ID, name: r.Name,
        match: "guid",
        fullPackagePath: buildPackagePath(db, r.Package_ID),
        eaGuid: r.ea_guid,
      });
    }
  }

  if (!kind || kind === "package") {
    const rows = db.prepare(
      "SELECT Package_ID, Name, Parent_ID, ea_guid FROM t_package WHERE ea_guid = ? COLLATE NOCASE"
    ).all(guid) as any[];
    for (const r of rows) {
      candidates.push({
        type: "package", id: r.Package_ID, name: r.Name,
        match: "guid",
        fullPackagePath: buildPackagePath(db, r.Package_ID),
        eaGuid: r.ea_guid,
      });
    }
  }

  return candidates;
}

function resolveByName(db: Database, name: string, kind?: string): ResolveCandidate[] {
  const folded = foldText(name);
  const prefix = `${folded}:`;
  const exactCandidates: ResolveCandidate[] = [];
  const prefixCandidates: ResolveCandidate[] = [];

  const addCandidate = (
    candidateName: string,
    createCandidate: () => Omit<ResolveCandidate, "match">
  ) => {
    const foldedCandidate = foldText(candidateName);
    const match = foldedCandidate === folded
      ? "exact"
      : foldedCandidate.startsWith(prefix)
        ? "prefix"
        : undefined;

    if (match) {
      (match === "exact" ? exactCandidates : prefixCandidates).push({
        ...createCandidate(),
        match,
      });
    }
  };

  if (!kind || kind === "element") {
    const rows = db.prepare(
      "SELECT Object_ID, Object_Type, Name, Package_ID, ea_guid FROM t_object"
    ).all() as any[];
    for (const r of rows) {
      addCandidate(r.Name || "", () => ({
        type: "element", id: r.Object_ID, name: r.Name,
        fullPackagePath: buildPackagePath(db, r.Package_ID),
        eaGuid: r.ea_guid, objectType: r.Object_Type,
      }));
    }
  }

  if (!kind || kind === "diagram") {
    const rows = db.prepare(
      "SELECT Diagram_ID, Name, Package_ID, ea_guid FROM t_diagram"
    ).all() as any[];
    for (const r of rows) {
      addCandidate(r.Name || "", () => ({
        type: "diagram", id: r.Diagram_ID, name: r.Name,
        fullPackagePath: buildPackagePath(db, r.Package_ID),
        eaGuid: r.ea_guid,
      }));
    }
  }

  if (!kind || kind === "package") {
    const rows = db.prepare(
      "SELECT Package_ID, Name, Parent_ID, ea_guid FROM t_package"
    ).all() as any[];
    for (const r of rows) {
      addCandidate(r.Name || "", () => ({
        type: "package", id: r.Package_ID, name: r.Name,
        fullPackagePath: buildPackagePath(db, r.Package_ID),
        eaGuid: r.ea_guid,
      }));
    }
  }

  return exactCandidates.length > 0 ? exactCandidates : prefixCandidates;
}

export function configureResolveTools(server: McpServer, model: ModelAccess): void {
  server.tool(
    "ea_resolve",
    "Resolve an analyst reference (braced GUID or plain name) to model candidates: the input is echoed as `reference` and the hits are in `candidates`. A braced GUID is matched exactly. A plain name is matched against the full name first; only if nothing matches exactly is the reference retried as a name prefix, which resolves analyst codes like UC_ABC_2079 or OA_ABC_2280 to elements named 'CODE: description'. An exact hit is returned alone and is never diluted by prefix hits. Each candidate reports its `type` (element, diagram, package), `id`, `name`, `fullPackagePath`, `eaGuid`, and a `match` field that is always present with value \"guid\", \"exact\", or \"prefix\" — a \"prefix\" candidate is an inexact match and must not be treated as a confirmed identity. Use the optional `kind` filter to narrow results.",
    {
      reference: z.string().describe("The reference to resolve: a braced GUID like {ABC-123} or a plain name"),
      kind: z
        .enum(["element", "diagram", "package"])
        .optional()
        .describe("Filter candidates to a specific kind"),
    },
    READ_ONLY,
    async ({ reference, kind }) => {
      const db = await model.database();
      try {
        let candidates: ResolveCandidate[];

        if (isBracedGuid(reference)) {
          candidates = resolveByGuid(db, reference.trim(), kind);
        } else {
          candidates = resolveByName(db, reference.trim(), kind);
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              reference,
              candidates,
              totalMatched: candidates.length,
              returned: candidates.length,
              truncated: false,
              _meta: { sourceTables: ["t_object", "t_diagram", "t_package"] },
            }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error resolving reference: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
