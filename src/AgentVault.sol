// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC20 surface used by the vault.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title AgentVault
/// @notice A policy-governed spending vault for AI agents.
/// @dev The owner (a human) funds the vault and sets hard on-chain rules:
///      per-transaction caps, daily caps, and recipient/token allowlists.
///      The agent (a hot key, e.g. an AI agent process) can only move funds
///      inside those rules. The owner can freeze the agent instantly and can
///      always withdraw everything. Token address(0) means the native coin.
contract AgentVault {
    address public owner;
    address public agent;
    bool public frozen;

    struct Policy {
        uint256 perTxCap;
        uint256 dailyCap;
        uint256 spentToday;
        uint256 dayIndex;
        bool configured;
    }

    mapping(address => Policy) private _policies; // token => policy
    mapping(address => bool) public allowedRecipient;

    event Deposited(address indexed token, address indexed from, uint256 amount);
    event AgentSpend(address indexed token, address indexed to, uint256 amount, uint256 spentToday);
    event OwnerWithdraw(address indexed token, address indexed to, uint256 amount);
    event PolicySet(address indexed token, uint256 perTxCap, uint256 dailyCap);
    event RecipientAllowed(address indexed who, bool allowed);
    event AgentChanged(address indexed oldAgent, address indexed newAgent);
    event FrozenChanged(bool frozen);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);

    bool private _locked;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agent, "not agent");
        _;
    }

    modifier nonReentrant() {
        require(!_locked, "reentrant");
        _locked = true;
        _;
        _locked = false;
    }

    constructor(address agent_) {
        require(agent_ != address(0), "agent is zero");
        owner = msg.sender;
        agent = agent_;
    }

    receive() external payable {
        emit Deposited(address(0), msg.sender, msg.value);
    }

    // ---------------- funding ----------------

    function depositToken(address token, uint256 amount) external {
        require(token != address(0), "use plain transfer for native");
        require(amount > 0, "amount is zero");
        _safeTransferFrom(token, msg.sender, address(this), amount);
        emit Deposited(token, msg.sender, amount);
    }

    // ---------------- agent actions ----------------

    /// @notice The agent spends from the vault, enforced by the policy.
    function agentSpend(address token, address to, uint256 amount) external onlyAgent nonReentrant {
        require(!frozen, "vault frozen");
        require(amount > 0, "amount is zero");
        require(to != address(0), "to is zero");
        require(allowedRecipient[to], "recipient not allowed");

        Policy storage p = _policies[token];
        require(p.configured, "token not allowed");
        require(amount <= p.perTxCap, "per-tx cap exceeded");

        uint256 today = block.timestamp / 1 days;
        if (p.dayIndex != today) {
            p.dayIndex = today;
            p.spentToday = 0;
        }
        uint256 newSpent = p.spentToday + amount;
        require(newSpent <= p.dailyCap, "daily cap exceeded");
        p.spentToday = newSpent;

        _transferOut(token, to, amount);
        emit AgentSpend(token, to, amount, newSpent);
    }

    // ---------------- owner controls ----------------

    function setPolicy(address token, uint256 perTxCap, uint256 dailyCap) external onlyOwner {
        require(perTxCap > 0 && dailyCap >= perTxCap, "bad caps");
        Policy storage p = _policies[token];
        p.perTxCap = perTxCap;
        p.dailyCap = dailyCap;
        p.configured = true;
        emit PolicySet(token, perTxCap, dailyCap);
    }

    function removePolicy(address token) external onlyOwner {
        delete _policies[token];
        emit PolicySet(token, 0, 0);
    }

    function setRecipientAllowed(address who, bool allowed) external onlyOwner {
        require(who != address(0), "who is zero");
        allowedRecipient[who] = allowed;
        emit RecipientAllowed(who, allowed);
    }

    function setAgent(address newAgent) external onlyOwner {
        require(newAgent != address(0), "agent is zero");
        emit AgentChanged(agent, newAgent);
        agent = newAgent;
    }

    function setFrozen(bool frozen_) external onlyOwner {
        frozen = frozen_;
        emit FrozenChanged(frozen_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "owner is zero");
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Owner escape hatch: ignores policy, works even while frozen.
    function withdraw(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "to is zero");
        require(amount > 0, "amount is zero");
        _transferOut(token, to, amount);
        emit OwnerWithdraw(token, to, amount);
    }

    // ---------------- views ----------------

    function getPolicy(address token)
        external
        view
        returns (uint256 perTxCap, uint256 dailyCap, uint256 spentToday, bool configured)
    {
        Policy storage p = _policies[token];
        uint256 spent = (p.dayIndex == block.timestamp / 1 days) ? p.spentToday : 0;
        return (p.perTxCap, p.dailyCap, spent, p.configured);
    }

    function balanceOf(address token) external view returns (uint256) {
        if (token == address(0)) return address(this).balance;
        return IERC20(token).balanceOf(address(this));
    }

    // ---------------- internals ----------------

    function _transferOut(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "native transfer failed");
        } else {
            _safeTransfer(token, to, amount);
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "erc20 transfer failed");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "erc20 transferFrom failed");
    }
}
