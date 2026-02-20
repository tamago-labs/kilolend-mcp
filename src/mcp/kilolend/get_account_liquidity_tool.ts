import { z } from "zod";
import { WalletAgent } from "../../agent/wallet";
import { type McpTool } from "../../types";

export const GetAccountLiquidityTool: McpTool = {
    name: "kilolend_get_account_liquidity",
    description: "Check account liquidity, health factor, and borrowing capacity on KiloLend for any supported network",
    schema: {
        account_address: z.string()
            .optional()
            .describe("Account address to check (optional, defaults to current wallet)")
    },
    handler: async (agent: WalletAgent, input: Record<string, any>) => {
        try {
            // Get the account address - use provided address or get from wallet
            let accountAddress = input.account_address;
            if (!accountAddress) {
                const walletAddress = agent.getAddress();
                if (!walletAddress) {
                    throw new Error('No account address provided and no wallet available. Please provide account_address or configure private key in environment.');
                }
                accountAddress = walletAddress;
            }

            // Get current network info for context
            const networkInfo = agent.currentNetworkInfo;
            
            const liquidityInfo = await agent.getAccountLiquidity(accountAddress as any);

            // Calculate additional metrics
            const liquidity = Number(liquidityInfo.liquidity);
            const shortfall = Number(liquidityInfo.shortfall);
            const healthFactor = Number(liquidityInfo.healthFactor);
            const totalCollateralUSD = Number(liquidityInfo.totalCollateralUSD || 0);
            const totalBorrowUSD = Number(liquidityInfo.totalBorrowUSD || 0);

            // Determine account status
            const canBorrow = liquidity > 0 && shortfall === 0;
            const atRiskLiquidation = healthFactor < 1.4;
            const isHealthy = healthFactor >= 1.5;
            const hasShortfall = shortfall > 0;

            // Calculate utilization if there's collateral
            const utilizationRate = totalCollateralUSD > 0 ? (totalBorrowUSD / totalCollateralUSD) * 100 : 0;

            return {
                status: "success",
                message: "✅ Account liquidity information retrieved",
                account_address: accountAddress,
                network: {
                    name: networkInfo.name || 'Unknown',
                    chain_id: networkInfo.chainId,
                    native_currency: networkInfo.nativeCurrency
                },
                liquidity_info: {
                    liquidity: liquidity.toFixed(6),
                    shortfall: shortfall.toFixed(6),
                    health_factor: healthFactor.toFixed(2),
                    can_borrow: canBorrow,
                    at_risk_liquidation: atRiskLiquidation,
                    is_healthy: isHealthy,
                    total_collateral_usd: totalCollateralUSD.toFixed(2),
                    total_borrow_usd: totalBorrowUSD.toFixed(2),
                    utilization_rate: utilizationRate.toFixed(2) + '%'
                },
                positions: liquidityInfo.positions || [],
                risk_analysis: {
                    risk_level: hasShortfall ? 'CRITICAL' : 
                              atRiskLiquidation ? 'HIGH' : 
                              healthFactor < 2.0 ? 'MEDIUM' : 'LOW',
                    liquidation_threshold: '1.0',
                    recommended_health_factor: '1.5',
                    safe_borrowing_capacity: (liquidity * 0.8).toFixed(2) // 80% of available liquidity for safety
                },
                recommendations: hasShortfall
                    ? [
                        "🚨 CRITICAL: Account has shortfall - immediate liquidation risk",
                        "Repay borrowed assets immediately or supply more collateral",
                        "Reduce borrowed positions to restore health",
                        "Monitor closely to avoid forced liquidation"
                    ]
                    : atRiskLiquidation
                    ? [
                        "⚠️ HIGH RISK: Low health factor - close to liquidation threshold",
                        "Monitor positions very closely",
                        "Consider adding more collateral or repaying debt soon",
                        "Avoid borrowing more assets until health improves"
                    ]
                    : !canBorrow
                    ? [
                        "ℹ️ INSUFFICIENT COLLATERAL: Cannot borrow more assets",
                        "Supply more collateral to enable borrowing",
                        "Current positions are safe from liquidation",
                        "Consider maintaining some borrowing capacity"
                    ]
                    : [
                        "✅ HEALTHY: Account is in good standing",
                        `Can safely borrow up to $${(liquidity * 0.8).toFixed(2)} worth of assets`,
                        "Positions are safe from liquidation",
                        "Consider maintaining health factor above 1.5 for safety margin"
                    ]
            };
        } catch (error: any) {
            throw new Error(`Failed to get account liquidity: ${error.message}`);
        }
    }
};