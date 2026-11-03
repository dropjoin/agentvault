#!/usr/bin/env bash
# Deploy AgentVault to Arbitrum Sepolia and configure the demo scenario.
# Requires: foundry (forge/cast) and a funded DEPLOYER key in .env
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
set -a; source .env; set +a
RPC="$ARB_SEPOLIA_RPC"

echo "Deployer: $DEPLOYER_ADDRESS"
BAL=$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$RPC")
echo "Deployer balance (wei): $BAL"
[ "$BAL" -gt 0 ] || { echo "ERROR: deployer has no Arbitrum Sepolia ETH yet (faucet first)"; exit 1; }

forge build --silent

BYTECODE=$(python3 -c "import json;print(json.load(open('out/AgentVault.sol/AgentVault.json'))['bytecode']['object'])")
ARGS=$(cast abi-encode "constructor(address)" "$AGENT_ADDRESS")
echo "Deploying AgentVault (agent = $AGENT_ADDRESS)..."
OUT=$(cast send --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --legacy --gas-price 100000000 --create "${BYTECODE}${ARGS#0x}" --json)
VAULT=$(echo "$OUT" | python3 -c "import json,sys;print(json.load(sys.stdin)['contractAddress'])")
echo "VAULT=$VAULT"
echo "VAULT_ADDRESS=$VAULT" >> .env

# Configure demo policy: native ETH per-tx cap 0.01, daily cap 0.025; service allowlisted.
cast send --rpc-url "$RPC" --private-key "$PRIVATE_KEY" "$VAULT" \
  "setPolicy(address,uint256,uint256)" 0x0000000000000000000000000000000000000000 \
  10000000000000000 25000000000000000 >/dev/null
echo "Policy set: native perTx 0.01 ETH, daily 0.025 ETH"
cast send --rpc-url "$RPC" --private-key "$PRIVATE_KEY" "$VAULT" \
  "setRecipientAllowed(address,bool)" "$SERVICE_ADDRESS" true >/dev/null
echo "Recipient allowlisted: $SERVICE_ADDRESS (demo service)"

# Fund the vault with 0.05 ETH and give the agent 0.01 ETH for gas.
cast send --rpc-url "$RPC" --private-key "$PRIVATE_KEY" "$VAULT" --value 50000000000000000 >/dev/null
echo "Vault funded: 0.05 ETH"
cast send --rpc-url "$RPC" --private-key "$PRIVATE_KEY" "$AGENT_ADDRESS" --value 10000000000000000 >/dev/null
echo "Agent funded for gas: 0.01 ETH"
echo "Done. Vault: $VAULT"
echo "Explorer: https://sepolia.arbiscan.io/address/$VAULT"
