import ts from "typescript";

interface Position {
  line: number;
  column: number;
}

export interface FunctionRange {
  loc: { start: Position; end: Position };
}

interface FunctionCoverage {
  fnMap: Record<string, FunctionRange>;
  f: Record<string, number>;
}

type NodeHits = readonly (readonly [FunctionRange, number])[];

const location = ({ loc: { start, end } }: FunctionRange) =>
  `${start.line}:${start.column}-${end.line}:${end.column}`;

/** Credit positive Node calls to functions already counted by the browser report. */
export function attributeFunctionCoverage(
  path: string,
  source: string,
  report: FunctionCoverage,
  browser: Iterable<FunctionRange>,
  nodeScripts: Iterable<NodeHits>,
): number {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const lineStarts = file.getLineStarts();
  const functions = new Map<number, { start: number; end: number }[]>();
  function visit(node: ts.Node): void {
    if (ts.isFunctionLike(node) && "body" in node && node.body) {
      const start = node.getStart(file);
      const starts = [start];
      if (ts.isArrowFunction(node) && node.parameters[0]) {
        const firstParameter = node.parameters[0].getStart(file);
        if (source.slice(start, firstParameter) === "(")
          starts.push(firstParameter);
      }
      for (const position of starts) {
        const entries = functions.get(position) ?? [];
        entries.push({ start, end: node.end });
        functions.set(position, entries);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);

  function identity({ loc }: FunctionRange): string | undefined {
    const offset = ({ line, column }: Position) => {
      const start = lineStarts[line - 1];
      const next = lineStarts[line] ?? source.length + 1;
      if (start !== undefined && column >= 0 && start + column < next)
        return start + column;
    };
    const start = offset(loc.start);
    const end = offset(loc.end);
    if (start === undefined || end === undefined || end <= start) return;
    const candidates = functions.get(start)?.filter(
      (fn) =>
        fn.end === end ||
        // One transform can map through the immediately following delimiter.
        (fn.end + 1 === end && /[;,\s]/.test(source[fn.end] ?? "")),
    );
    if (candidates?.length === 1) return `${candidates[0]!.start}:${end}`;
  }

  const browserLocations = new Set(Array.from(browser, location));
  const reported = new Map<string, string[]>();
  for (const [id, range] of Object.entries(report.fnMap)) {
    if (!browserLocations.has(location(range))) continue;
    const key = identity(range);
    if (!key) continue;
    const ids = reported.get(key) ?? [];
    ids.push(id);
    reported.set(key, ids);
  }

  const hits = new Map<string, number>();
  for (const script of nodeScripts) {
    const unique = new Map<string, number>();
    for (const [range, count] of script) {
      const key = identity(range);
      if (key) unique.set(key, unique.has(key) ? 0 : count);
    }
    for (const [key, count] of unique)
      if (count > 0) hits.set(key, Math.max(hits.get(key) ?? 0, count));
  }

  let credited = 0;
  for (const [key, ids] of reported) {
    const id = ids[0]!;
    const count = hits.get(key);
    if (ids.length !== 1 || report.f[id] !== 0 || !count) continue;
    report.f[id] = count;
    credited++;
  }
  return credited;
}
