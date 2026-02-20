import { z } from "zod";
import { WalletAgent } from "../../agent/wallet";
import { type McpTool } from "../../types";

export const SupplyToMarketTool: McpTool = {
    name: "kilolend_supply_to_lending",
    description: "Supply tokens to a KiloLend lending market on any supported network",
    schema: {
        token_symbol: z.string()
            .describe("Token symbol to supply (e.g., KAIA, USDT, KUB, XTZ, BORA, SIX, MBX, stKAIA)"),
        amount: z.string()
            .describe("Amount to supply in token units (e.g., '100', '0.5')"),
        check_balance: z.boolean()
            .optional()
            .default(true)
            .describe("Check token balance before supplying (default: true)"),
        auto_approve: z.boolean()
            .optional()
            .default(true)
            .describe("Automatically approve token spending if needed (default: true)")
    },
    handler: async (agent: WalletAgent, input: Record<string, any>) => {
        try {
            if (!agent.isTransactionMode()) {
                throw new Error('Transaction mode required. Configure private key in environment to enable transactions.');
            }

            const tokenSymbol = input.token_symbol.trim();
            const amount = input.amount;
            const checkBalance = input.check_balance !== false;
            const autoApprove = input.auto_approve !== false;

            // Case-insensitive token resolution
            let resolvedToken = tokenSymbol;

            // Get current network info for context
            const networkInfo = agent.currentNetworkInfo;

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
                    // Update resolvedToken to match the found variation (remove 'c' prefix)
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

            // Check token balance if requested
            let balanceInfo = null;
            let allowanceInfo = null;

            if (checkBalance) {
                try {
                    const walletAddress = agent.getAddress();
                    if (walletAddress) {
                        const tokenAddresses = agent['getTokenAddresses']();
                        const tokenAddress = tokenAddresses[tokenSymbol];

                        if (tokenAddress && tokenAddress !== '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE') {
                            // ERC20 token balance check
                            const tokenBalance = await agent['getTokenBalance'](tokenAddress as `0x${string}`, walletAddress as `0x${string}`);
                            const tokenDecimals = agent['getTokenDecimals'](tokenSymbol);
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

                            // Check and handle allowance for ERC20 tokens
                            if (autoApprove) {
                                const currentAllowance = await agent.checkAllowance(tokenSymbol, cTokenAddress as any);
                                const amountWei = BigInt(requestedAmount * Math.pow(10, tokenDecimals));

                                if (BigInt(currentAllowance) < amountWei) {
                                    allowanceInfo = {
                                        current_allowance: currentAllowance.toString(),
                                        required_allowance: amountWei.toString(),
                                        needs_approval: true
                                    };
                                } else {
                                    allowanceInfo = {
                                        current_allowance: currentAllowance.toString(),
                                        needs_approval: false
                                    };
                                }
                            }
                        } else {
                            // Native token balance check
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
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    if (errorMsg.includes('Insufficient')) {
                        throw error;
                    }
                    // Continue if balance check fails for other reasons
                    console.warn('Balance check failed, proceeding with supply:', errorMsg);
                }
            }

            // Check if user is in the market, if not, enter market
            let marketEntered = false;
            try {
                const walletAddress = agent.getAddress();
                if (walletAddress) {
                    const isInMarket = await agent.checkMarketMembership(cTokenAddress as any);
                    if (!isInMarket) {
                        await agent.enterMarkets([cTokenAddress as any]);
                        marketEntered = true;
                    }
                }
            } catch (error) {
                console.warn('Market entry check failed, proceeding with supply:', error);
            }

            const txHash = await agent.supplyToMarket(tokenSymbol, amount);

            return {
                status: "success",
                message: `✅ Successfully supplied ${amount} ${tokenSymbol} to lending market`,
                transaction_hash: txHash,
                details: {
                    token_symbol: tokenSymbol,
                    ctoken_symbol: `c${tokenSymbol}`,
                    ctoken_address: cTokenAddress,
                    supply_amount: amount,
                    network: {
                        name: networkInfo.name || 'Unknown',
                        chain_id: networkInfo.chainId,
                        native_currency: networkInfo.nativeCurrency
                    },
                    explorer_url: `${networkInfo.blockExplorer}/tx/${txHash}`
                },
                balance_info: balanceInfo ? {
                    token_balance: Number(balanceInfo.token_balance).toLocaleString(),
                    balance_formatted: balanceInfo.balance_formatted,
                    token_decimals: balanceInfo.token_decimals
                } : null,
                allowance_info: allowanceInfo,
                market_info: {
                    entered_market: marketEntered,
                    ctoken_received: `c${tokenSymbol}`
                },
                recommendations: [
                    "Wait for transaction confirmation before using your supplied tokens as collateral",
                    "Check your account liquidity to see increased borrowing capacity",
                    "Supplied tokens will start earning interest based on market supply rates",
                    "Monitor the supply APY which may change based on market conditions",
                    "Consider enabling your supplied assets as collateral for borrowing",
                    "Track your position regularly to manage risk effectively"
                ]
            };
        } catch (error: any) {
            throw new Error(`Failed to supply to market: ${error.message}`);
        }
    }
};