// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program. If not, see <https://www.gnu.org/licenses/>.

interface CoverageTotals {
  totalLines: number;
  coveredLines: number;
}

function normalizeLcov(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function parseLcov(content: string): CoverageTotals {
  let totalLines = 0;
  let coveredLines = 0;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("DA:")) {
      continue;
    }

    const [, hitsRaw] = line.slice(3).split(",");
    const hits = Number.parseInt(hitsRaw ?? "0", 10);
    totalLines += 1;
    if (Number.isFinite(hits) && hits > 0) {
      coveredLines += 1;
    }
  }

  return { totalLines, coveredLines };
}

function printUsage(): never {
  console.error(
    "Usage:\n" +
      "  deno run --allow-read --allow-write scripts/coverage.ts merge <backend-lcov> <frontend-lcov> <output>\n" +
      "  deno run --allow-read scripts/coverage.ts summary <lcov>\n" +
      "  deno run --allow-read scripts/coverage.ts gate <lcov> <threshold>",
  );
  Deno.exit(2);
}

function getLineCoveragePercent(content: string): number {
  const totals = parseLcov(content);
  if (totals.totalLines === 0) {
    console.error("No DA entries found in LCOV report.");
    Deno.exit(1);
  }
  return (totals.coveredLines / totals.totalLines) * 100;
}

if (Deno.args.length === 0) {
  printUsage();
}

const [command, ...args] = Deno.args;
if (command === "merge") {
  if (args.length !== 3) {
    printUsage();
  }
  const [backendPath, frontendPath, outputPath] = args;
  const [backendLcov, frontendLcov] = await Promise.all([
    Deno.readTextFile(backendPath),
    Deno.readTextFile(frontendPath),
  ]);
  await Deno.writeTextFile(
    outputPath,
    `${normalizeLcov(backendLcov)}${normalizeLcov(frontendLcov)}`,
  );
  console.log(`Merged LCOV report written to ${outputPath}`);
  Deno.exit(0);
}

if (command === "summary") {
  if (args.length !== 1) {
    printUsage();
  }
  const [lcovPath] = args;
  const lcov = await Deno.readTextFile(lcovPath);
  const percent = getLineCoveragePercent(lcov);
  console.log(`Combined line coverage: ${percent.toFixed(2)}%`);
  Deno.exit(0);
}

if (command === "gate") {
  if (args.length !== 2) {
    printUsage();
  }
  const [lcovPath, thresholdRaw] = args;
  const threshold = Number.parseFloat(thresholdRaw);
  if (!Number.isFinite(threshold)) {
    console.error(`Invalid threshold: ${thresholdRaw}`);
    Deno.exit(2);
  }
  const lcov = await Deno.readTextFile(lcovPath);
  const percent = getLineCoveragePercent(lcov);
  console.log(
    `Combined line coverage: ${percent.toFixed(2)}% (threshold: > ${threshold.toFixed(2)}%)`,
  );
  if (percent <= threshold) {
    console.error("Coverage gate failed.");
    Deno.exit(1);
  }
  console.log("Coverage gate passed.");
  Deno.exit(0);
}

printUsage();
