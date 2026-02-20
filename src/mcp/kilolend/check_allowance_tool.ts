import { z } from "zod";
import { WalletAgent } from "../../agent/wallet";
import { type McpTool } from "../../types";

export const CheckAllowanceTool: McpTool = {
    name: "kilolend_check_allowance",
    description: "Check token allowance for KiloLend operations on any supported network",
    schema: {
        token_symbol: z.string()
            .describe("Token symbol to check allowance for (e.g., KAIA, USDT, KUB, XTZ, BORA, SIX, MBX, stKAIA)"),
        spender_address: z.string()
            .optional()
            .describe("Spender address to check allowance for (optional, defaults to cToken address for the token)")
    },
    handler: async (agent: WalletAgent, input: Record<string, any>) => {
        try {
            const tokenSymbol = input.token_symbol.trim();
            
            // Case-insensitive token resolution
            let resolvedToken = tokenSymbol;

            // Get token addresses and try case-insensitive matching
            const tokenAddresses = agent['getTokenAddresses']();

            // Try different case variations
            let tokenAddress = tokenAddresses[resolvedToken];
            if (!tokenAddress) {
                const variations = [
                    tokenSymbol,
                    tokenSymbol.toUpperCase(),
                    tokenSymbol.toLowerCase(),
                    'StKAIA', // Specific for StKAIA
                    'stKAIA',
                    'STKAIA'
                ];
                
                for (const variation of variations) {
                    if (tokenAddresses[variation]) {
                        tokenAddress = tokenAddresses[variation];
                        resolvedToken = variation;
                        break;
                    }
                }
            }

            if (!tokenAddress) {
                const availableTokens = Object.keys(tokenAddresses).join(', ');
                throw new Error(`Token ${tokenSymbol} not available on current network. Available tokens: ${availableTokens}`);
            }
            
            // Get current network info for context
            const networkInfo = agent.currentNetworkInfo;
            
            // Default spender address logic - if not provided, we'll use the cToken address
            let spenderAddress = input.spender_address;
            if (!spenderAddress) {
                // Get cToken addresses for current network to find the appropriate spender
                const contracts = agent['getContractAddresses']();
                
                // Try to find cToken with case variations
                let cTokenAddress = null;
                const cTokenVariations = [
                    `c${resolvedToken}`,
                    `c${resolvedToken.toUpperCase()}`,
                    `c${resolvedToken.toLowerCase()}`,
                    `cStKAIA`, // Specific for StKAIA
                    `cstKAIA`,
                    `cSTKAIA`
                ];
                
                for (const variation of cTokenVariations) {
                    if (contracts[variation as keyof typeof contracts]) {
                        cTokenAddress = contracts[variation as keyof typeof contracts];
                        break;
                    }
                }
                
                if (!cTokenAddress) {
                    const availableTokens = Object.keys(contracts)
                        .filter(k => k.startsWith('c'))
                        .map(k => k.substring(1))
                        .join(', ');
                    throw new Error(`Market ${tokenSymbol} not available on current network. Available tokens: ${availableTokens}`);
                }
                spenderAddress = cTokenAddress as string;
            }

            const allowance = await agent['checkAllowance'](resolvedToken, spenderAddress as `0x${string}`);

            // Get token decimals for proper formatting
            const tokenDecimals = agent['getTokenDecimals'] ? agent['getTokenDecimals'](resolvedToken) : 18;
            const allowanceFormatted = Number(allowance) / Math.pow(10, tokenDecimals);

            // Determine if allowance is sufficient for operations
            const maxUint256 = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');
            const isMaxAllowance = BigInt(allowance) >= maxUint256 / BigInt(2); // Consider >= half of max as "max"
            const hasAllowance = BigInt(allowance) > 0;

            return {
                status: "success",
                message: `✅ Allowance checked successfully`,
                details: {
                    token_symbol: resolvedToken,
                    spender_address: spenderAddress,
                    allowance: allowance,
                    allowance_formatted: allowanceFormatted.toString(),
                    network: {
                        name: networkInfo.name || 'Unknown',
                        chain_id: networkInfo.chainId,
                        native_currency: networkInfo.nativeCurrency
                    },
                    allowance_status: {
                        has_allowance: hasAllowance,
                        is_max_allowance: isMaxAllowance,
                        needs_approval: !hasAllowance,
                        sufficient_for_operations: hasAllowance && !isMaxAllowance ? 'Yes' : isMaxAllowance ? 'Yes (Max)' : 'No'
                    }
                },
                recommendations: [
                    hasAllowance ? 
                        (isMaxAllowance ? 
                            "✅ Token has maximum allowance - no approval needed" : 
                            "⚠️ Token has limited allowance - consider approving max amount") :
                        "❌ No allowance found - token approval required before operations",
                    "Use kilolend_approve_token tool to set allowance",
                    "Check allowance before supply, borrow, or redeem operations",
                    "Monitor allowance changes for security"
                ]
            };
        } catch (error: any) {
            throw new Error(`Failed to check allowance: ${error.message}`);
        }
    }
};