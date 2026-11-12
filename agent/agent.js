// AgentVault demo agent.
// An "AI agent" process holding ONLY the agent hot key. It pays a service
// from the vault for API calls. The vault's on-chain policy decides what is
// allowed; the agent cannot exceed it even if this process is compromised.
//
// Usage: npm install && node agent.js
const { ethers } = require("ethers");
const fs = require("fs");

// load ../.env manually (no dotenv dependency)
const ENV_PATH = __dirname + "/../.env";
if (!fs.existsSync(ENV_PATH)) {
  console.error(
    "Agent failed: ../.env not found. Copy .env.example to .env and fill in " +
      "ARB_SEPOLIA_RPC, AGENT_PRIVATE_KEY, VAULT_ADDRESS and SERVICE_ADDRESS."
  );
  process.exit(1);
}
for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  // tolerate quoted values: KEY="0x..." and KEY='0x...'
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    v = v.slice(1, -1);
  }
  process.env[m[1]] = v;
}
const REQUIRED_ENV = ["ARB_SEPOLIA_RPC", "AGENT_PRIVATE_KEY", "VAULT_ADDRESS", "SERVICE_ADDRESS"];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length) {
  console.error("Agent failed: missing required variable(s) in .env: " + missingEnv.join(", "));
  process.exit(1);
}

const VAULT_ABI = [
  "function agentSpend(address token, address to, uint256 amount) external",
  "function getPolicy(address token) view returns (uint256 perTxCap, uint256 dailyCap, uint256 spentToday, bool configured)",
  "function balanceOf(address token) view returns (uint256)",
  "function frozen() view returns (bool)",
];
const ZERO = "0x0000000000000000000000000000000000000000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ARB_SEPOLIA_RPC);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  const vault = new ethers.Contract(process.env.VAULT_ADDRESS, VAULT_ABI, wallet);
  const service = process.env.SERVICE_ADDRESS;

  console.log("Agent address:  ", wallet.address);
  console.log("Vault:          ", process.env.VAULT_ADDRESS);
  const isFrozen = await vault.frozen();
  console.log("Frozen:         ", isFrozen);
  const [perTx, daily, spent, configured] = await vault.getPolicy(ZERO);
  console.log(
    `Native policy:   perTx ${ethers.formatEther(perTx)} ETH, daily ${ethers.formatEther(daily)} ETH, spent today ${ethers.formatEther(spent)} ETH`
  );
  console.log("Vault balance:  ", ethers.formatEther(await vault.balanceOf(ZERO)), "ETH\n");

  // Job 1: pay the service 0.01 ETH for an API call — inside policy, must pass.
  // Check the remaining daily allowance first: re-running the demo on a day
  // where the allowance is already spent must skip cleanly, not crash.
  const payAmount = ethers.parseEther("0.01");
  const remaining = daily > spent ? daily - spent : 0n;
  console.log("Job 1: paying service 0.01 ETH (inside policy)...");
  if (!configured) {
    console.log("  SKIPPED: no native policy is configured on the vault.");
  } else if (isFrozen) {
    console.log("  SKIPPED: the vault is frozen, the agent cannot spend.");
  } else if (remaining < payAmount) {
    console.log(
      `  SKIPPED: only ${ethers.formatEther(remaining)} ETH of the daily cap remains (spent ${ethers.formatEther(spent)} of ${ethers.formatEther(daily)} ETH today).`
    );
  } else {
    try {
      const tx1 = await vault.agentSpend(ZERO, service, payAmount);
      await tx1.wait();
      console.log("  OK, tx:", tx1.hash);
    } catch (e) {
      console.log("  REJECTED by the vault policy:", (e.shortMessage || e.message).slice(0, 140));
    }
  }

  await sleep(2000);

  // Job 2: try to pay 0.5 ETH — above the per-tx cap. The vault must reject it
  // on-chain, even though the agent's key is valid and the vault has funds.
  console.log("Job 2: attempting 0.5 ETH payment (above per-tx cap)...");
  try {
    const tx2 = await vault.agentSpend(ZERO, service, ethers.parseEther("0.5"));
    await tx2.wait();
    console.log("  UNEXPECTED: the over-cap payment went through!", tx2.hash);
  } catch (e) {
    console.log("  REJECTED by the vault policy, as designed:", (e.shortMessage || e.message).slice(0, 140));
  }

  const [, , spentAfter] = await vault.getPolicy(ZERO);
  console.log("\nSpent today after jobs:", ethers.formatEther(spentAfter), "ETH");
  console.log("Service balance:", ethers.formatEther(await provider.getBalance(service)), "ETH");
}

main().catch((e) => {
  console.error("Agent failed:", e.message);
  process.exit(1);
});
