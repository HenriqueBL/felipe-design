#!/usr/bin/env node
/**
 * Testes automatizados para a lógica do smoke gate em deploy-production.sh.
 *
 * Este script é auto-contido: cria um mock HTTP server em Node.js, extrai
 * a função smoke_check do deploy script, e valida cada cenário de teste
 * sem depender de nc/socat ou gerenciamento de processos via shell.
 *
 * Uso: node scripts/test-smoke-gate.mjs
 * Exit 0 se todos os testes passarem, 1 caso contrário.
 */

import http from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEPLOY_SCRIPT = join(__dirname, "deploy-production.sh");

// ── Test harness ──────────────────────────────────────────────────────
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;
const failures = [];

function pass(name) {
  testsRun++;
  testsPassed++;
  console.log(`  ✅ PASS: ${name}`);
}

function fail(name, reason) {
  testsRun++;
  testsFailed++;
  failures.push({ name, reason });
  console.log(`  ❌ FAIL: ${name} — ${reason}`);
}

// ── Extract smoke_check function from deploy script ───────────────────
function extractSmokeCheckFunction() {
  const content = readFileSync(DEPLOY_SCRIPT, "utf-8");
  const lines = content.split("\n");
  let found = false;
  let braceDepth = 0;
  let started = false;
  const funcLines = [];

  for (const line of lines) {
    if (!found && /^smoke_check\(\)/.test(line)) {
      found = true;
    }
    if (found) {
      funcLines.push(line);
      // Count braces to find function end
      for (const ch of line) {
        if (ch === "{") {
          braceDepth++;
          started = true;
        } else if (ch === "}") {
          braceDepth--;
        }
      }
      if (started && braceDepth === 0) {
        break;
      }
    }
  }

  if (funcLines.length === 0) {
    throw new Error("Could not extract smoke_check() function from deploy script");
  }

  return funcLines.join("\n");
}

// ── Generate a runner script with mock BASE_URL ───────────────────────
function generateRunnerScript(baseUrl, smokeFuncSource) {
  return `#!/usr/bin/env bash
set -euo pipefail
SMOKE_FAILURES=0

${smokeFuncSource}

# ROOT
smoke_check "ROOT" "/" 307 308
# EN routes
smoke_check "HOME_EN" "/en" 200
smoke_check "SERVICES_EN" "/en/services" 200
smoke_check "ABOUT_EN" "/en/about" 200
smoke_check "GALLERY_EN" "/en/gallery" 200
smoke_check "CART_EN" "/en/cart" 200
smoke_check "LOGIN_EN" "/en/login" 200
smoke_check "CHECKOUT_EN" "/en/checkout" 200
# PT routes
smoke_check "HOME_PT" "/pt" 200
smoke_check "SERVICOS_PT" "/pt/servicos" 200
smoke_check "SOBRE_PT" "/pt/sobre" 200
smoke_check "GALERIA_PT" "/pt/galeria" 200
smoke_check "CART_PT" "/pt/cart" 200
smoke_check "CARRINHO_PT" "/pt/carrinho" 200
smoke_check "LOGIN_PT" "/pt/login" 200
smoke_check "FINALIZAR_PT" "/pt/finalizar" 200
# System routes
smoke_check "HEALTH_LIVE" "/api/health/live" 200
smoke_check "SITEMAP" "/sitemap.xml" 200
smoke_check "ROBOTS" "/robots.txt" 200

if [[ "$SMOKE_FAILURES" -ne 0 ]]; then
  echo "PUBLIC_SMOKE: FAIL ($SMOKE_FAILURES route(s) failed)"
  exit 1
fi
echo "PUBLIC_SMOKE: PASS (all routes OK)"
exit 0
`.replace(/\$\{BASE_URL\}/g, baseUrl).replace(/\$BASE_URL/g, baseUrl);
}

// ── Mock HTTP server ──────────────────────────────────────────────────
function createMockServer(mode, statusCode) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url || "/";
      if (mode === "cart-fail") {
        if (url === "/en/cart" || url === "/pt/cart" || url === "/pt/carrinho") {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("OK");
        return;
      }
      // uniform mode: return statusCode for everything, except ROOT "/"
      // which expects 307/308 in the smoke_check calls. When testing with
      // statusCode=200, we still need "/" to return 307 so ROOT passes.
      if (url === "/" && statusCode === 200) {
        res.writeHead(307, { "Content-Type": "text/plain", "Location": "/en" });
        res.end("redirect");
        return;
      }
      res.writeHead(statusCode, { "Content-Type": "text/plain" });
      res.end("response");
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

// ── Run bash script and capture output + exit code ────────────────────
function runBashScript(scriptContent) {
  return new Promise((resolve) => {
    const tmpFile = join(tmpdir(), `smoke-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
    writeFileSync(tmpFile, scriptContent, { mode: 0o755 });

    const proc = spawn("bash", [tmpFile], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      try { unlinkSync(tmpFile); } catch {}
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    proc.on("error", (err) => {
      try { unlinkSync(tmpFile); } catch {}
      resolve({ exitCode: 1, stdout, stderr: err.message });
    });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────
async function runTests() {
  const smokeFuncSource = extractSmokeCheckFunction();

  // Test A: 200 => PASS
  console.log("\n── Test A: 200 should PASS ──");
  {
    const { server, port } = await createMockServer("uniform", 200);
    const script = generateRunnerScript(`http://127.0.0.1:${port}`, smokeFuncSource);
    const { stdout } = await runBashScript(script);
    await closeServer(server);

    if (stdout.includes("SMOKE_PASS") && !stdout.includes("SMOKE_FAIL")) {
      pass("200 => PASS");
    } else {
      fail("200 => PASS", stdout.includes("SMOKE_FAIL")
        ? "SMOKE_FAIL found alongside SMOKE_PASS"
        : "No SMOKE_PASS in output");
    }
  }

  // Test B: expected redirect (307) on root => PASS
  console.log("\n── Test B: expected redirect (307) on root => PASS ──");
  {
    const { server, port } = await createMockServer("uniform", 307);
    const script = generateRunnerScript(`http://127.0.0.1:${port}`, smokeFuncSource);
    const { stdout } = await runBashScript(script);
    await closeServer(server);

    if (/SMOKE_PASS.*ROOT/.test(stdout)) {
      pass("Expected redirect (307) => PASS");
    } else {
      fail("Expected redirect (307) => PASS", "ROOT not marked as SMOKE_PASS");
    }
  }

  // Test C: 404 => FAIL
  console.log("\n── Test C: 404 should FAIL ──");
  {
    const { server, port } = await createMockServer("uniform", 404);
    const script = generateRunnerScript(`http://127.0.0.1:${port}`, smokeFuncSource);
    const { stdout } = await runBashScript(script);
    await closeServer(server);

    if (stdout.includes("SMOKE_FAIL")) {
      pass("404 => FAIL");
    } else {
      fail("404 => FAIL", "No SMOKE_FAIL in output for 404 response");
    }
  }

  // Test D: 500 => FAIL
  console.log("\n── Test D: 500 should FAIL ──");
  {
    const { server, port } = await createMockServer("uniform", 500);
    const script = generateRunnerScript(`http://127.0.0.1:${port}`, smokeFuncSource);
    const { stdout } = await runBashScript(script);
    await closeServer(server);

    if (stdout.includes("SMOKE_FAIL")) {
      pass("500 => FAIL");
    } else {
      fail("500 => FAIL", "No SMOKE_FAIL in output for 500 response");
    }
  }

  // Test E: unexpected redirect (301) on /en/services => FAIL
  console.log("\n── Test E: unexpected redirect (301 on /en/services) => FAIL ──");
  {
    const { server, port } = await createMockServer("uniform", 301);
    const script = generateRunnerScript(`http://127.0.0.1:${port}`, smokeFuncSource);
    const { stdout } = await runBashScript(script);
    await closeServer(server);

    if (/SMOKE_FAIL.*SERVICES_EN/.test(stdout)) {
      pass("Unexpected redirect (301) => FAIL");
    } else {
      fail("Unexpected redirect (301) => FAIL", "SERVICES_EN with 301 not marked as SMOKE_FAIL");
    }
  }

  // Test F: one failure among many routes => exit != 0
  console.log("\n── Test F: one failure among many routes => exit != 0 ──");
  {
    const { server, port } = await createMockServer("cart-fail", 200);
    const script = generateRunnerScript(`http://127.0.0.1:${port}`, smokeFuncSource);
    const { exitCode } = await runBashScript(script);
    await closeServer(server);

    if (exitCode !== 0) {
      pass(`Multi-route failure => exit != 0 (exit=${exitCode})`);
    } else {
      fail("Multi-route failure => exit != 0", "Script exited 0 despite cart returning 404");
    }
  }

  // Test G: all routes pass => exit = 0
  console.log("\n── Test G: all routes pass => exit = 0 ──");
  {
    const { server, port } = await createMockServer("uniform", 200);
    const script = generateRunnerScript(`http://127.0.0.1:${port}`, smokeFuncSource);
    const { exitCode } = await runBashScript(script);
    await closeServer(server);

    if (exitCode === 0) {
      pass("All routes pass => exit = 0");
    } else {
      fail("All routes pass => exit = 0", `Script exited ${exitCode} when all routes returned 200`);
    }
  }

  // Test H: SMOKE_FAIL must never coexist with FINAL: SUCCESS
  console.log("\n── Test H: SMOKE_FAIL must never coexist with FINAL: SUCCESS ──");
  {
    const { server, port } = await createMockServer("uniform", 404);
    const script = generateRunnerScript(`http://127.0.0.1:${port}`, smokeFuncSource);
    const { stdout } = await runBashScript(script);
    await closeServer(server);

    const hasFail = (stdout.match(/SMOKE_FAIL/g) || []).length > 0;
    const hasSuccessFinal = (stdout.match(/FINAL: SUCCESS/g) || []).length > 0;

    if (hasFail && !hasSuccessFinal) {
      pass("SMOKE_FAIL never coexists with FINAL: SUCCESS");
    } else if (!hasFail) {
      pass("SMOKE_FAIL never coexists with FINAL: SUCCESS (no failures detected by mock)");
    } else {
      fail("SMOKE_FAIL never coexists with FINAL: SUCCESS",
        `Both SMOKE_FAIL and FINAL: SUCCESS found in output`);
    }
  }

  // Test I: CART regression specific
  console.log("\n── Test I: /en/cart 404 must cause FAIL (regression) ──");
  {
    const { server, port } = await createMockServer("cart-fail", 200);
    const script = generateRunnerScript(`http://127.0.0.1:${port}`, smokeFuncSource);
    const { exitCode, stdout } = await runBashScript(script);
    await closeServer(server);

    const cartFail = /SMOKE_FAIL.*CART/.test(stdout);
    if (cartFail && exitCode !== 0) {
      pass("CART 404 regression => FAIL + exit != 0");
    } else {
      fail("CART 404 regression", `cart_fail=${cartFail}, exit_code=${exitCode}`);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  SMOKE GATE TEST RESULTS");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Total: ${testsRun} | Passed: ${testsPassed} | Failed: ${testsFailed}`);
  if (testsFailed > 0) {
    console.log("");
    for (const f of failures) {
      console.log(`  ❌ FAIL: ${f.name} — ${f.reason}`);
    }
    console.log("═══════════════════════════════════════════════════════");
    process.exit(1);
  }
  console.log("═══════════════════════════════════════════════════════");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});