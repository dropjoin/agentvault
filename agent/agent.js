// AgentVault demo agent.
// An "AI agent" process holding ONLY the agent hot key. It pays a service
// from the vault for API calls. The vault's on-chain policy decides what is
// allowed; the agent cannot exceed it even if this process is compromised.
//
// Usage: npm install && node agent.js
const { ethers } = require("ethers");
const fs = require("fs");

// load ../.env manually (no dotenv dependency)
for (const line of fs.readFileSync(__dirname + "/../.env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
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
  console.log("Frozen:         ", await vault.frozen());
  const [perTx, daily, spent] = await vault.getPolicy(ZERO);
  console.log(
    `Native policy:   perTx ${ethers.formatEther(perTx)} ETH, daily ${ethers.formatEther(daily)} ETH, spent today ${ethers.formatEther(spent)} ETH`
  );
  console.log("Vault balance:  ", ethers.formatEther(await vault.balanceOf(ZERO)), "ETH\n");

  // Job 1: pay the service 0.01 ETH for an API call — inside policy, must pass.
  console.log("Job 1: paying service 0.01 ETH (inside policy)...");
  const tx1 = await vault.agentSpend(ZERO, service, ethers.parseEther("0.01"));
  await tx1.wait();
  console.log("  OK, tx:", tx1.hash);

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
