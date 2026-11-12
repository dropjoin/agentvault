// Tests for the LIVE AgentVault dashboard (site-v4/index.html, deployed at
// agentvault.apeagent.online). No dependencies; run with:
//   node site-v4/site-v4.test.mjs
// The whole <script> block is executed from the real file inside a vm sandbox
// with stubbed DOM/fetch, so every assertion exercises the shipped code.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(HERE, "index.html"), "utf8");
const scriptSrc = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// ---------- vm sandbox with a stub DOM ----------
function makeEl() {
  return { textContent: "", innerHTML: "", style: {}, className: "", addEventListener() {} };
}
const els = new Map();
let fetchImpl = () => Promise.reject(new Error("network down"));
const sandbox = {
  console,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  AbortController,
  setInterval: () => 0,
  location: { search: "" },
  document: {
    getElementById: (id) => {
      if (!els.has(id)) els.set(id, makeEl());
      return els.get(id);
    },
  },
  fetch: (...a) => fetchImpl(...a),
};
sandbox.window = sandbox;
vm.createContext(sandbox);
const driver = `
;globalThis.__test = {
  fmtN, decodeLog, rowHtml, renderIds, renderActivity, shotFallback, load, SIG,
  getState: () => state,
  setState: (s) => { state = s; },
  paint,
};`;
vm.runInContext(scriptSrc + driver, sandbox);
const T = sandbox.__test;
const el = (id) => els.get(id);

// ---------- 1. fmtN: small nonzero values must not display as "0" ----------
assert.equal(T.fmtN(0.01), "0.01");
assert.equal(T.fmtN(0.04), "0.04");
assert.equal(T.fmtN(0), "0");
assert.notEqual(T.fmtN(2.4424e-14), "0", "24424 wei must not display as 0");
assert.notEqual(T.fmtN(1e-18), "0", "1 wei must not display as 0");
console.log("fmtN: demo values exact, sub-micro values nonzero");

// ---------- 2. Event signature hashes match the contract ----------
const EXPECTED_SIG = {
  "0x80198aed63dc3756c38930af4fb0785bfa85ce4885b5c13800f9b16f9072ebca": "PolicySet",
  "0x095e41ca103d85f10508048559426058ce5cc85302a9c3e0039d6f4f2c232e17": "RecipientAllowed",
  "0x8752a472e571a816aea92eec8dae9baf628e840f4929fbcc2d155e6233ff68a7": "Deposited",
  "0x8b081e10b7cfc90ba5e0ac7e512c19ecc46f6f10bf5936f6284ff979eb509f36": "AgentSpend",
  "0xbacf8f6c1ed84a94c12e881a538d4839d950546a7be9a95ff970802cafb83afe": "OwnerWithdraw",
  "0xb21f1bf0d206b43eb02be4f423c2788a95affbda226125eaecabe3def8ba5c42": "AgentChanged",
  "0x88491f03f558b4a7d86f9ae2ce70c148aa349e89d476c7c356fe05f9eeac4f25": "FrozenChanged",
  "0xb532073b38c83145e3e5135377a08bf9aab55bc0fd7c1179cd4fb995d2a5159c": "OwnerChanged",
  "0xf4e75b79500ab730f8a026ed3cba6d55331bcb64c9e9f60c548e371356e5e3c0": "OwnershipTransferProposed",
};
for (const [hash, name] of Object.entries(EXPECTED_SIG)) {
  assert.equal(T.SIG[hash], name, `SIG[${hash}]`);
}
console.log(`SIG: ${Object.keys(EXPECTED_SIG).length}/${Object.keys(EXPECTED_SIG).length} event hashes match cast keccak`);

// ---------- 3. decodeLog: real AgentSpend log + new proposal event ----------
const padAddr = (a) => "0".repeat(24) + a.replace("0x", "").toLowerCase();
const wordHex = (v) => BigInt(v).toString(16).padStart(64, "0");
const SERVICE = "0xF04D8eA360eF3097E632a67F4b9a9B11523b3Dc1";
{
  const spend = T.decodeLog({
    topics: [
      "0x8b081e10b7cfc90ba5e0ac7e512c19ecc46f6f10bf5936f6284ff979eb509f36",
      "0x" + "0".repeat(64),
      "0x" + padAddr(SERVICE),
    ],
    data: "0x" + wordHex(10n ** 16n) + wordHex(10n ** 16n),
    blockNumber: "0x13698e9b",
    transactionHash: "0x6fbe209b6096624bd3980b87c128dba244bf6005d90957e9772805c34597f75a",
  });
  assert.equal(spend.name, "AgentSpend");
  assert.equal(spend.amount, 0.01);
  assert.equal(spend.to.toLowerCase(), SERVICE.toLowerCase());
  const proposal = T.decodeLog({
    topics: [
      "0xf4e75b79500ab730f8a026ed3cba6d55331bcb64c9e9f60c548e371356e5e3c0",
      "0x" + padAddr("0x552859077c21d905708f3b0644514e6b12c21032"),
      "0x" + padAddr("0x1111111111111111111111111111111111111111"),
    ],
    data: "0x",
    blockNumber: "0x13698e9b",
    transactionHash: "0x" + "ab".repeat(32),
  });
  assert.equal(proposal.name, "OwnershipTransferProposed");
  assert.equal(proposal.newO.toLowerCase(), "0x1111111111111111111111111111111111111111");
  assert.equal(T.decodeLog({ topics: ["0x" + "00".repeat(32)], data: "0x", blockNumber: "0x1" }), null);
  console.log("decodeLog: AgentSpend + OwnershipTransferProposed + unknown-sig filtered");
}

// ---------- 4. rowHtml: tx links only for well-formed hashes ----------
{
  const good = T.rowHtml({ name: "AgentSpend", to: SERVICE, amount: 0.01, block: 1, ts: 1762183568, tx: "0x" + "ab".repeat(32) });
  assert.match(good, /sepolia\.arbiscan\.io\/tx\/0xabab/, "well-formed tx links to Arbiscan");
  const evil = T.rowHtml({ name: "AgentSpend", to: SERVICE, amount: 0.01, block: 1, ts: 1762183568, tx: 'x" onclick="alert(1)' });
  assert.doesNotMatch(evil, /onclick|alert\(1\)/, "malformed tx hash is never linkified");
  console.log("rowHtml: tx link gated on well-formed hash");
}

// ---------- 5. renderIds: status must follow the actual flags ----------
function setIdsState(patch) {
  T.setState({
    bal: 0.04, perTx: 0.01, daily: 0.025, spent: 0, frozen: false,
    owner: "0x552859077c21d905708f3b0644514e6b12c21032",
    agent: "0x282d13e8351587694dc99b568eaf0d8e9810fb6b",
    svcOk: true, polOk: true, depTotal: 0.05, paidTotal: 0.01, maxSpend: 0.01,
    events: [], firstDate: "", snapshot: false, ...patch,
  });
  T.renderIds();
  return el("ids").innerHTML;
}
{
  const okHtml = setIdsState({});
  assert.match(okHtml, /Configured/, "configured policy shows Configured");
  assert.match(okHtml, /Allowlisted · yes/, "allowlisted service shows yes");
  const badHtml = setIdsState({ polOk: false, svcOk: false });
  assert.doesNotMatch(badHtml, /Configured/, "unconfigured policy must NOT show Configured");
  assert.match(badHtml, /Not configured/, "unconfigured policy shows Not configured");
  assert.match(badHtml, /Allowlisted · no/, "removed service shows no, not loading dots");
  console.log("renderIds: Configured/allowlisted statuses follow live flags");
}

// ---------- 6. Snapshot events must be labeled snapshot, never on-chain ----------
{
  T.setState({
    bal: 0.04, perTx: 0.01, daily: 0.025, spent: 0, frozen: false,
    owner: "0x552859077c21d905708f3b0644514e6b12c21032",
    agent: "0x282d13e8351587694dc99b568eaf0d8e9810fb6b",
    svcOk: true, polOk: true, depTotal: 0.05, paidTotal: 0.01, maxSpend: 0.01,
    events: [], firstDate: "", snapshot: false,
  });
  T.shotFallback(); // paints the verified snapshot
  assert.match(el("act-count").textContent, /snapshot/i, "snapshot activity labeled snapshot");
  assert.doesNotMatch(el("act-count").textContent, /on-chain events/, "snapshot must not be called on-chain events");
  assert.match(el("sync").textContent, /snapshot/, "sync line discloses snapshot");
  console.log("snapshot labeling: fallback rows labeled snapshot, not on-chain");
}

// ---------- 7. load(): canned-RPC success, then failure keeps live state ----------
const WORD = (v) => BigInt(v).toString(16).padStart(64, "0");
function cannedFetch() {
  return async (url, opts) => {
    const body = JSON.parse(opts.body);
    const data = body.params?.[0]?.data || "";
    let result;
    if (body.method === "eth_blockNumber") result = "0x13698e9b";
    else if (body.method === "eth_getLogs") result = [];
    else if (body.method === "eth_getBlockByNumber") result = { timestamp: "0x6ae9fd10" };
    else if (data.startsWith("0x8da5cb5b")) result = "0x" + WORD("0x552859077c21d905708f3b0644514e6b12c21032");
    else if (data.startsWith("0xf5ff5c76")) result = "0x" + WORD("0x282d13e8351587694dc99b568eaf0d8e9810fb6b");
    else if (data.startsWith("0x054f7d9c")) result = "0x" + WORD(0);
    else if (data.startsWith("0x70a08231")) result = "0x" + WORD(9n * 10n ** 16n); // 0.09 ETH
    else if (data.startsWith("0x3791dc6a"))
      result = "0x" + WORD(2n * 10n ** 16n) + WORD(5n * 10n ** 16n) + WORD(5n * 10n ** 15n) + WORD(1);
    else if (data.startsWith("0xdb846026")) result = "0x" + WORD(1);
    else throw new Error("unexpected call " + body.method + " " + data);
    return { json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  };
}
{
  // The page fires one background load() at evaluation time; let it settle
  // (its stubbed fetch rejects) so the in-flight guard does not skip ours.
  await new Promise((r) => setTimeout(r, 100));
  fetchImpl = cannedFetch();
  await T.load();
  assert.equal(T.getState().bal, 0.09, "live balance painted from RPC");
  assert.equal(T.getState().perTx, 0.02, "live per-tx cap painted from RPC");
  // Now the RPC dies: live state must be kept (not overwritten by the Nov 7 snapshot).
  fetchImpl = () => Promise.reject(new Error("network down"));
  await T.load();
  assert.equal(T.getState().bal, 0.09, "failed refresh keeps last live balance");
  assert.equal(T.getState().owner.toLowerCase(), "0x552859077c21d905708f3b0644514e6b12c21032");
  assert.equal(el("readerr").style.display, "block", "error banner shown on failure");
  console.log("load(): success paints live values; later failure keeps them + shows banner");
}

// ---------- 8. rpc: hanging first RPC falls through to the second ----------
{
  const rpcSrc = scriptSrc.match(/async function rpc\(method, params\) \{[\s\S]*?\n\}/)[0];
  assert(rpcSrc, "rpc function found");
  const hang = http.createServer(() => {});
  const good = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1234" }));
    });
  });
  await new Promise((r) => hang.listen(18731, "127.0.0.1", r));
  await new Promise((r) => good.listen(18732, "127.0.0.1", r));
  try {
    const runRpc = eval(
      `(async () => { const RPCS = ["http://127.0.0.1:18731", "http://127.0.0.1:18732"]; ${rpcSrc} return await rpc("eth_blockNumber", []); })`,
    );
    const started = Date.now();
    const out = await runRpc();
    const took = Date.now() - started;
    assert.equal(out, "0x1234", "rpc falls back to the second RPC");
    assert(took < 30000, `rpc fallback took ${took}ms, expected < 30s`);
    console.log(`rpc fallback: ok in ${took}ms (hanging first RPC skipped)`);
  } finally {
    hang.close();
    good.close();
  }
}

console.log("site-v4 tests: ALL PASS");
