// Main MCP Tools Index
// Organizes all tools by capability (read-only vs read-write)

import { GetWalletInfoTool } from "./wallet/get_wallet_info_tool";
import { SendNativeTokenTool } from "./wallet/send_native_token_tool";
import { SendERC20TokenTool } from "./wallet/send_erc20_token_tool";
import {
    GetAccountLiquidityTool,
    GetMarketsTool,
    SupplyToMarketTool,
    BorrowFromMarketTool,
    RepayBorrowTool,
    CheckAllowanceTool,
    ApproveTokenTool,
    EnterMarketTool,
    RedeemUnderlyingTool
} from "./kilolend";
import {
    GetNetworkPricesTool,
    GetAllPricesTool
} from "./price";
import { wrapTools } from "./wrap";
import { dexTools } from "./dex";
import { universalTools } from "./universal";
import { aiagentTools } from "./aiagent";

// Import individual wrap tools
const WrapNativeTokenTool = wrapTools[0];
const UnwrapNativeTokenTool = wrapTools[1];

// Import individual DEX tools
const GetSwapQuoteTool = dexTools[0];
const ExecuteSwapTool = dexTools[1];

// Import individual universal tools
const UniversalContractReadTool = universalTools[0];
const UniversalContractWriteTool = universalTools[1];

// Import individual AI Agent tools
const BurnTokensTool = aiagentTools[0].tool;

export const KiloLendWalletTools = {
    // Basic wallet information and account management (read-only)
    "GetWalletInfoTool": GetWalletInfoTool,                    // Get wallet address, balance, network info
    "GetAccountLiquidityTool": GetAccountLiquidityTool,        // Check account health factor and positions
    "GetMarketsTool": GetMarketsTool,                          // Get all lending markets with rates

    // Transaction operations (require private key)
    "SendNativeTokenTool": SendNativeTokenTool,                // Send native KAIA tokens
    "SendERC20TokenTool": SendERC20TokenTool,                  // Send ERC-20 tokens
    "CheckAllowanceTool": CheckAllowanceTool,                  // Check token allowance for operations
    "ApproveTokenTool": ApproveTokenTool,                      // Approve tokens for KiloLend operations
    "EnterMarketTool": EnterMarketTool,                        // Enter markets to enable collateral usage
    "SupplyToMarketTool": SupplyToMarketTool,                  // Supply tokens to lending markets
    "BorrowFromMarketTool": BorrowFromMarketTool,              // Borrow tokens from markets
    "RepayBorrowTool": RepayBorrowTool,                        // Repay borrowed tokens
    "RedeemUnderlyingTool": RedeemUnderlyingTool,              // Redeem underlying tokens (withdraw by underlying amount)

    // Wrap/Unwrap operations
    "WrapNativeTokenTool": WrapNativeTokenTool,                // Wrap native tokens (KAIA→WKAIA, KUB→KKUB, XTZ→WXTZ)
    "UnwrapNativeTokenTool": UnwrapNativeTokenTool,            // Unwrap tokens back to native (WKAIA→KAIA, KKUB→KUB, WXTZ→XTZ)

    // DEX operations (KAIA & KUB only)
    "GetSwapQuoteTool": GetSwapQuoteTool,                      // Get swap quotes for token exchanges
    "ExecuteSwapTool": ExecuteSwapTool,                        // Execute token swaps on DEX

    // Universal contract operations
    "UniversalContractReadTool": UniversalContractReadTool,      // Execute read-only calls on any contract
    "UniversalContractWriteTool": UniversalContractWriteTool,    // Execute write calls on any contract

    // AI Agent Token operations
    "BurnTokensTool": BurnTokensTool,                          // Burn AI Agent tokens (requires AI Agent or Creator role)

    // Price API operations
    "GetNetworkPricesTool": GetNetworkPricesTool,              // Get prices for specific network
    "GetAllPricesTool": GetAllPricesTool,                       // Get all available token prices

};

export const KiloLendReadOnlyTools = {
    // Read-only operations
    "GetWalletInfoTool": GetWalletInfoTool,
    "GetAccountLiquidityTool": GetAccountLiquidityTool,
    "GetMarketsTool": GetMarketsTool,

    // Read-only DEX operations
    "GetSwapQuoteTool": GetSwapQuoteTool,                      // Get swap quotes (read-only)

    // Read-only universal operations
    "UniversalContractReadTool": UniversalContractReadTool,      // Execute read-only calls on any contract

    // Price API operations (read-only)
    "GetNetworkPricesTool": GetNetworkPricesTool,              // Get prices for specific network
    "GetAllPricesTool": GetAllPricesTool,                       // Get all available token prices

};