// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentVault} from "../src/AgentVault.sol";

interface Vm {
    function warp(uint256 newTimestamp) external;
    function prank(address msgSender) external;
    function deal(address account, uint256 newBalance) external;
    function expectRevert(bytes calldata revertData) external;
}

contract MockERC20 {
    string public name = "Mock USDG";
    string public symbol = "mUSDG";
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "bal");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "bal");
        require(allowance[from][msg.sender] >= amount, "allow");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev Plain-assert tests (no forge-std dependency). Run with `forge test`.
contract AgentVaultTest {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    AgentVault vault;
    MockERC20 token;
    address owner = address(this);
    address agent = address(0xA6E7);
    address service = address(0x5E27);
    address stranger = address(0x57A9);

    function setUp() public {
        vault = new AgentVault(agent);
        token = new MockERC20();
        // fund owner with tokens, deposit 1,000 mUSDG into the vault
        token.mint(owner, 1_000e6);
        token.approve(address(vault), 1_000e6);
        vault.depositToken(address(token), 1_000e6);
        // fund vault with 1 ETH native
        vm.deal(address(vault), 1 ether);
        // policy: token perTx 100, daily 250; native perTx 0.1, daily 0.25
        vault.setPolicy(address(token), 100e6, 250e6);
        vault.setPolicy(address(0), 0.1 ether, 0.25 ether);
        vault.setRecipientAllowed(service, true);
    }

    function check(bool cond, string memory msg_) internal pure {
        if (!cond) revert(msg_);
    }

    function testAgentSpendWithinPolicy() public {
        vm.prank(agent);
        vault.agentSpend(address(token), service, 100e6);
        check(token.balanceOf(service) == 100e6, "service balance");
        (, , uint256 spent, ) = vault.getPolicy(address(token));
        check(spent == 100e6, "spentToday tracked");
    }

    function testPerTxCapReverts() public {
        vm.prank(agent);
        vm.expectRevert(bytes("per-tx cap exceeded"));
        vault.agentSpend(address(token), service, 101e6);
    }

    function testDailyCapReverts() public {
        vm.prank(agent);
        vault.agentSpend(address(token), service, 100e6);
        vm.prank(agent);
        vault.agentSpend(address(token), service, 100e6);
        vm.prank(agent);
        vm.expectRevert(bytes("daily cap exceeded"));
        vault.agentSpend(address(token), service, 100e6);
    }

    function testRecipientNotAllowedReverts() public {
        vm.prank(agent);
        vm.expectRevert(bytes("recipient not allowed"));
        vault.agentSpend(address(token), stranger, 10e6);
    }

    function testNonAgentCannotSpend() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("not agent"));
        vault.agentSpend(address(token), service, 10e6);
    }

    function testFrozenBlocksAgentButOwnerCanWithdraw() public {
        vault.setFrozen(true);
        vm.prank(agent);
        vm.expectRevert(bytes("vault frozen"));
        vault.agentSpend(address(token), service, 10e6);
        uint256 before = token.balanceOf(owner);
        vault.withdraw(address(token), owner, 500e6);
        check(token.balanceOf(owner) == before + 500e6, "owner withdraw while frozen");
    }

    function testNativeSpendWithinPolicy() public {
        uint256 before = service.balance;
        vm.prank(agent);
        vault.agentSpend(address(0), service, 0.1 ether);
        check(service.balance == before + 0.1 ether, "native received");
    }

    function testDayRolloverResetsSpent() public {
        vm.prank(agent);
        vault.agentSpend(address(token), service, 100e6);
        vm.prank(agent);
        vault.agentSpend(address(token), service, 100e6);
        vm.warp(block.timestamp + 1 days + 1);
        (, , uint256 spent, ) = vault.getPolicy(address(token));
        check(spent == 0, "spent reset on new day");
        vm.prank(agent);
        vault.agentSpend(address(token), service, 100e6);
        check(token.balanceOf(service) == 300e6, "spend works next day");
    }

    function testUnconfiguredTokenReverts() public {
        MockERC20 other = new MockERC20();
        vm.prank(agent);
        vm.expectRevert(bytes("token not allowed"));
        vault.agentSpend(address(other), service, 1e6);
    }
}
