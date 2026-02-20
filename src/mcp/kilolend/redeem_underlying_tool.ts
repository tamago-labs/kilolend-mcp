import { z } from "zod";
import { WalletAgent } from "../../agent/wallet";
import { type McpTool } from "../../types";

export const RedeemUnderlyingTool: McpTool = {
    name: "kilolend_redeem_underlying",
    description: "Redeem underlying tokens from a KiloLend lending market on any supported network (specify underlying token amount)",
    schema: {
        token_symbol: z.string()
            .describe("Token symbol to redeem (e.g., KAIA, USDT, KUB, XTZ, BORA, SIX, MBX, stKAIA)"),
        underlying_amount: z.string()
            .describe("Amount of underlying tokens to redeem in token units (e.g., '100', '0.5')"),
        check_balance: z.boolean()
            .optional()
            .default(true)
            .describe("Check if sufficient underlying tokens can be redeemed (default: true)")
    },
    handler: async (agent: WalletAgent, input: Record<string, any>) => {
        try {
            if (!agent.isTransactionMode()) {
                throw new Error('Transaction mode required. Configure private key in environment to enable transactions.');
            }

            const tokenSymbol = input.token_symbol.toUpperCase();
            const underlyingAmount = input.underlying_amount;
            const checkBalance = input.check_balance !== false;

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

            // Check if sufficient underlying tokens can be redeemed if requested
            let balanceInfo = null;
            let marketData = null;
            
            if (checkBalance) {
                try {
                    const walletAddress = agent.getAddress();
                    if (walletAddress) {
                        // Get cToken balance
                        const cTokenBalance = await agent['getTokenBalance'](cTokenAddress as `0x${string}`, walletAddress as `0x${string}`);
                        
                        // Get market data to calculate exchange rate
                        marketData = await agent.getMarketData(cTokenAddress as `0x${string}`);
                        const exchangeRate = Number(marketData.exchangeRate) / 1e18;
                        
                        // Calculate maximum underlying tokens that can be redeemed
                        const maxUnderlying = Number(cTokenBalance) * exchangeRate;
                        const tokenDecimals = agent['getTokenDecimals'](tokenSymbol);
                        const decimalDivisor = Math.pow(10, tokenDecimals);
                        const maxUnderlyingFormatted = maxUnderlying / decimalDivisor;
                        const requestedAmount = Number(underlyingAmount);
                        
                        if (maxUnderlyingFormatted < requestedAmount) {
                            throw new Error(`Insufficient underlying tokens available for redemption. Maximum redeemable: ${maxUnderlyingFormatted.toFixed(6)} ${tokenSymbol}, requested: ${requestedAmount} ${tokenSymbol}`);
                        }

                        // Format balance info for display
                        const cTokenFormatted = Number(cTokenBalance) / Math.pow(10, 8);
                        balanceInfo = {
                            ctoken_balance: cTokenBalance.toString(),
                            ctoken_formatted: cTokenFormatted.toString(),
                            max_underlying_redeemable: maxUnderlyingFormatted.toString(),
                            exchange_rate: exchangeRate.toString(),
                            token_decimals: tokenDecimals
                        };
                    }
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    if (errorMsg.includes('Insufficient underlying tokens')) {
                        throw error;
                    }
                    // Continue if balance check fails for other reasons
                    console.warn('Balance check failed, proceeding with redemption:', errorMsg);
                }
            }
            
            const txHash = await agent.redeemUnderlying(tokenSymbol, underlyingAmount);

            return {
                status: "success",
                message: `✅ Successfully redeemed ${underlyingAmount} ${tokenSymbol} tokens`,
                transaction_hash: txHash,
                details: {
                    token_symbol: tokenSymbol,
                    ctoken_symbol: `c${tokenSymbol}`,
                    underlying_amount: underlyingAmount,
                    ctoken_address: cTokenAddress,
                    network: {
                        name: networkInfo.name || 'Unknown',
                        chain_id: networkInfo.chainId,
                        native_currency: networkInfo.nativeCurrency
                    },
                    explorer_url: `${networkInfo.blockExplorer}/tx/${txHash}`
                },
                balance_info: balanceInfo ? {
                    ctoken_balance: Number(balanceInfo.ctoken_balance).toLocaleString(),
                    ctoken_formatted: balanceInfo.ctoken_formatted,
                    max_underlying_redeemable: balanceInfo.max_underlying_redeemable,
                    exchange_rate: balanceInfo.exchange_rate,
                    token_decimals: balanceInfo.token_decimals
                } : null,
                market_data: marketData ? {
                    exchange_rate: (Number(marketData.exchangeRate) / 1e18).toFixed(6),
                    total_supply: marketData.totalSupply,
                    total_borrows: marketData.totalBorrows,
                    cash: marketData.cash
                } : null,
                recommendations: [
                    "Wait for transaction confirmation before using the redeemed tokens",
                    "Check your wallet balance for the underlying tokens",
                    "Note: The system calculated the required cTokens based on current exchange rate",
                    "Exchange rates fluctuate based on market conditions",
                    "Consider the tax implications if applicable in your jurisdiction",
                    "Monitor your account liquidity after redemption if you have active loans"
                ]
            };
        } catch (error: any) {
            throw new Error(`Failed to redeem underlying tokens: ${error.message}`);
        }
    }
};