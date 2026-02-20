import { z } from "zod";
import { WalletAgent } from "../../agent/wallet";
import { type McpTool } from "../../types";
import { getAllPrices } from "../../tools/price-api/price";

export const GetAllPricesTool: McpTool = {
    name: "kilolend_get_all_prices",
    description: "Get all available token prices from the KiloLend price API",
    schema: {},
    handler: async (agent: WalletAgent, input: Record<string, any>) => {
        try {
            const pricesResult = await getAllPrices();

            if (!pricesResult.success) {
                throw new Error(`Failed to fetch prices: ${(pricesResult as any).error || 'Unknown error'}`);
            }

            // Get current network info for context
            const networkInfo = agent.currentNetworkInfo;

            return {
                status: "success",
                message: `✅ Retrieved all available token prices`,
                network: {
                    current_network: networkInfo.name || 'Unknown',
                    chain_id: networkInfo.chainId,
                    native_currency: networkInfo.nativeCurrency
                },
                prices: pricesResult.prices,
                count: pricesResult.count,
                timestamp: new Date().toISOString(),
                recommendations: [
                    "Use these prices for portfolio valuation across all networks",
                    "Prices are updated regularly from the KiloLend price API",
                    "Check timestamp for price freshness",
                    "Filter by specific network using get_network_prices for network-specific prices"
                ]
            };
        } catch (error: any) {
            throw new Error(`Failed to get all prices: ${error.message}`);
        }
    }
};