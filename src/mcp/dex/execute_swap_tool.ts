import { z } from 'zod';
import { formatEther, parseEther, maxUint256 } from 'viem';
import { publicClient, walletClient, network, getContractAddresses, getTokenConfigs, findTokenBySymbol, agentMode } from '../../config';
import { TransactionResult, KiloLendError, NetworkError, TransactionError, InsufficientBalanceError } from '../../types';
import { McpTool } from '../../types';
import { ERC20_ABI } from '../../contracts/erc20';

// Swap Router V2 ABI for executing swaps
const SWAP_ROUTER_V2_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' }
        ],
        name: 'params',
        type: 'tuple'
      }
    ],
    name: 'exactInputSingle',
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function'
  }
] as const;

const ExecuteSwapTool: McpTool = {
  name: 'execute_swap',
  description: 'Execute token swap on DEX (KAIA and KUB chains only)',
  schema: {
    tokenIn: z.string().describe('Symbol of token to sell (e.g., "USDT", "WKAIA", "KLAW")'),
    tokenOut: z.string().describe('Symbol of token to buy (e.g., "USDT", "WKAIA", "KLAW")'),
    amountIn: z.string().describe('Amount of input tokens to sell (in human-readable format, e.g., "100.5")'),
    minimumAmountOut: z.string().describe('Minimum amount of output tokens to receive (in human-readable format)'),
    slippageTolerance: z.string().optional().default('0.5').describe('Slippage tolerance in percentage (e.g., "0.5" for 0.5%)'),
    deadlineMinutes: z.number().optional().default(20).describe('Transaction deadline in minutes'),
  },
  handler: async (agent, input) => {
    try {
      if (agentMode === 'readonly') {
        throw new KiloLendError('Cannot execute swaps in readonly mode. Please switch to transaction mode.');
      }

      // Check if DEX is supported on this network
      if (network === 'etherlink') {
        throw new KiloLendError('DEX operations are not supported on Etherlink network. Only KAIA and KUB chains support DEX swapping.');
      }

      const { tokenIn, tokenOut, amountIn, minimumAmountOut, slippageTolerance, deadlineMinutes } = input;

      // Validate inputs
      if (!tokenIn || !tokenOut || !amountIn || !minimumAmountOut) {
        throw new KiloLendError('tokenIn, tokenOut, amountIn, and minimumAmountOut are required');
      }

      if (parseFloat(amountIn) <= 0) {
        throw new KiloLendError('Amount must be greater than 0');
      }

      if (parseFloat(minimumAmountOut) <= 0) {
        throw new KiloLendError('Minimum amount out must be greater than 0');
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
      if (!contracts.SwapRouterV2) {
        throw new KiloLendError(`SwapRouterV2 contract not configured for ${network} network`);
      }

      // Get wallet address
      const walletAddress = walletClient.account.address;

      // Parse amounts
      const amountInWei = parseEther(amountIn);
      const minimumAmountOutWei = parseEther(minimumAmountOut);

      // Calculate deadline
      const deadline = Math.floor(Date.now() / 1000) + (deadlineMinutes || 20) * 60;

      // Check if input token is native token
      const isNativeIn = tokenInConfig.address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'.toLowerCase();
      let approvalTx: string | undefined;

      // If not native token, check balance and approve if needed
      if (!isNativeIn) {
        // Check token balance
        const tokenBalance = await publicClient.readContract({
          address: tokenInConfig.address as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [walletAddress],
        });

        if (tokenBalance < amountInWei) {
          const balanceFormatted = formatEther(tokenBalance);
          throw new InsufficientBalanceError(
            `Insufficient ${tokenIn} balance. Available: ${balanceFormatted} ${tokenIn}, Required: ${amountIn} ${tokenIn}`
          );
        }

        // Check allowance
        const allowance = await publicClient.readContract({
          address: tokenInConfig.address as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [walletAddress, contracts.SwapRouterV2],
        });

        // If allowance is insufficient, approve the router
        if (allowance < amountInWei) {
          approvalTx = await walletClient.writeContract({
            address: tokenInConfig.address as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [contracts.SwapRouterV2, maxUint256],
          });

          // Wait for approval transaction
          await publicClient.waitForTransactionReceipt({
            hash: approvalTx,
          });
        }
      } else {
        // Check native token balance
        const nativeBalance = await publicClient.getBalance({ address: walletAddress });
        
        if (nativeBalance < amountInWei) {
          const balanceFormatted = formatEther(nativeBalance);
          throw new InsufficientBalanceError(
            `Insufficient ${tokenIn} balance. Available: ${balanceFormatted} ${tokenIn}, Required: ${amountIn} ${tokenIn}`
          );
        }
      }

      // Execute the swap
      const swapTx = await walletClient.writeContract({
        address: contracts.SwapRouterV2 as `0x${string}`,
        abi: SWAP_ROUTER_V2_ABI,
        functionName: 'exactInputSingle',
        args: [
          {
            tokenIn: tokenInConfig.address,
            tokenOut: tokenOutConfig.address,
            fee: 3000, // 0.3% fee tier
            recipient: walletAddress,
            deadline: BigInt(deadline),
            amountIn: amountInWei,
            amountOutMinimum: minimumAmountOutWei,
            sqrtPriceLimitX96: 0n, // No price limit
          }
        ],
        value: isNativeIn ? amountInWei : undefined,
      });

      // Wait for swap transaction confirmation
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: swapTx,
      });

      const result: TransactionResult = {
        hash: swapTx,
        status: receipt.status === 'success' ? 'success' : 'failed',
        blockNumber: receipt.blockNumber ? Number(receipt.blockNumber) : undefined,
        gasUsed: receipt.gasUsed ? receipt.gasUsed.toString() : undefined,
      };

      if (result.status === 'failed') {
        throw new TransactionError('Swap transaction failed');
      }

      return {
        success: true,
        message: `Successfully swapped ${amountIn} ${tokenIn} to ${tokenOut}`,
        transaction: result,
        details: {
          tokenIn: {
            symbol: tokenIn,
            address: tokenInConfig.address,
            amount: amountIn,
            amountWei: amountInWei.toString()
          },
          tokenOut: {
            symbol: tokenOut,
            address: tokenOutConfig.address,
            minimumAmount: minimumAmountOut,
            minimumAmountWei: minimumAmountOutWei.toString()
          },
          swapDetails: {
            feeTier: '0.3%',
            slippageTolerance: `${slippageTolerance}%`,
            deadlineMinutes: deadlineMinutes,
            approvalTransaction: approvalTx
          },
          network: network,
          routerAddress: contracts.SwapRouterV2
        }
      };

    } catch (error) {
      if (error instanceof KiloLendError || error instanceof NetworkError || error instanceof TransactionError || error instanceof InsufficientBalanceError) {
        throw error;
      }

      // Handle RPC/network errors
      if (error instanceof Error) {
        if (error.message.includes('network') || error.message.includes('RPC')) {
          throw new NetworkError(`Network error while executing swap: ${error.message}`);
        }
        if (error.message.includes('liquidity') || error.message.includes('pool')) {
          throw new KiloLendError(`Insufficient liquidity for this swap pair: ${error.message}`);
        }
        if (error.message.includes('slippage')) {
          throw new KiloLendError(`Slippage tolerance exceeded: ${error.message}`);
        }
      }

      throw new KiloLendError(`Unexpected error executing swap: ${error}`);
    }
  }
};

export default ExecuteSwapTool;