// Dashboard tests for AgentVault. No dependencies; run with:
//   node dashboard/dashboard.test.mjs
// The tests extract the real fmtEth/rpc functions from dashboard/index.html
// (never a copy) and exercise them, and assert the deployed copy in
// site/index.html stays identical to the dashboard source.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dashPath = path.join(HERE, "index.html");
const sitePath = path.join(HERE, "..", "site", "index.html");
const html = fs.readFileSync(dashPath, "utf8");

function extractFn(name, pattern) {
  const m = html.match(pattern);
  assert(m, `${name} not found in dashboard/index.html`);
  return m[0];
}

// --- 1. fmtEth: exact ETH formatting, including sub-micro amounts ---------
const fmtEthSrc = extractFn("fmtEth", /function fmtEth\(h\)\{[\s\S]*?\n\}/);
const fmtEth = eval(fmtEthSrc + "; fmtEth;");
const fmtCases = [
  ["0x2386f26fc10000", "0.01"], // demo per-tx cap
  ["0x58d15e17628000", "0.025"], // demo daily cap
  ["0x8e1bc9bf040000", "0.04"], // live vault balance at audit time
  ["0x16345785d8a0000", "0.1"],
  ["0x14d1120d7b160000", "1.5"],
  ["0x0", "0"],
  ["0x1", "0.000000000000000001"], // 1 wei: used to display as "0"
  ["0x5f68", "0.000000000000024424"], // 24424 wei: used to display as "0"
  ["0x12d68", "0.00000000000007716"], // 77160 wei: 7+ decimal places, no truncation
];
for (const [hex, want] of fmtCases) {
  assert.equal(fmtEth(hex), want, `fmtEth(${hex})`);
}
console.log(`fmtEth: ${fmtCases.length}/${fmtCases.length} exact`);

// --- 2. rpc: a hanging first RPC must fall through to the second ----------
const rpcSrc = extractFn("rpc", /async function rpc\(method, params\)\{[\s\S]*?\n\}/);
const hang = http.createServer(() => {}); // accepts, never responds
const good = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1234" }));
  });
});
await new Promise((r) => hang.listen(18721, "127.0.0.1", r));
await new Promise((r) => good.listen(18722, "127.0.0.1", r));
try {
  const runRpc = eval(
    `(async () => { const RPCS = ["http://127.0.0.1:18721", "http://127.0.0.1:18722"]; ${rpcSrc} return await rpc("eth_blockNumber", []); })`,
  );
  const started = Date.now();
  const out = await runRpc();
  const took = Date.now() - started;
  assert.equal(out, "0x1234", "rpc falls back to the second RPC");
  assert(took < 30000, `rpc fallback took ${took}ms, expected < 30s`);
  console.log(`rpc fallback: ok in ${took}ms (hanging first RPC skipped)`);

  // All RPCs failing must throw (no silent fake data).
  const runRpcDead = eval(
    `(async () => { const RPCS = ["http://127.0.0.1:18729"]; ${rpcSrc} return await rpc("eth_blockNumber", []); })`,
  );
  await assert.rejects(runRpcDead, "rpc throws when every RPC fails");
  console.log("rpc all-failed: throws as expected");
} finally {
  hang.close();
  good.close();
}

// --- 3. The deployed copy must stay identical to the dashboard source -----
assert.equal(
  fs.readFileSync(sitePath, "utf8"),
  html,
  "site/index.html drifted from dashboard/index.html; copy it over after editing",
);
console.log("site/index.html: identical to dashboard/index.html");

console.log("dashboard tests: ALL PASS");
