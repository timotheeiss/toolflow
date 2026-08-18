const sensitiveKeyPattern =
  /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|connection[-_]?uri|private[-_]?key)/i;

const maximumDepth = 12;

export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > maximumDepth) return "[TRUNCATED]";
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      sensitiveKeyPattern.test(key) ? "[REDACTED]" : redact(entryValue, depth + 1, seen),
    ]),
  );
}
