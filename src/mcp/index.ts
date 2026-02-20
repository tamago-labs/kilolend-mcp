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

    // Price API operations
    "GetNetworkPricesTool": GetNetworkPricesTool,              // Get prices for specific network
    "GetAllPricesTool": GetAllPricesTool,                       // Get all available token prices

};

export const KiloLendReadOnlyTools = {
    // Read-only operations
    "GetWalletInfoTool": GetWalletInfoTool,
    "GetAccountLiquidityTool": GetAccountLiquidityTool,
    "GetMarketsTool": GetMarketsTool,

    // Price API operations (read-only)
    "GetNetworkPricesTool": GetNetworkPricesTool,              // Get prices for specific network
    "GetAllPricesTool": GetAllPricesTool,                       // Get all available token prices

};