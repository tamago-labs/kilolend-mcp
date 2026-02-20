import { z } from "zod";
import { WalletAgent } from "../../agent/wallet";
import { type McpTool } from "../../types";

export const RepayBorrowTool: McpTool = {
    name: "kilolend_repay_lending",
    description: "Repay borrowed tokens to a KiloLend lending market on any supported network",
    schema: {
        token_symbol: z.string()
            .describe("Token symbol to repay (e.g., KAIA, USDT, KUB, XTZ, BORA, SIX, MBX, stKAIA)"),
        amount: z.string()
            .optional()
            .describe("Amount to repay in token units (e.g., '100', '0.5'), defaults to full repayment if not specified"),
        check_balance: z.boolean()
            .optional()
            .default(true)
            .describe("Check token balance before repaying (default: true)")
    },
    handler: async (agent: WalletAgent, input: Record<string, any>) => {
        try {
            if (!agent.isTransactionMode()) {
                throw new Error('Transaction mode required. Configure private key in environment to enable transactions.');
            }

            const tokenSymbol = input.token_symbol.trim();
            const amount = input.amount;
            const checkBalance = input.check_balance !== false;

            // Case-insensitive token resolution
            let resolvedToken = tokenSymbol;

            // Get contract addresses and try case-insensitive matching
            const contracts = agent['getContractAddresses']();

            // Try different cToken key variations
            let cTokenAddress = null;
            const variations = [
                `c${resolvedToken}`,
                `c${resolvedToken.toUpperCase()}`,
                `c${resolvedToken.toLowerCase()}`,
                `cStKAIA`, // Specific for StKAIA
                `cstKAIA`,
                `cSTKAIA`
            ];

            for (const variation of variations) {
                if (contracts[variation as keyof typeof contracts]) {
                    cTokenAddress = contracts[variation as keyof typeof contracts];
                    resolvedToken = variation.substring(1);
                    break;
                }
            }

            if (!cTokenAddress) {
                const availableTokens = Object.keys(contracts)
                    .filter(k => k.startsWith('c'))
                    .map(k => k.substring(1))
                    .join(', ');
                
                throw new Error(`Token ${tokenSymbol} not available on current network. Available tokens: ${availableTokens}`);
            }

            // Get current network info for context
            const networkInfo = agent.currentNetworkInfo;

            // Get user's current borrow position
            let borrowInfo = null;
            let balanceInfo = null;
            
            try {
                const walletAddress = agent.getAddress();
                if (walletAddress) {
                    // Get account liquidity to find borrow position
                    const liquidityInfo = await agent.getAccountLiquidity(walletAddress as any);
                    
                    // Find the specific token's borrow position
                    const borrowPosition = liquidityInfo.positions?.find((p: any) => 
                        p.symbol === resolvedToken && parseFloat(p.borrowBalance) > 0
                    );
                    
                    if (!borrowPosition) {
                        throw new Error(`No active borrow position found for ${tokenSymbol}. Current borrows: ${liquidityInfo.positions?.filter((p: any) => parseFloat(p.borrowBalance) > 0).map((p: any) => `${p.symbol}: ${p.borrowBalance}`).join(', ') || 'None'}`);
                    }
                    
                    borrowInfo = {
                        current_borrow: borrowPosition.borrowBalance,
                        borrow_value_usd: borrowPosition.borrowValueUSD,
                        symbol: resolvedToken
                    };

                    // Check token balance if amount is specified
                    if (amount && checkBalance) {
                        const tokenAddresses = agent['getTokenAddresses']();
                        const tokenAddress = tokenAddresses[resolvedToken];
                        
                        if (tokenAddress && tokenAddress !== '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE') {
                            // ERC20 token balance check
                            const tokenBalance = await agent['getTokenBalance'](tokenAddress as `0x${string}`, walletAddress as `0x${string}`);
                            const tokenDecimals = agent['getTokenDecimals'](resolvedToken);
                            const balanceFormatted = Number(tokenBalance) / Math.pow(10, tokenDecimals);
                            const requestedAmount = Number(amount);
                            
                            if (balanceFormatted < requestedAmount) {
                                throw new Error(`Insufficient ${tokenSymbol} balance. Current balance: ${balanceFormatted.toFixed(6)} ${tokenSymbol}, requested: ${requestedAmount} ${tokenSymbol}`);
                            }
                            
                            balanceInfo = {
                                token_balance: tokenBalance.toString(),
                                balance_formatted: balanceFormatted.toString(),
                                token_decimals: tokenDecimals
                            };
                        } else {
                            // Native token balance check - import and use publicClient from config
                            const { publicClient } = await import("../../config");
                            const nativeBalance = await publicClient.getBalance({ address: walletAddress });
                            const balanceFormatted = Number(nativeBalance) / Math.pow(10, 18);
                            const requestedAmount = Number(amount);
                            
                            if (balanceFormatted < requestedAmount) {
                                throw new Error(`Insufficient ${tokenSymbol} balance. Current balance: ${balanceFormatted.toFixed(6)} ${tokenSymbol}, requested: ${requestedAmount} ${tokenSymbol}`);
                            }
                            
                            balanceInfo = {
                                token_balance: nativeBalance.toString(),
                                balance_formatted: balanceFormatted.toString(),
                                token_decimals: 18
                            };
                        }
                    }
                }
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                if (errorMsg.includes('No active borrow position') || errorMsg.includes('Insufficient')) {
                    throw error;
                }
                // Continue if other checks fail
                console.warn('Borrow/ balance check failed, proceeding with repayment:', errorMsg);
            }
            
            const txHash = await agent.repayBorrow(resolvedToken, amount);

            return {
                status: "success",
                message: `✅ Successfully repaid ${amount || 'all'} ${tokenSymbol} tokens`,
                transaction_hash: txHash,
                details: {
                    token_symbol: resolvedToken,
                    ctoken_address: cTokenAddress,
                    repayment_amount: amount || 'full amount',
                    network: {
                        name: networkInfo.name || 'Unknown',
                        chain_id: networkInfo.chainId,
                        native_currency: networkInfo.nativeCurrency
                    },
                    explorer_url: `${networkInfo.blockExplorer}/tx/${txHash}`
                },
                borrow_before: borrowInfo ? {
                    current_borrow: borrowInfo.current_borrow,
                    borrow_value_usd: borrowInfo.borrow_value_usd.toFixed(2),
                    symbol: borrowInfo.symbol
                } : null,
                balance_info: balanceInfo ? {
                    token_balance: Number(balanceInfo.token_balance).toLocaleString(),
                    balance_formatted: balanceInfo.balance_formatted,
                    token_decimals: balanceInfo.token_decimals
                } : null,
                recommendations: [
                    "Wait for transaction confirmation to verify repayment completion",
                    "Check your account liquidity after repayment to see improved health factor",
                    "Full repayment may improve your borrowing capacity for other assets",
                    "Partial repayments reduce interest accumulation on the outstanding amount",
                    "Monitor your overall portfolio after repayment for optimal position management"
                ]
            };
        } catch (error: any) {
            throw new Error(`Failed to repay borrow: ${error.message}`);
        }
    }
};