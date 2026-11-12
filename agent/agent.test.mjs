// Smoke tests for the demo agent's startup validation. No network use beyond
// a refused localhost connection, and NO transaction is ever sent: every case
// fails before any spend (missing config) or at the first read call.
// Requires: npm install (ethers) in agent/. Run with:
//   node agent/agent.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DUMMY_KEY = "0x" + "aa".repeat(32); // format-valid dummy, holds no funds
const DUMMY_VAULT = "0x" + "11".repeat(20);
const DUMMY_SERVICE = "0x" + "22".repeat(20);

function runAgent(envContents) {
  return new Promise((resolve, reject) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentvault-agent-test-"));
    try {
      const agentDir = path.join(tmp, "agent");
      fs.mkdirSync(agentDir);
      fs.copyFileSync(path.join(HERE, "agent.js"), path.join(agentDir, "agent.js"));
      fs.symlinkSync(path.join(HERE, "node_modules"), path.join(agentDir, "node_modules"));
      if (envContents !== null) fs.writeFileSync(path.join(tmp, ".env"), envContents);
      const child = spawn("node", ["agent.js"], { cwd: agentDir, timeout: 30000 });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, out }));
    } finally {
      // cleanup after the child exits is handled by the caller via tmp removal
      // in a finally below; keep tmp until close fires
      setTimeout(() => fs.rmSync(tmp, { recursive: true, force: true }), 35000);
    }
  });
}

// 1. Missing .env: clean one-line guidance, no raw stack trace.
{
  const { code, out } = await runAgent(null);
  assert.equal(code, 1, "missing .env exits 1");
  assert.match(out, /\.env not found/, "missing .env message names the file");
  assert.doesNotMatch(out, /ENOENT|at Object\.readFileSync/, "no raw stack trace");
  console.log("missing .env: clean error, exit 1");
}

// 2. Empty .env: names every missing variable.
{
  const { code, out } = await runAgent("");
  assert.equal(code, 1, "empty .env exits 1");
  for (const v of ["ARB_SEPOLIA_RPC", "AGENT_PRIVATE_KEY", "VAULT_ADDRESS", "SERVICE_ADDRESS"]) {
    assert.match(out, new RegExp(v), `names missing ${v}`);
  }
  assert.doesNotMatch(out, /invalid private key/, "no cryptic key error");
  console.log("empty .env: names all 4 missing variables");
}

// 3. Partial .env: names only the actually-missing variables.
{
  const { code, out } = await runAgent("ARB_SEPOLIA_RPC=http://127.0.0.1:9\n");
  assert.equal(code, 1, "partial .env exits 1");
  assert.match(out, /AGENT_PRIVATE_KEY/, "names missing AGENT_PRIVATE_KEY");
  assert.doesNotMatch(out, /missing required variable\(s\)[^:]*: [^\n]*ARB_SEPOLIA_RPC/, "does not list the present var as missing");
  console.log("partial .env: names only missing variables");
}

// 4. Quoted values are parsed: a quoted dummy key + dead RPC must fail at the
// network read (key accepted), not with "invalid private key", and the key
// value must never appear in output.
{
  const env = [
    'ARB_SEPOLIA_RPC="http://127.0.0.1:9"',
    `AGENT_PRIVATE_KEY="${DUMMY_KEY}"`,
    `VAULT_ADDRESS=${DUMMY_VAULT}`,
    `SERVICE_ADDRESS=${DUMMY_SERVICE}`,
  ].join("\n");
  const { code, out } = await runAgent(env);
  assert.equal(code, 1, "dead RPC exits 1");
  assert.match(out, /Agent failed:/, "fails through the normal handler");
  assert.doesNotMatch(out, /invalid private key|INVALID_ARGUMENT/, "quoted key was parsed, not rejected");
  assert.doesNotMatch(out, new RegExp(DUMMY_KEY.slice(2)), "key material never printed");
  console.log("quoted .env values: parsed; key never printed; network failure handled");
}

console.log("agent smoke tests: ALL PASS");
