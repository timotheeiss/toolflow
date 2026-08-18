import { parse } from "pgsql-ast-parser";

export interface ExternalReadGrant {
  schema: string;
  table: string;
}

export interface ExternalQueryAnalysis {
  normalizedRelations: string[];
  functions: string[];
  parameterCount: number;
}

export class SqlPolicyError extends Error {
  constructor(
    readonly code:
      | "INVALID_SQL"
      | "MULTIPLE_STATEMENTS"
      | "WRITE_FORBIDDEN"
      | "RELATION_FORBIDDEN"
      | "FUNCTION_FORBIDDEN"
      | "PARAMETER_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "SqlPolicyError";
  }
}

const SAFE_FUNCTIONS = new Set([
  "abs",
  "avg",
  "ceil",
  "ceiling",
  "coalesce",
  "concat",
  "count",
  "date_part",
  "date_trunc",
  "floor",
  "greatest",
  "json_agg",
  "json_build_object",
  "jsonb_agg",
  "jsonb_build_object",
  "least",
  "length",
  "lower",
  "max",
  "min",
  "nullif",
  "round",
  "substring",
  "sum",
  "trim",
  "upper",
]);

const BLOCKED_SCHEMAS = new Set(["information_schema", "pg_catalog", "pg_toast"]);
const READ_ONLY_STATEMENT_TYPES = new Set(["select", "union", "union all"]);

export function authorizeExternalRead(
  sql: string,
  parameters: readonly unknown[],
  grants: readonly ExternalReadGrant[],
): ExternalQueryAnalysis {
  let statements: unknown[];
  try {
    statements = parse(sql);
  } catch {
    throw new SqlPolicyError("INVALID_SQL", "The external query is not valid PostgreSQL SQL.");
  }
  if (statements.length !== 1) {
    throw new SqlPolicyError("MULTIPLE_STATEMENTS", "Exactly one SQL statement is required.");
  }

  const statement = statements[0];
  if (!isRecord(statement) || !READ_ONLY_STATEMENT_TYPES.has(String(statement.type))) {
    throw new SqlPolicyError("WRITE_FORBIDDEN", "Only a single read-only SELECT is allowed.");
  }

  const relations = new Set<string>();
  const functions = new Set<string>();
  visit(statement, (node) => {
    if (node.type === "table") {
      const name = node.name;
      if (isRecord(name) && typeof name.name === "string") {
        const schema = typeof name.schema === "string" ? name.schema : "public";
        if (BLOCKED_SCHEMAS.has(schema) || name.name.startsWith("pg_")) {
          throw new SqlPolicyError(
            "RELATION_FORBIDDEN",
            "PostgreSQL system catalogs are not available to apps.",
          );
        }
        relations.add(`${schema}.${name.name}`);
      }
    }
    if (node.type === "call") {
      const functionName = qualifiedName(node.function);
      if (functionName) functions.add(functionName);
    }
  });

  const allowedRelations = new Set(grants.map((grant) => `${grant.schema}.${grant.table}`));
  for (const relation of relations) {
    if (!allowedRelations.has(relation)) {
      throw new SqlPolicyError(
        "RELATION_FORBIDDEN",
        `The query references undeclared relation ${relation}.`,
      );
    }
  }
  for (const functionName of functions) {
    const [schema, name] = splitFunctionName(functionName);
    if ((schema && schema !== "pg_catalog") || !SAFE_FUNCTIONS.has(name)) {
      throw new SqlPolicyError(
        "FUNCTION_FORBIDDEN",
        `Function ${functionName} is not on Toolflow's read-only allowlist.`,
      );
    }
  }

  const parameterNumbers = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  const parameterCount = parameterNumbers.length === 0 ? 0 : Math.max(...parameterNumbers);
  if (
    parameterCount !== parameters.length ||
    parameterNumbers.some((number) => number < 1 || number > parameters.length)
  ) {
    throw new SqlPolicyError(
      "PARAMETER_MISMATCH",
      "SQL placeholders and the supplied parameter array do not match.",
    );
  }

  return {
    normalizedRelations: [...relations].sort(),
    functions: [...functions].sort(),
    parameterCount,
  };
}

function visit(value: unknown, callback: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, callback);
    return;
  }
  if (!isRecord(value)) return;
  callback(value);
  for (const child of Object.values(value)) visit(child, callback);
}

function qualifiedName(value: unknown): string | null {
  if (typeof value === "string") return value.toLowerCase();
  if (!isRecord(value) || typeof value.name !== "string") return null;
  const name = value.name.toLowerCase();
  return typeof value.schema === "string" ? `${value.schema.toLowerCase()}.${name}` : name;
}

function splitFunctionName(value: string): [string | null, string] {
  const parts = value.split(".");
  return parts.length === 2 ? [parts[0] ?? null, parts[1] ?? ""] : [null, parts[0] ?? ""];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
