import { z } from "zod";
import { WalletAgent } from "../../agent/wallet";
import { type McpTool } from "../../types";

export const SendNativeTokenTool: McpTool = {
    name: "kilolend_send_native_token",
    description: "Send native tokens to another address on any supported network",
    schema: {
        to_address: z.string()
            .describe("Recipient address"),
        amount: z.string()
            .describe("Amount to send in native tokens")
    },
    handler: async (agent: WalletAgent, input: Record<string, any>) => {
        try {
            if (!agent.isTransactionMode()) {
                throw new Error('Transaction mode required. Configure private key in environment to enable transactions.');
            }
            
            const txHash = await agent.sendNativeToken(
                input.to_address as any,
                input.amount
            );

            // Get current network info for explorer URL
            const networkInfo = agent.currentNetworkInfo;

            return {
                status: "success",
                message: "✅ Native tokens sent successfully",
                transaction_hash: txHash,
                details: {
                    to_address: input.to_address,
                    amount: input.amount,
                    network: networkInfo.name,
                    chain_id: networkInfo.chainId,
                    native_currency: networkInfo.nativeCurrency,
                    explorer_url: `${networkInfo.blockExplorer}/tx/${txHash}`
                },
                recommendations: [
                    "Save the transaction hash for reference",
                    "Wait for transaction confirmation",
                    "Check recipient address to ensure funds arrived"
                ]
            };
        } catch (error: any) {
            throw new Error(`Failed to send native tokens: ${error.message}`);
        }
    }
};