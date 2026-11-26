import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { attributeFunctionCoverage } from "./lib/coverage-function-attribution.js";

// Use c8's own options, source maps, reporters and threshold check. Its V8
// converter omits anonymous functions from the function table. The same
// function can be named by Vite and anonymous in the Node/tsx transform.
const require = createRequire(import.meta.url);
const c8 = createRequire(require.resolve("c8"));
const { buildYargs } = c8("./lib/parse-args.js");
const { checkCoverages } = c8("./lib/commands/check-coverage.js");
const toIstanbul = c8("v8-to-istanbul");
const args = buildYargs().parse(["report", ...process.argv.slice(2)]);
if (args["100"]) {
  Object.assign(args, {
    checkCoverage: true,
    lines: 100,
    functions: 100,
    branches: 100,
    statements: 100,
  });
}
const report = require("c8").Report({
  ...args,
  reportsDirectory: args.reportsDir,
  reporter: Array.isArray(args.reporter) ? args.reporter : [args.reporter],
});

// Retain the merged input already read by the pinned c8 report. The ordinary
// coverage map remains authoritative for all source filters and report rows.
const merge = report._getMergedProcessCov.bind(report);
const mergeAsync = report._getMergedProcessCovAsync.bind(report);
let scripts;
report._getMergedProcessCov = () => {
  const merged = merge();
  scripts = merged.result;
  return merged;
};
report._getMergedProcessCovAsync = async () => {
  const merged = await mergeAsync();
  scripts = merged.result;
  return merged;
};
const coverage = await report.getCoverageMapFromAllCoverageFiles();
report._getMergedProcessCov = merge;
report._getMergedProcessCovAsync = mergeAsync;

const sourcesByPath = new Map();
function originalSource(path) {
  if (!sourcesByPath.has(path)) sourcesByPath.set(path, readFile(path, "utf8"));
  return sourcesByPath.get(path);
}

async function mapFunctions(script, functions) {
  const sources = report._getSourceMap(script);
  const originals = sources?.sourceMap?.sourcemap.sourcesContent;
  if (!originals?.length || !sources.source) return {};
  const converter = toIstanbul(
    resolve(report.resolve, script.url),
    report.wrapperLength,
    sources,
    (path) => !report._shouldInstrument(path),
  );
  await converter.load();
  converter.applyCoverage(functions);
  const current = {};
  for (const [path, file] of Object.entries(converter.toIstanbul())) {
    if (coverage.data[path] && originals.includes(await originalSource(path)))
      current[path] = file;
  }
  return current;
}

const fromBrowser = (script) =>
  /^browser-[a-f0-9]{64}\.js$/.test(basename(script.url));
const candidates = new Map();
for (const script of scripts.filter(fromBrowser)) {
  const mapped = await mapFunctions(script, script.functions);
  for (const [path, browserFile] of Object.entries(mapped)) {
    if (
      !coverage.data[path] ||
      !Object.values(coverage.data[path].f).includes(0)
    )
      continue;
    const candidate = candidates.get(path) ?? { browser: [], node: [] };
    candidate.browser.push(...Object.values(browserFile.fnMap));
    candidates.set(path, candidate);
  }
}

for (const script of scripts) {
  if (!candidates.has(script.url) || fromBrowser(script)) continue;
  const anonymous = script.functions.filter(
    ({ functionName, ranges }) => !functionName && ranges[0]?.startOffset > 0,
  );
  if (!anonymous.length) continue;
  const mapped = await mapFunctions(
    script,
    anonymous.map(({ ranges, isBlockCoverage }, index) => ({
      functionName: String(index),
      ranges: [ranges[0]],
      isBlockCoverage,
    })),
  );
  for (const [path, nodeFile] of Object.entries(mapped)) {
    const candidate = candidates.get(path);
    if (!candidate) continue;
    candidate.node.push(
      Object.values(nodeFile.fnMap).map((entry) => [
        entry,
        anonymous[Number(entry.name)].ranges[0].count,
      ]),
    );
  }
}

let credited = 0;
for (const [path, { browser, node }] of candidates) {
  if (!node.length) continue;
  credited += attributeFunctionCoverage(
    path,
    await originalSource(path),
    coverage.data[path],
    browser,
    node,
  );
}
console.log(
  `Coverage: credited ${credited} browser-counted functions executed in Node`,
);
await report.run();
if (args.checkCoverage) await checkCoverages(args, report);
