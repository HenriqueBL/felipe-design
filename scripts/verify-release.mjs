#!/usr/bin/env node
// Local release gate: sequential phases, stops on first failure.
// Only ONE verify:release run at a time may target the Supabase DEV
// environment (integration and e2e phases mutate shared DEV state).

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";

const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const hasSmoke = Object.hasOwn(pkg.scripts, "test:smoke");

const SMOKE_PORT = Number(process.env.SMOKE_PORT ?? 3199);
const SMOKE_BASE_URL = `http://127.0.0.1:${SMOKE_PORT}`;

function portAvailable(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

function httpReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      fetch(`${url}/en`)
        .then((res) => resolve(res.ok || res.status >= 300))
        .catch(() => {
          if (Date.now() >= deadline) resolve(false);
          else setTimeout(attempt, 500);
        });
    };
    attempt();
  });
}

async function startSmokeServer() {
  if (!existsSync(new URL("../.next/BUILD_ID", import.meta.url))) {
    throw new Error("No production build found at .next — the build phase must run before smoke.");
  }
  if (!(await portAvailable(SMOKE_PORT))) {
    throw new Error(`Port ${SMOKE_PORT} is busy; the gate must own its server exclusively.`);
  }
  const child = spawn(npmCmd, ["run", "--silent", "start", "--", "-p", String(SMOKE_PORT), "-H", "127.0.0.1"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWindows,
    env: { ...process.env },
  });
  const log = [];
  const tag = (buf) => {
    for (const line of buf.toString().split("\n")) {
      if (line.trim()) log.push(`[smoke-server] ${line.trim()}`);
    }
  };
  child.stdout.on("data", tag);
  child.stderr.on("data", tag);
  const ready = await httpReady(SMOKE_BASE_URL, 90_000);
  if (!ready) {
    stopTree(child);
    throw new Error(`Smoke server did not become ready at ${SMOKE_BASE_URL} within 90s.\n${log.slice(-20).join("\n")}`);
  }
  return { child, log };
}

function stopTree(child) {
  if (child.exitCode !== null) return;
  if (isWindows) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
  } else {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 5000);
  }
}

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

async function runSmoke() {
  if (!hasSmoke) {
    console.error(
      "FAIL: 'test:smoke' is not defined in package.json.\n" +
        "The production smoke suite (branch test/production-smoke: " +
        "tests/smoke/production-smoke.spec.ts, vitest.smoke.config.ts, npm run test:smoke) " +
        "has not been merged into main yet.\n" +
        "Merge the production-smoke branch into main, then merge origin/main into this branch. " +
        "Do not substitute another suite silently."
    );
    return false;
  }
  let server;
  try {
    server = await startSmokeServer();
    const res = spawnSync(npmCmd, ["run", "--silent", "test:smoke"], {
      stdio: "inherit",
      shell: isWindows,
      env: { ...process.env, SMOKE_BASE_URL },
    });
    if (res.error) throw res.error;
    return res.status === 0;
  } finally {
    if (server) {
      console.log(`\nStopping smoke server (pid ${server.child.pid})...`);
      stopTree(server.child);
    }
  }
}

let failed = false;
for (const phase of phases) {
  console.log(`\n=== [${phase.name}] ${phase.label} ===\n`);
  const pass = phase.name === "smoke"
    ? await runSmoke()
    : run(phase.command);
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
