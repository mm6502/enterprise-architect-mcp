import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "../database.js";
import type { ModelAccess } from "../model-session.js";
import { READ_ONLY } from "./annotations.js";
import { z } from "zod";

const MAX_PACKAGES = 200;

interface PackageNode {
  id: number;
  name: string;
  parentId: number;
  elementCount: number;
  children?: PackageNode[];
}

export function configurePackageTools(server: McpServer, model: ModelAccess): void {
  server.tool(
    "ea_get_package_tree",
    "Navigate the package hierarchy. Without parameters, returns top-level `packages`. With a `packageId`, returns that package's children up to the specified depth. Each node carries `id`, `name`, `parentId`, and `elementCount`.",
    {
      packageId: z.coerce.number().optional().describe("Package ID to get children of. Omit for top-level packages."),
      depth: z.coerce.number().default(1).describe("How many levels deep to recurse (max 3, default 1)"),
    },
    READ_ONLY,
    async ({ packageId, depth }) => {
      const db = await model.database();
      try {
        const effectiveDepth = Math.min(depth, 3);
        const parentId = packageId ?? 0;

        // Verify package exists when a specific ID is requested
        if (packageId != null && packageId !== 0) {
          const pkgExists = db.prepare("SELECT Package_ID FROM t_package WHERE Package_ID = ?").get(packageId);
          if (!pkgExists) {
            return {
              content: [{ type: "text", text: JSON.stringify({ error: "not_found", message: `Package with ID ${packageId} not found`, packageId }, null, 2) }],
              isError: true,
            };
          }
        }

        let totalCount = 0;

        function getChildren(pid: number, currentDepth: number): PackageNode[] {
          if (currentDepth <= 0 || totalCount >= MAX_PACKAGES) return [];

          const packages = db.prepare(`
            SELECT p.Package_ID, p.Name, p.Parent_ID
            FROM t_package p
            WHERE p.Parent_ID = ?
            ORDER BY p.TPos, p.Name
          `).all(pid) as any[];

          const result: PackageNode[] = [];
          for (const pkg of packages) {
            if (totalCount >= MAX_PACKAGES) break;
            totalCount++;

            const countRow = db.prepare(
              "SELECT COUNT(*) as cnt FROM t_object WHERE Package_ID = ?"
            ).get(pkg.Package_ID) as any;

            const node: PackageNode = {
              id: pkg.Package_ID,
              name: pkg.Name,
              parentId: pkg.Parent_ID,
              elementCount: countRow.cnt,
            };

            if (currentDepth > 1) {
              const children = getChildren(pkg.Package_ID, currentDepth - 1);
              if (children.length > 0) {
                node.children = children;
              }
            }

            result.push(node);
          }

          return result;
        }

        const tree = getChildren(parentId, effectiveDepth);

        const truncated = totalCount >= MAX_PACKAGES;
        const response: any = {
          packages: tree,
          totalMatched: totalCount,
          returned: tree.length,
          truncated,
          _meta: { sourceTables: ["t_package", "t_object"] },
        };
        if (truncated) {
          response.message = `Results truncated at ${MAX_PACKAGES} packages. Use a specific packageId to drill deeper.`;
          response.continuation = { tool: "ea_get_package_tree", arguments: { packageId: parentId, depth: effectiveDepth } };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error retrieving package tree: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
