import { z } from 'zod';
import { parseUnits, formatEther } from 'viem';
import { publicClient, walletClient, agentMode } from '../../config';
import { TransactionResult, KiloLendError, NetworkError, TransactionError, InsufficientBalanceError } from '../../types';
import { McpTool } from '../../types';

// AIAgentToken ABI for burn function
const AI_AGENT_TOKEN_ABI = [
    {
        "inputs": [
            {"internalType": "uint256", "name": "amount", "type": "uint256"}
        ],
        "name": "burn",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "address", "name": "account", "type": "address"}
        ],
        "name": "isAIAgent",
        "outputs": [
            {"internalType": "bool", "name": "", "type": "bool"}
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "address", "name": "account", "type": "address"}
        ],
        "name": "isCreator",
        "outputs": [
            {"internalType": "bool", "name": "", "type": "bool"}
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "balanceOf",
        "outputs": [
            {"internalType": "uint256", "name": "", "type": "uint256"}
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "decimals",
        "outputs": [
            {"internalType": "uint8", "name": "", "type": "uint8"}
        ],
        "stateMutability": "view",
        "type": "function"
    }
] as const;

const BurnTokensTool: McpTool = {
    name: 'burn_ai_agent_tokens',
    description: 'Burn AI Agent tokens from the caller\'s wallet. Requires AI Agent burner role or Creator role.',
    schema: {
        tokenAddress: z.string()
            .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address format')
            .describe('Contract address of the AI Agent token'),
        amount: z.string()
            .refine((val) => parseFloat(val) > 0, 'Amount must be greater than 0')
            .describe('Amount of tokens to burn (in human-readable format, e.g., "1000.5")'),
        decimals: z.number()
            .int()
            .min(0)
            .max(18)
            .optional()
            .default(18)
            .describe('Token decimals (default: 18)'),
    },
    handler: async (agent, input) => {
        try {
            if (agentMode === 'readonly') {
                throw new KiloLendError('Cannot burn tokens in readonly mode. Please switch to transaction mode.');
            }

            const { tokenAddress, amount, decimals } = input;

            // Validate inputs
            if (!tokenAddress || !amount) {
                throw new KiloLendError('tokenAddress and amount are required');
            }

            if (parseFloat(amount) <= 0) {
                throw new KiloLendError('Amount must be greater than 0');
            }

            // Get wallet address
            const walletAddress = walletClient.account.address;

            try {
                // Check if caller has burn permissions
                const [isAIAgent, isCreator] = await Promise.all([
                    publicClient.readContract({
                        address: tokenAddress as `0x${string}`,
                        abi: AI_AGENT_TOKEN_ABI,
                        functionName: 'isAIAgent',
                        args: [walletAddress],
                    }),
                    publicClient.readContract({
                        address: tokenAddress as `0x${string}`,
                        abi: AI_AGENT_TOKEN_ABI,
                        functionName: 'isCreator',
                        args: [walletAddress],
                    })
                ]) as [boolean, boolean];

                if (!isAIAgent && !isCreator) {
                    throw new KiloLendError('Caller does not have burn permission. Requires AI Agent or Creator role.');
                }

                // Get token balance to ensure sufficient funds
                const balance = await publicClient.readContract({
                    address: tokenAddress as `0x${string}`,
                    abi: AI_AGENT_TOKEN_ABI,
                    functionName: 'balanceOf',
                    args: [walletAddress],
                }) as bigint;

                // Convert amount to wei
                const amountWei = parseUnits(amount, decimals);

                // Check if sufficient balance
                if (balance < amountWei) {
                    const balanceFormatted = formatEther(balance);
                    throw new InsufficientBalanceError(
                        `Insufficient token balance. Available: ${balanceFormatted}, Required: ${amount}`
                    );
                }

                // Execute burn transaction
                const txHash = await walletClient.writeContract({
                    address: tokenAddress as `0x${string}`,
                    abi: AI_AGENT_TOKEN_ABI,
                    functionName: 'burn',
                    args: [amountWei],
                });

                // Wait for transaction confirmation
                const receipt = await publicClient.waitForTransactionReceipt({
                    hash: txHash,
                });

                const result: TransactionResult = {
                    hash: txHash,
                    status: receipt.status === 'success' ? 'success' : 'failed',
                    blockNumber: receipt.blockNumber ? Number(receipt.blockNumber) : undefined,
                    gasUsed: receipt.gasUsed ? receipt.gasUsed.toString() : undefined,
                };

                if (result.status === 'failed') {
                    throw new TransactionError('Transaction failed during token burning');
                }

                return {
                    success: true,
                    message: `Successfully burned ${amount} tokens`,
                    transaction: result,
                    details: {
                        amount,
                        amountWei: amountWei.toString(),
                        tokenAddress,
                        decimals,
                        role: isAIAgent ? 'AI Agent' : 'Creator',
                        network: agentMode,
                    },
                };

            } catch (error) {
                // Handle contract-specific errors
                if (error instanceof Error) {
                    if (error.message.includes('execution reverted')) {
                        throw new KiloLendError(`Contract execution failed: ${error.message}`);
                    }
                    if (error.message.includes('insufficient balance')) {
                        throw new InsufficientBalanceError(`Insufficient balance for token burning: ${error.message}`);
                    }
                }
                throw error;
            }

        } catch (error) {
            if (error instanceof KiloLendError || error instanceof NetworkError || error instanceof TransactionError || error instanceof InsufficientBalanceError) {
                throw error;
            }

            // Handle RPC/network errors
            if (error instanceof Error) {
                if (error.message.includes('network') || error.message.includes('RPC')) {
                    throw new NetworkError(`Network error while burning tokens: ${error.message}`);
                }
            }

            throw new KiloLendError(`Unexpected error burning AI Agent tokens: ${error}`);
        }
    },
};

export default BurnTokensTool;
