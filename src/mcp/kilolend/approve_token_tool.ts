import { z } from "zod";
import { WalletAgent } from "../../agent/wallet";
import { type McpTool } from "../../types";

export const ApproveTokenTool: McpTool = {
    name: "kilolend_approve_token",
    description: "Approve token for KiloLend operations on any supported network",
    schema: {
        token_symbol: z.string()
            .describe("Token symbol to approve (e.g., KAIA, USDT, KUB, XTZ, BORA, SIX, MBX, stKAIA)"),
        amount: z.string()
            .optional()
            .describe("Amount to approve (optional, defaults to max uint256)"),
        spender_address: z.string()
            .optional()
            .describe("Spender address to approve for (optional, defaults to cToken address for the token)")
    },
    handler: async (agent: WalletAgent, input: Record<string, any>) => {
        try {
            if (!agent.isTransactionMode()) {
                throw new Error('Transaction mode required. Configure private key in environment to enable transactions.');
            }

            const tokenSymbol = input.token_symbol.toUpperCase();
            
            // Get current network info for context
            const networkInfo = agent.currentNetworkInfo;
            
            // Default spender address logic - if not provided, we'll use the cToken address
            let spenderAddress = input.spender_address;
            if (!spenderAddress) {
                // Get cToken addresses for current network to find the appropriate spender
                const contracts = agent['getContractAddresses']();
                const cTokenKey = `c${tokenSymbol}`;
                const cTokenAddress = contracts[cTokenKey as keyof typeof contracts];
                
                if (!cTokenAddress) {
                    throw new Error(`Market ${tokenSymbol} not available on current network. Available tokens: ${Object.keys(contracts).filter(k => k.startsWith('c')).map(k => k.substring(1)).join(', ')}`);
                }
                spenderAddress = cTokenAddress as string;
            }

            const txHash = await agent['approveToken'](
                tokenSymbol,
                spenderAddress as `0x${string}`,
                input.amount
            );

            return {
                status: "success",
                message: "✅ Token approved successfully",
                transaction_hash: txHash,
                details: {
                    token_symbol: tokenSymbol,
                    spender_address: spenderAddress,
                    amount: input.amount || 'max uint256',
                    network: {
                        name: networkInfo.name || 'Unknown',
                        chain_id: networkInfo.chainId,
                        native_currency: networkInfo.nativeCurrency
                    },
                    explorer_url: `${networkInfo.blockExplorer}/tx/${txHash}`
                },
                recommendations: [
                    "Save the transaction hash for reference",
                    "Wait for transaction confirmation",
                    "You can now use the token in KiloLend operations",
                    "Check token allowance if needed"
                ]
            };
        } catch (error: any) {
            throw new Error(`Failed to approve token: ${error.message}`);
        }
    }
};