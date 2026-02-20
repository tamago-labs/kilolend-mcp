import 'dotenv/config';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Export the WalletAgent for external use
export { WalletAgent } from './agent/wallet';
export { getEnvironmentConfig, validateEnvironment, NetworkType, CHAIN_CONFIGS, CHAIN_CONTRACTS, TOKEN_CONFIGS } from './config';

// Export MCP tools
export { GetWalletInfoTool } from './mcp/wallet/get_wallet_info_tool';
export { SendERC20TokenTool } from './mcp/wallet/send_erc20_token_tool';
export { SendNativeTokenTool } from './mcp/wallet/send_native_token_tool';

// Export MCP price tools
export { GetNetworkPricesTool } from './mcp/price/get_network_prices_tool';
export { GetAllPricesTool } from './mcp/price/get_all_prices_tool';




