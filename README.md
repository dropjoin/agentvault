# AgentVault — a policy wallet for AI agents

**Built for the Arbitrum Open House Online Buildathon.**

## The problem

Everyone wants to give an AI agent a wallet so it can pay for APIs, data, compute and services on its own. Today that means handing the agent a raw private key with unlimited access to everything in the wallet. One prompt injection, one leaked log file, one buggy loop, and the funds are gone. The alternative, a custodial account, just moves the trust problem to a company.

## The product

AgentVault is a smart-contract vault on Arbitrum that separates **owning** money from **spending** it:

- The **owner** (a human) funds the vault and sets hard on-chain rules: a per-transaction cap, a daily cap, and allowlists for tokens and recipients.
- The **agent** (a hot key held by an AI agent process) can only spend inside those rules. Every spend is checked by the contract at execution time; there is no way to exceed the policy, even with a fully compromised agent key. The worst case is bounded: at most the daily cap, only to allowlisted recipients.
- The owner can **freeze** the agent instantly and can always withdraw everything, even while frozen.

Think of it as a corporate card for an AI: the company sets the limit and the merchant categories, the employee (agent) just swipes.

## Try it (do X, see Y)

1. **Build and test the contract:** `forge build && forge test` — 9 tests cover spending inside policy, per-tx and daily cap reverts, allowlist enforcement, freeze behavior, day rollover, and access control.
2. **Deploy to Arbitrum Sepolia:** fund a deployer from any Arbitrum Sepolia faucet, copy the keys into `.env` (see `.env.example` shape in `script/deploy.sh`), run `bash script/deploy.sh`. The script deploys the vault, sets a demo policy (native ETH: 0.01 per tx, 0.025 per day), allowlists a demo service address, funds the vault with 0.05 ETH and the agent with gas money.
3. **Run the demo agent:** `cd agent && npm install && node agent.js`. The agent pays the service 0.01 ETH for an API call (succeeds, inside policy), then attempts a 0.5 ETH payment. The vault rejects it on-chain with `per-tx cap exceeded`, even though the agent key is valid and the vault holds the funds. That rejection is the product.

## How it works

- `src/AgentVault.sol` — the whole product in one audited-style contract (no external dependencies): policies per token (`address(0)` = native coin), day-indexed spend accounting, a reentrancy mutex, safe ERC20 transfer helpers, and a complete event log (`AgentSpend`, `PolicySet`, `FrozenChanged`, ...) so a dashboard or auditor can reconstruct everything the agent did.
- `agent/agent.js` — a minimal agent process holding only the agent key. It reads the policy from the chain before acting, and its over-cap attempt is rejected by the contract, not by its own code.
- Deployment network: **Arbitrum Sepolia** (testnet qualifies for the buildathon). The same contract deploys unchanged to Arbitrum One.

## Why Arbitrum

Agent spending is high-frequency and small-value: exactly the traffic an L2 with fast blocks and low fees is for. A policy check per spend only makes economic sense where a transaction costs a fraction of a cent.

## Roadmap notes

- USDG (Paxos) as the default settlement token for agent payments, once the demo moves to mainnet amounts.
- Per-recipient caps and time-windowed policies (e.g. higher caps during business hours).
- Session policies: one-time budgets granted per task, expiring automatically.

## License

MIT.
