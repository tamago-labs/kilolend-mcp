import { z } from "zod";
import { WalletAgent } from "../../agent/wallet";
import { type McpTool } from "../../types";

export const GetMarketsTool: McpTool = {
    name: "kilolend_get_lending_markets",
    description: "Get all lending markets on KiloLend with their current rates and statistics for any supported network",
    schema: {
        sort_by: z.enum(['supply_apy', 'borrow_apy', 'total_supply', 'total_borrows', 'utilization_rate'])
            .optional()
            .describe("Sort markets by specified metric (optional)"),
        sort_order: z.enum(['asc', 'desc'])
            .optional()
            .default('desc')
            .describe("Sort order (optional, default: desc)"),
        filter_active: z.boolean()
            .optional()
            .default(true)
            .describe("Filter to show only active markets (optional, default: true)")
    },
    handler: async (agent: WalletAgent, input: Record<string, any>) => {
        try {
            // Get current network info for context
            const networkInfo = agent.currentNetworkInfo;
            
            // Use getAllMarkets method which already fetches all market data
            let markets = await agent.getAllMarkets();

            // Filter active markets if requested
            if (input.filter_active !== false) {
                markets = markets.filter(m => m.isListed !== false);
            }

            // Sort markets if requested
            if (input.sort_by) {
                const sortBy = input.sort_by;
                const sortOrder = input.sort_order || 'desc';
                
                markets.sort((a, b) => {
                    let aValue, bValue;
                    
                    switch (sortBy) {
                        case 'supply_apy':
                            aValue = parseFloat(a.supplyApy);
                            bValue = parseFloat(b.supplyApy);
                            break;
                        case 'borrow_apy':
                            aValue = parseFloat(a.borrowApy);
                            bValue = parseFloat(b.borrowApy);
                            break;
                        case 'total_supply':
                            aValue = parseFloat(a.totalSupply);
                            bValue = parseFloat(b.totalSupply);
                            break;
                        case 'total_borrows':
                            aValue = parseFloat(a.totalBorrows);
                            bValue = parseFloat(b.totalBorrows);
                            break;
                        case 'utilization_rate':
                            aValue = parseFloat(a.utilizationRate);
                            bValue = parseFloat(b.utilizationRate);
                            break;
                        default:
                            return 0;
                    }
                    
                    return sortOrder === 'desc' ? bValue - aValue : aValue - bValue;
                });
            }

            // Calculate summary statistics
            const totalMarkets = markets.length;
            const avgSupplyApy = totalMarkets > 0 ? 
                (markets.reduce((sum, m) => sum + parseFloat(m.supplyApy), 0) / totalMarkets).toFixed(2) : '0.00';
            const avgBorrowApy = totalMarkets > 0 ? 
                (markets.reduce((sum, m) => sum + parseFloat(m.borrowApy), 0) / totalMarkets).toFixed(2) : '0.00';
            
            const highestSupplyMarket = markets.reduce((max, m) => 
                parseFloat(m.supplyApy) > parseFloat(max.supplyApy) ? m : max, markets[0]);
            const highestBorrowMarket = markets.reduce((max, m) => 
                parseFloat(m.borrowApy) > parseFloat(max.borrowApy) ? m : max, markets[0]);

            // Calculate total TVL and borrows across all markets
            const totalTVL = markets.reduce((sum, m) => sum + (parseFloat(m.totalSupply) * (m.price || 0)), 0);
            const totalBorrows = markets.reduce((sum, m) => sum + (parseFloat(m.totalBorrows) * (m.price || 0)), 0);
            const avgUtilization = totalTVL > 0 ? (totalBorrows / totalTVL * 100).toFixed(2) : '0.00';

            return {
                status: "success",
                message: `✅ Retrieved ${totalMarkets} lending markets`,
                network: {
                    name: networkInfo.name || 'Unknown',
                    chain_id: networkInfo.chainId,
                    native_currency: networkInfo.nativeCurrency
                },
                markets: markets,
                summary: {
                    total_markets: totalMarkets,
                    avg_supply_apy: avgSupplyApy,
                    avg_borrow_apy: avgBorrowApy,
                    highest_supply_apy: {
                        market: highestSupplyMarket?.symbol || 'N/A',
                        apy: highestSupplyMarket?.supplyApy || '0.00'
                    },
                    highest_borrow_apy: {
                        market: highestBorrowMarket?.symbol || 'N/A',
                        apy: highestBorrowMarket?.borrowApy || '0.00'
                    },
                    total_tvl_usd: totalTVL.toFixed(2),
                    total_borrows_usd: totalBorrows.toFixed(2),
                    avg_utilization_rate: avgUtilization + '%'
                },
                market_analysis: {
                    best_for_supplying: markets
                        .filter(m => parseFloat(m.supplyApy) > 0)
                        .sort((a, b) => parseFloat(b.supplyApy) - parseFloat(a.supplyApy))
                        .slice(0, 3)
                        .map(m => ({ market: m.symbol, apy: m.supplyApy, utilization: m.utilizationRate })),
                    best_for_borrowing: markets
                        .filter(m => parseFloat(m.borrowApy) > 0 && parseFloat(m.utilizationRate) < 80) // Avoid high utilization markets
                        .sort((a, b) => parseFloat(a.borrowApy) - parseFloat(b.borrowApy))
                        .slice(0, 3)
                        .map(m => ({ market: m.symbol, apy: m.borrowApy, utilization: m.utilizationRate })),
                    high_utilization_markets: markets
                        .filter(m => parseFloat(m.utilizationRate) > 80)
                        .sort((a, b) => parseFloat(b.utilizationRate) - parseFloat(a.utilizationRate))
                        .map(m => ({ market: m.symbol, utilization: m.utilizationRate, supply_apy: m.supplyApy }))
                },
                recommendations: [
                    "Compare supply and borrow rates across markets",
                    "Check utilization rates - high utilization (>80%) may indicate increasing rates",
                    "Consider market depth (total supply) for larger positions",
                    "Monitor rates regularly as they change with market conditions",
                    "High utilization markets may offer better yields but carry more risk",
                    "Diversify across multiple markets to reduce concentration risk"
                ]
            };
        } catch (error: any) {
            throw new Error(`Failed to get markets: ${error.message}`);
        }
    }
};