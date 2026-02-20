import { z } from "zod";
import { WalletAgent } from "../../agent/wallet";
import { type McpTool } from "../../types";
import { getNetworkPrices } from "../../tools/price-api/price";
import { NetworkType } from "../../config";

export const GetNetworkPricesTool: McpTool = {
    name: "kilolend_get_network_prices",
    description: "Get token prices for the currently connected network (KAIA, KUB, or Etherlink)",
    schema: {
        network: z.enum(['kaia', 'kub', 'etherlink']).optional()
            .describe("Optional: Specify network ('kaia', 'kub', 'etherlink'). If not provided, uses current network connection")
    },
    handler: async (agent: WalletAgent, input: Record<string, any>) => {
        try {
            // Use provided network or get from agent's network info
            let network: NetworkType;
            if (input.network) {
                network = input.network as NetworkType;
            } else {
                // Extract network from networkInfo since currentNetwork is private
                const networkInfo = agent.currentNetworkInfo;
                network = networkInfo.chainId === 8217 ? 'kaia' : 
                        networkInfo.chainId === 96 ? 'kub' : 'etherlink';
            }
            
            const pricesResult = await getNetworkPrices(network);

            if (!pricesResult.success) {
                throw new Error(`Failed to fetch prices: ${(pricesResult as any).error || 'Unknown error'}`);
            }

            // Get network info for context
            const networkInfo = agent.currentNetworkInfo;
            const networkName = networkInfo.name || network.toUpperCase();

            return {
                status: "success",
                message: `✅ Retrieved prices for ${networkName} network`,
                network: {
                    name: networkName,
                    chain_id: networkInfo.chainId,
                    native_currency: networkInfo.nativeCurrency
                },
                prices: pricesResult.prices,
                count: pricesResult.count,
                requested_symbols: (pricesResult as any).requestedSymbols || [],
                found_symbols: (pricesResult as any).foundSymbols || [],
                timestamp: new Date().toISOString(),
                recommendations: [
                    "Use these prices for portfolio valuation",
                    "Prices are updated regularly from the KiloLend price API",
                    "Check timestamp for price freshness"
                ]
            };
        } catch (error: any) {
            throw new Error(`Failed to get network prices: ${error.message}`);
        }
    }
};
