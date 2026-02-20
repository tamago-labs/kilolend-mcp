import { z } from "zod";
import { WalletAgent } from "../../agent/wallet";
import { type McpTool } from "../../types";

export const EnterMarketTool: McpTool = {
    name: "kilolend_enter_market",
    description: "Enter KiloLend markets to enable collateral usage on any supported network",
    schema: {
        token_symbols: z.array(z.string())
            .describe("Array of token symbols to enter markets for (e.g., ['KAIA', 'USDT', 'KUB', 'XTZ', 'BORA', 'SIX', 'MBX', 'stKAIA'])"),
        check_membership: z.boolean()
            .optional()
            .default(true)
            .describe("Check current market membership before entering (default: true)")
    },
    handler: async (agent: WalletAgent, input: Record<string, any>) => {
        try {
            if (!agent.isTransactionMode()) {
                throw new Error('Transaction mode required. Configure private key in environment to enable transactions.');
            }

            const tokenSymbols = input.token_symbols.map((sym: string) => sym.toUpperCase());
            const checkMembership = input.check_membership !== false;

            // Get current network info for context
            const networkInfo = agent.currentNetworkInfo;

            // Get cToken addresses for all tokens on current network
            const contracts = agent['getContractAddresses']();
            const cTokenAddresses: string[] = [];
            const membershipStatus: any[] = [];
            const unavailableTokens: string[] = [];

            for (const tokenSymbol of tokenSymbols) {
                const cTokenKey = `c${tokenSymbol}`;
                const cTokenAddress = contracts[cTokenKey as keyof typeof contracts];
                
                if (!cTokenAddress) {
                    unavailableTokens.push(tokenSymbol);
                    continue;
                }

                // Check current membership if requested
                if (checkMembership) {
                    try {
                        const isMember = await agent['checkMarketMembership'](cTokenAddress as `0x${string}`);
                        membershipStatus.push({
                            token_symbol: tokenSymbol,
                            ctoken_address: cTokenAddress,
                            is_member: isMember
                        });

                        // Only add to list if not already a member
                        if (!isMember) {
                            cTokenAddresses.push(cTokenAddress);
                        }
                    } catch (error) {
                        // If membership check fails, include the token for entry
                        membershipStatus.push({
                            token_symbol: tokenSymbol,
                            ctoken_address: cTokenAddress,
                            is_member: false,
                            error: 'Membership check failed'
                        });
                        cTokenAddresses.push(cTokenAddress);
                    }
                } else {
                    cTokenAddresses.push(cTokenAddress);
                }
            }

            // Handle unavailable tokens
            if (unavailableTokens.length > 0) {
                const availableTokens = Object.keys(contracts)
                    .filter(k => k.startsWith('c'))
                    .map(k => k.substring(1))
                    .join(', ');
                
                throw new Error(`Markets not available on current network: ${unavailableTokens.join(', ')}. Available tokens: ${availableTokens}`);
            }

            if (cTokenAddresses.length === 0) {
                return {
                    status: "success",
                    message: "✅ All requested markets already entered",
                    details: {
                        membership_status: membershipStatus,
                        network: {
                            name: networkInfo.name || 'Unknown',
                            chain_id: networkInfo.chainId,
                            native_currency: networkInfo.nativeCurrency
                        }
                    },
                    recommendations: [
                        "All tokens are already enabled as collateral",
                        "You can now use these tokens for borrowing",
                        "Consider checking your account liquidity"
                    ]
                };
            }

            const txHash = await agent['enterMarkets'](cTokenAddresses as `0x${string}`[]);

            return {
                status: "success",
                message: `✅ Successfully entered ${cTokenAddresses.length} markets`,
                transaction_hash: txHash,
                details: {
                    markets_entered: cTokenAddresses.map((addr, i) => {
                        const memberStatus = membershipStatus.find(s => s.ctoken_address === addr);
                        return {
                            token_symbol: memberStatus?.token_symbol || 'Unknown',
                            ctoken_address: addr
                        };
                    }),
                    membership_status: membershipStatus,
                    network: {
                        name: networkInfo.name || 'Unknown',
                        chain_id: networkInfo.chainId,
                        native_currency: networkInfo.nativeCurrency
                    },
                    explorer_url: `${networkInfo.blockExplorer}/tx/${txHash}`
                },
                recommendations: [
                    "Wait for transaction confirmation",
                    "Markets will be enabled as collateral after confirmation",
                    "You can now borrow against these tokens",
                    "Check account liquidity after entering markets",
                    "Monitor your health factor when borrowing"
                ]
            };
        } catch (error: any) {
            throw new Error(`Failed to enter markets: ${error.message}`);
        }
    }
};