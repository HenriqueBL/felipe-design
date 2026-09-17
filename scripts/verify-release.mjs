#!/usr/bin/env node
// Local release gate: sequential phases, stops on first failure.
// Only ONE verify:release run at a time may target the Supabase DEV
// environment (integration and e2e phases mutate shared DEV state).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const hasSmoke = Object.hasOwn(pkg.scripts, "test:smoke");

const phases = [
  { name: "unit", label: "Unit tests", command: "test" },
  { name: "lint", label: "Lint", command: "lint" },
  { name: "typecheck", label: "Typecheck", command: "typecheck" },
  { name: "build", label: "Production build", command: "build" },
  { name: "integration", label: "Integration (Supabase DEV)", command: "test:integration" },
  { name: "e2e", label: "E2E (Playwright + Supabase DEV)", command: "test:e2e" },
  { name: "smoke", label: "Production smoke", command: "test:smoke" },
];

const results = [];

function run(command) {
  const res = spawnSync(npmCmd, ["run", "--silent", command], {
    stdio: "inherit",
    shell: isWindows,
  });
  return res.status === 0;
}

let failed = false;
for (const phase of phases) {
  console.log(`\n=== [${phase.name}] ${phase.label} ===\n`);
  if (phase.name === "smoke" && !hasSmoke) {
    console.error(
      "FAIL: 'test:smoke' is not defined in package.json.\n" +
        "The production smoke suite (branch test/production-smoke: " +
        "tests/smoke/production-smoke.spec.ts, vitest.smoke.config.ts, npm run test:smoke) " +
        "has not been merged into main yet.\n" +
        "Merge it and rebase this branch. Do not substitute another suite silently."
    );
    results.push({ name: phase.name, pass: false });
    failed = true;
    break;
  }
  const pass = run(phase.command);
  results.push({ name: phase.name, pass });
  if (!pass) {
    failed = true;
    break;
  }
}

console.log("\n=== Release gate summary ===");
for (const r of results) {
  console.log(`  ${r.name.padEnd(12)} ${r.pass ? "PASS" : "FAIL"}`);
}
for (const phase of phases) {
  if (!results.find((r) => r.name === phase.name)) {
    console.log(`  ${phase.name.padEnd(12)} NOT RUN (stopped on first failure)`);
  }
}

process.exit(failed ? 1 : 0);
