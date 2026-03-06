import { z } from 'zod';
import { formatEther, parseEther } from 'viem';
import { publicClient, network, getContractAddresses, getTokenConfigs, findTokenBySymbol } from '../../config';
import { KiloLendError, NetworkError } from '../../types';
import { McpTool } from '../../types';

// Quoter V2 ABI for getting swap quotes
const QUOTER_V2_ABI = [
  {
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'fee', type: 'uint24' }
    ],
    name: 'quoteExactInputSingle',
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountOut', type: 'uint256' },
      { name: 'fee', type: 'uint24' }
    ],
    name: 'quoteExactOutputSingle',
    outputs: [{ name: 'amountIn', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const;

const GetSwapQuoteTool: McpTool = {
  name: 'get_swap_quote',
  description: 'Get swap quote for token exchange (KAIA and KUB chains only)',
  schema: {
    tokenIn: z.string().describe('Symbol of token to sell (e.g., "USDT", "WKAIA", "KLAW")'),
    tokenOut: z.string().describe('Symbol of token to buy (e.g., "USDT", "WKAIA", "KLAW")'),
    amountIn: z.string().describe('Amount of input tokens to sell (in human-readable format, e.g., "100.5")'),
    slippageTolerance: z.string().optional().default('0.5').describe('Slippage tolerance in percentage (e.g., "0.5" for 0.5%)'),
  },
  handler: async (agent, input) => {
    try {
      // Check if DEX is supported on this network
      if (network === 'etherlink') {
        throw new KiloLendError('DEX operations are not supported on Etherlink network. Only KAIA and KUB chains support DEX swapping.');
      }

      const { tokenIn, tokenOut, amountIn, slippageTolerance } = input;

      // Validate inputs
      if (!tokenIn || !tokenOut || !amountIn) {
        throw new KiloLendError('tokenIn, tokenOut, and amountIn are required');
      }

      if (parseFloat(amountIn) <= 0) {
        throw new KiloLendError('Amount must be greater than 0');
      }

      if (tokenIn === tokenOut) {
        throw new KiloLendError('tokenIn and tokenOut cannot be the same');
      }

      // Get token configurations
      const tokenInConfig = findTokenBySymbol(network, tokenIn);
      const tokenOutConfig = findTokenBySymbol(network, tokenOut);

      if (!tokenInConfig) {
        throw new KiloLendError(`Token ${tokenIn} not found on ${network} network`);
      }

      if (!tokenOutConfig) {
        throw new KiloLendError(`Token ${tokenOut} not found on ${network} network`);
      }

      // Get DEX contracts
      const contracts = getContractAddresses(network) as any;
      if (!contracts.QuoterV2) {
        throw new KiloLendError(`QuoterV2 contract not configured for ${network} network`);
      }

      // Parse amount based on token decimals
      const amountInWei = parseEther(amountIn); // Most tokens use 18 decimals, simplified for now

      // Get quote from Quoter V2
      const amountOut = await publicClient.readContract({
        address: contracts.QuoterV2 as `0x${string}`,
        abi: QUOTER_V2_ABI,
        functionName: 'quoteExactInputSingle',
        args: [
          tokenInConfig.address as `0x${string}`,
          tokenOutConfig.address as `0x${string}`,
          amountInWei,
          3000 // 0.3% fee tier (standard for most pools)
        ],
      });

      // Calculate expected amounts
      const amountOutFormatted = formatEther(amountOut);
      const slippageTolerancePercent = parseFloat(slippageTolerance || '0.5') / 100;
      const minimumAmountOut = (parseFloat(amountOutFormatted) * (1 - slippageTolerancePercent)).toString();

      // Get token prices for additional context
      const tokens = getTokenConfigs(network);
      const tokenInInfo = tokens.find(t => t.symbol === tokenIn);
      const tokenOutInfo = tokens.find(t => t.symbol === tokenOut);

      return {
        success: true,
        message: `Quote received for swapping ${amountIn} ${tokenIn} to ${tokenOut}`,
        quote: {
          tokenIn: {
            symbol: tokenIn,
            address: tokenInConfig.address,
            decimals: tokenInConfig.decimals,
            amount: amountIn,
            amountWei: amountInWei.toString()
          },
          tokenOut: {
            symbol: tokenOut,
            address: tokenOutConfig.address,
            decimals: tokenOutConfig.decimals,
            expectedAmount: amountOutFormatted,
            expectedAmountWei: amountOut.toString(),
            minimumAmount: minimumAmountOut
          },
          swapDetails: {
            feeTier: '0.3%',
            slippageTolerance: `${slippageTolerance}%`,
            priceImpact: 'Unknown' // Would need more complex calculation
          },
          network: network,
          quoterAddress: contracts.QuoterV2
        }
      };

    } catch (error) {
      if (error instanceof KiloLendError || error instanceof NetworkError) {
        throw error;
      }

      // Handle RPC/network errors
      if (error instanceof Error) {
        if (error.message.includes('network') || error.message.includes('RPC')) {
          throw new NetworkError(`Network error while getting swap quote: ${error.message}`);
        }
        if (error.message.includes('liquidity') || error.message.includes('pool')) {
          throw new KiloLendError(`Insufficient liquidity for this swap pair: ${error.message}`);
        }
      }

      throw new KiloLendError(`Unexpected error getting swap quote: ${error}`);
    }
  }
};

export default GetSwapQuoteTool;