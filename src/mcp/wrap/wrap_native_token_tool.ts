import { z } from 'zod';
import { formatEther, parseEther } from 'viem';
import { publicClient, walletClient, network, getContractAddresses, agentMode } from '../../config';
import { TransactionResult, KiloLendError, NetworkError, TransactionError, InsufficientBalanceError } from '../../types';
import { McpTool } from '../../types';

// Wrapped token ABI for wrap function
const WRAPPED_TOKEN_ABI = [
  {
    inputs: [],
    name: 'deposit',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  }
] as const;

const WrapNativeTokenTool: McpTool = {
  name: 'wrap_native_token',
  description: 'Wrap native tokens to wrapped tokens (KAIA→WKAIA, KUB→KKUB, XTZ→WXTZ)',
  schema: {
    amount: z.string().describe('Amount of native tokens to wrap (in human-readable format, e.g., "1.5")'),
  },
  handler: async (agent, input) => {
    try {
      if (agentMode === 'readonly') {
        throw new KiloLendError('Cannot wrap tokens in readonly mode. Please switch to transaction mode.');
      }

      const { amount } = input;
      
      // Validate amount
      if (!amount || parseFloat(amount) <= 0) {
        throw new KiloLendError('Amount must be greater than 0');
      }

      // Parse amount to wei
      const amountInWei = parseEther(amount);

      // Get the appropriate wrapped token address based on network
      const contracts = getContractAddresses(network) as any;
      let wrappedTokenAddress: string;
      let nativeSymbol: string;
      let wrappedSymbol: string;

      switch (network) {
        case 'kaia':
          if (!contracts.WKAIA) {
            throw new KiloLendError('WKAIA contract address not configured for KAIA network');
          }
          wrappedTokenAddress = contracts.WKAIA;
          nativeSymbol = 'KAIA';
          wrappedSymbol = 'WKAIA';
          break;
        case 'kub':
          if (!contracts.KKUB) {
            throw new KiloLendError('KKUB contract address not configured for KUB network');
          }
          wrappedTokenAddress = contracts.KKUB;
          nativeSymbol = 'KUB';
          wrappedSymbol = 'KKUB';
          break;
        case 'etherlink':
          if (!contracts.WXTZ) {
            throw new KiloLendError('WXTZ contract address not configured for Etherlink network');
          }
          wrappedTokenAddress = contracts.WXTZ;
          nativeSymbol = 'XTZ';
          wrappedSymbol = 'WXTZ';
          break;
        default:
          throw new KiloLendError(`Unsupported network: ${network}`);
      }

      // Get wallet address
      const walletAddress = walletClient.account.address;

      // Check native token balance
      const nativeBalance = await publicClient.getBalance({ address: walletAddress });
      
      if (nativeBalance < amountInWei) {
        const balanceFormatted = formatEther(nativeBalance);
        throw new InsufficientBalanceError(
          `Insufficient ${nativeSymbol} balance. Available: ${balanceFormatted} ${nativeSymbol}, Required: ${amount} ${nativeSymbol}`
        );
      }

      // Wrap the tokens by calling deposit function on wrapped token contract
      const txHash = await walletClient.writeContract({
        address: wrappedTokenAddress as `0x${string}`,
        abi: WRAPPED_TOKEN_ABI,
        functionName: 'deposit',
        value: amountInWei,
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
        throw new TransactionError('Transaction failed during token wrapping');
      }

      return {
        success: true,
        message: `Successfully wrapped ${amount} ${nativeSymbol} to ${wrappedSymbol}`,
        transaction: result,
        details: {
          wrappedAmount: amount,
          wrappedToken: wrappedSymbol,
          wrappedTokenAddress,
          nativeToken: nativeSymbol,
          network: network,
        }
      };

    } catch (error) {
      if (error instanceof KiloLendError || error instanceof NetworkError || error instanceof TransactionError || error instanceof InsufficientBalanceError) {
        throw error;
      }

      // Handle RPC/network errors
      if (error instanceof Error) {
        if (error.message.includes('network') || error.message.includes('RPC')) {
          throw new NetworkError(`Network error while wrapping tokens: ${error.message}`);
        }
      }

      throw new KiloLendError(`Unexpected error wrapping native tokens: ${error}`);
    }
  }
};

export default WrapNativeTokenTool;