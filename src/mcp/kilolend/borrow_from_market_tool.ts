import { z } from "zod";
import { WalletAgent } from "../../agent/wallet";
import { type McpTool } from "../../types";

export const BorrowFromMarketTool: McpTool = {
    name: "kilolend_borrow_from_lending",
    description: "Borrow tokens from a KiloLend lending market on any supported network",
    schema: {
        token_symbol: z.string()
            .describe("Token symbol to borrow (e.g., KAIA, USDT, KUB, XTZ, BORA, SIX, MBX, STAKED_KAIA)"),
        amount: z.string()
            .describe("Amount to borrow in token units (e.g., '100', '0.5')"),
        check_liquidity: z.boolean()
            .optional()
            .default(true)
            .describe("Check account liquidity before borrowing (default: true)")
    },
    handler: async (agent: WalletAgent, input: Record<string, any>) => {
        try {
            if (!agent.isTransactionMode()) {
                throw new Error('Transaction mode required. Configure private key in environment to enable transactions.');
            }

            const tokenSymbol = input.token_symbol.toUpperCase();
            const amount = input.amount;
            const checkLiquidity = input.check_liquidity !== false;

            // Get current network info for context
            const networkInfo = agent.currentNetworkInfo;

            // Verify token is available on current network
            const contracts = agent['getContractAddresses']();
            const cTokenKey = `c${tokenSymbol}`;
            const cTokenAddress = contracts[cTokenKey as keyof typeof contracts];
            
            if (!cTokenAddress) {
                const availableTokens = Object.keys(contracts)
                    .filter(k => k.startsWith('c'))
                    .map(k => k.substring(1))
                    .join(', ');
                
                throw new Error(`Token ${tokenSymbol} not available on current network. Available tokens: ${availableTokens}`);
            }

            // Check account liquidity before borrowing if requested
            let liquidityInfo = null;
            if (checkLiquidity) {
                try {
                    const walletAddress = agent.getAddress();
                    if (walletAddress) {
                        liquidityInfo = await agent.getAccountLiquidity(walletAddress as any);
                        const liquidity = Number(liquidityInfo.liquidity);
                        const healthFactor = Number(liquidityInfo.healthFactor);
                        
                        if (liquidity <= 0) {
                            throw new Error(`Insufficient liquidity to borrow. Current available liquidity: ${liquidity.toFixed(6)}`);
                        }
                        
                        if (healthFactor < 1.5) {
                            throw new Error(`Health factor too low to borrow safely. Current health factor: ${healthFactor.toFixed(2)} (recommended: >1.5)`);
                        }
                    }
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    if (errorMsg.includes('Insufficient liquidity') || errorMsg.includes('Health factor too low')) {
                        throw error;
                    }
                    // Continue if liquidity check fails for other reasons
                    console.warn('Liquidity check failed, proceeding with borrow:', errorMsg);
                }
            }
            
            const txHash = await agent.borrowFromMarket(tokenSymbol, amount);

            return {
                status: "success",
                message: `✅ Successfully borrowed ${amount} ${tokenSymbol} from market`,
                transaction_hash: txHash,
                details: {
                    token_symbol: tokenSymbol,
                    amount: amount,
                    ctoken_address: cTokenAddress,
                    network: {
                        name: networkInfo.name || 'Unknown',
                        chain_id: networkInfo.chainId,
                        native_currency: networkInfo.nativeCurrency
                    },
                    explorer_url: `${networkInfo.blockExplorer}/tx/${txHash}`
                },
                liquidity_before: liquidityInfo ? {
                    available_liquidity: Number(liquidityInfo.liquidity).toFixed(6),
                    health_factor: Number(liquidityInfo.healthFactor).toFixed(2),
                    total_collateral_usd: Number(liquidityInfo.totalCollateralUSD || 0).toFixed(2),
                    total_borrow_usd: Number(liquidityInfo.totalBorrowUSD || 0).toFixed(2)
                } : null,
                recommendations: [
                    "Wait for transaction confirmation before using borrowed funds",
                    "Monitor your health factor after borrowing",
                    "Keep health factor above 1.5 to avoid liquidation risk",
                    "Consider repaying part of the loan if market conditions change",
                    "Monitor interest rates on the borrowed asset"
                ]
            };
        } catch (error: any) {
            throw new Error(`Failed to borrow from market: ${error.message}`);
        }
    }
};