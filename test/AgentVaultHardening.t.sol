// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentVault} from "../src/AgentVault.sol";

interface VmHardening {
    function prank(address msgSender) external;
    function deal(address account, uint256 newBalance) external;
    function expectRevert(bytes calldata revertData) external;
}

/// @dev Regression tests for the 2026-11-12 audit fixes: non-contract tokens
/// must revert (they used to "succeed" while moving nothing), and ownership
/// transfer is two-step (a mistyped address used to lock the vault instantly).
/// Plain-assert tests (no forge-std dependency), same style as AgentVault.t.sol.
contract AgentVaultHardeningTest {
    VmHardening constant vm = VmHardening(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    AgentVault vault;
    address owner = address(this);
    address agent = address(0xA6E7);
    address service = address(0x5E27);
    address stranger = address(0x57A9);
    address eoaToken = address(0xE0A7); // an EOA: no code at all

    function setUp() public {
        vault = new AgentVault(agent);
        vault.setPolicy(eoaToken, 100e6, 250e6);
        vault.setRecipientAllowed(service, true);
        vm.deal(address(vault), 1 ether);
    }

    function testDepositEoaTokenReverts() public {
        vm.expectRevert(bytes("token has no code"));
        vault.depositToken(eoaToken, 100e6);
    }

    function testAgentSpendEoaTokenRevertsWithoutBurningAllowance() public {
        vm.prank(agent);
        vm.expectRevert(bytes("token has no code"));
        vault.agentSpend(eoaToken, service, 100e6);
        (, , uint256 spent, ) = vault.getPolicy(eoaToken);
        require(spent == 0, "allowance must not burn on a reverted spend");
    }

    function testOwnerWithdrawEoaTokenReverts() public {
        vm.expectRevert(bytes("token has no code"));
        vault.withdraw(eoaToken, owner, 100e6);
    }

    function testOwnershipTwoStep() public {
        address newOwner = address(0xBEEF);
        vault.transferOwnership(newOwner);
        // Proposal alone changes nothing: old owner still controls the vault.
        require(vault.owner() == owner, "owner unchanged until accept");
        require(vault.pendingOwner() == newOwner, "pending owner recorded");
        vault.setPolicy(address(0), 0.1 ether, 0.25 ether);
        // A stranger cannot accept someone else's proposal.
        vm.prank(stranger);
        vm.expectRevert(bytes("not pending owner"));
        vault.acceptOwnership();
        // The proposed owner accepts: control moves, pending clears.
        vm.prank(newOwner);
        vault.acceptOwnership();
        require(vault.owner() == newOwner, "owner moved after accept");
        require(vault.pendingOwner() == address(0), "pending cleared after accept");
        // Old owner is now locked out.
        vm.expectRevert(bytes("not owner"));
        vault.setPolicy(address(0), 0.1 ether, 0.25 ether);
    }

    function testOwnershipProposeZeroReverts() public {
        vm.expectRevert(bytes("owner is zero"));
        vault.transferOwnership(address(0));
    }

    function testOwnershipProposalCanBeReplaced() public {
        address first = address(0xF175);
        address second = address(0x5EC0);
        vault.transferOwnership(first);
        vault.transferOwnership(second);
        vm.prank(first);
        vm.expectRevert(bytes("not pending owner"));
        vault.acceptOwnership();
        vm.prank(second);
        vault.acceptOwnership();
        require(vault.owner() == second, "replacement proposal wins");
    }
}
