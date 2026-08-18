import type { AppManifest } from "@toolflow/contracts";

type AppSchema = AppManifest["schema"];
type AppTable = AppSchema["tables"][number];
type AppColumn = AppTable["columns"][number];
type AppForeignKey = AppTable["foreignKeys"][number];

export type SchemaOperation =
  | { kind: "create_table"; table: AppTable }
  | { kind: "add_column"; table: string; column: AppColumn }
  | { kind: "create_index"; table: string; columns: string[] }
  | { kind: "add_foreign_key"; table: string; foreignKey: AppForeignKey };

export class SchemaPlanError extends Error {
  constructor(
    readonly code: "DESTRUCTIVE_CHANGE" | "INVALID_REFERENCE",
    message: string,
  ) {
    super(message);
    this.name = "SchemaPlanError";
  }
}

export function planAdditiveSchema(
  current: AppSchema | null,
  target: AppSchema,
): SchemaOperation[] {
  validateSchema(target);
  if (!current) return target.tables.map((table) => ({ kind: "create_table", table }));
  validateSchema(current);

  const operations: SchemaOperation[] = [];
  const targetTables = new Map(target.tables.map((table) => [table.name, table]));
  for (const currentTable of current.tables) {
    if (!targetTables.has(currentTable.name))
      destructive(`Table ${currentTable.name} was removed.`);
  }

  const currentTables = new Map(current.tables.map((table) => [table.name, table]));
  for (const targetTable of target.tables) {
    const currentTable = currentTables.get(targetTable.name);
    if (!currentTable) {
      operations.push({ kind: "create_table", table: targetTable });
      continue;
    }
    if (!sameStringArray(currentTable.primaryKey, targetTable.primaryKey)) {
      destructive(`Primary key for ${targetTable.name} changed.`);
    }
    const targetColumns = new Map(targetTable.columns.map((column) => [column.name, column]));
    for (const column of currentTable.columns) {
      const next = targetColumns.get(column.name);
      if (!next) destructive(`Column ${targetTable.name}.${column.name} was removed.`);
      if (JSON.stringify(column) !== JSON.stringify(next)) {
        destructive(`Column ${targetTable.name}.${column.name} changed type or constraints.`);
      }
    }
    const currentColumns = new Set(currentTable.columns.map((column) => column.name));
    for (const column of targetTable.columns) {
      if (!currentColumns.has(column.name)) {
        if (!column.nullable && column.default === undefined) {
          destructive(
            `New column ${targetTable.name}.${column.name} must be nullable or have a default.`,
          );
        }
        operations.push({ kind: "add_column", table: targetTable.name, column });
      }
    }
    const currentIndexes = new Set(currentTable.indexes.map(indexKey));
    for (const index of currentTable.indexes) {
      if (!targetTable.indexes.some((candidate) => indexKey(candidate) === indexKey(index))) {
        destructive(`Index ${targetTable.name}(${index.join(",")}) was removed.`);
      }
    }
    for (const index of targetTable.indexes) {
      if (!currentIndexes.has(indexKey(index))) {
        operations.push({ kind: "create_index", table: targetTable.name, columns: index });
      }
    }
    const currentForeignKeys = new Set(currentTable.foreignKeys.map(foreignKeyKey));
    for (const foreignKey of currentTable.foreignKeys) {
      if (
        !targetTable.foreignKeys.some(
          (candidate) => foreignKeyKey(candidate) === foreignKeyKey(foreignKey),
        )
      ) {
        destructive(`A foreign key on ${targetTable.name} was removed or changed.`);
      }
    }
    for (const foreignKey of targetTable.foreignKeys) {
      if (!currentForeignKeys.has(foreignKeyKey(foreignKey))) {
        operations.push({ kind: "add_foreign_key", table: targetTable.name, foreignKey });
      }
    }
  }
  return operations;
}

function validateSchema(schema: AppSchema): void {
  const tables = new Map(schema.tables.map((table) => [table.name, table]));
  for (const table of schema.tables) {
    const columns = new Set(table.columns.map((column) => column.name));
    for (const primary of table.primaryKey) {
      if (!columns.has(primary))
        invalid(`${table.name}.${primary} is not a declared primary-key column.`);
    }
    for (const index of table.indexes) {
      for (const column of index) {
        if (!columns.has(column))
          invalid(`${table.name}.${column} is not a declared index column.`);
      }
    }
    for (const foreignKey of table.foreignKeys) {
      if (foreignKey.columns.length !== foreignKey.referencedColumns.length) {
        invalid(`Foreign key on ${table.name} has mismatched column counts.`);
      }
      const referenced = tables.get(foreignKey.referencedTable);
      if (!referenced) invalid(`Foreign key on ${table.name} references an undeclared table.`);
      const referencedColumns = new Set(referenced.columns.map((column) => column.name));
      for (const column of foreignKey.columns) {
        if (!columns.has(column))
          invalid(`${table.name}.${column} is not a declared foreign-key column.`);
      }
      for (const column of foreignKey.referencedColumns) {
        if (!referencedColumns.has(column)) {
          invalid(`${foreignKey.referencedTable}.${column} is not a declared referenced column.`);
        }
      }
    }
  }
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function indexKey(columns: string[]) {
  return columns.join("\u0000");
}
function foreignKeyKey(foreignKey: AppForeignKey) {
  return JSON.stringify(foreignKey);
}
function destructive(message: string): never {
  throw new SchemaPlanError("DESTRUCTIVE_CHANGE", message);
}
function invalid(message: string): never {
  throw new SchemaPlanError("INVALID_REFERENCE", message);
}
