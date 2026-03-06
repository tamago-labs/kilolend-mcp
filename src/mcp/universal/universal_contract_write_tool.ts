import { z } from 'zod';
import { parseEther, formatEther } from 'viem';
import { publicClient, walletClient, network, getContractAddresses, agentMode } from '../../config';
import { TransactionResult, KiloLendError, NetworkError, TransactionError, InsufficientBalanceError } from '../../types';
import { McpTool } from '../../types';

const UniversalContractWriteTool: McpTool = {
  name: 'universal_contract_write',
  description: 'Execute state-changing calls on any smart contract by providing contract address, ABI, function parameters, and optional value',
  schema: {
    contractAddress: z.string().describe('Contract address to interact with (0x...)'),
    abi: z.string().describe('Contract ABI as JSON string or array'),
    functionName: z.string().describe('Name of the function to call'),
    args: z.array(z.any()).optional().describe('Array of arguments for the function'),
    value: z.string().optional().describe('Native token value to send with transaction (in human-readable format, e.g., "0.1")'),
    gasLimit: z.string().optional().describe('Custom gas limit for the transaction'),
    network: z.string().optional().describe('Network to use (overrides current network)'),
    simulate: z.boolean().optional().default(false).describe('Simulate transaction without executing (default: false)'),
  },
  handler: async (agent, input) => {
    try {
      if (agentMode === 'readonly') {
        throw new KiloLendError('Cannot execute contract writes in readonly mode. Please switch to transaction mode.');
      }

      const { 
        contractAddress, 
        abi, 
        functionName, 
        args = [], 
        value,
        gasLimit,
        network: networkOverride,
        simulate = false
      } = input;

      // Validate inputs
      if (!contractAddress || !abi || !functionName) {
        throw new KiloLendError('contractAddress, abi, and functionName are required');
      }

      // Validate contract address format
      if (!contractAddress.startsWith('0x') || contractAddress.length !== 42) {
        throw new KiloLendError('Invalid contract address format. Must be 42 characters starting with 0x');
      }

      // Parse ABI
      let parsedAbi;
      try {
        parsedAbi = typeof abi === 'string' ? JSON.parse(abi) : abi;
        if (!Array.isArray(parsedAbi)) {
          throw new KiloLendError('ABI must be an array of function definitions');
        }
      } catch (error) {
        throw new KiloLendError(`Invalid ABI format: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Find function in ABI
      const functionDefinition = parsedAbi.find((item: any) => 
        item.type === 'function' && item.name === functionName
      );

      if (!functionDefinition) {
        throw new KiloLendError(`Function '${functionName}' not found in provided ABI`);
      }

      // Check if function is payable when value is provided
      if (value && functionDefinition.stateMutability !== 'payable') {
        throw new KiloLendError(`Function '${functionName}' is not payable but value was provided`);
      }

      // Use current network or override
      const targetNetwork = networkOverride || network;

      // Validate function arguments
      if (functionDefinition.inputs && args.length !== functionDefinition.inputs.length) {
        throw new KiloLendError(
          `Argument count mismatch. Expected ${functionDefinition.inputs.length} arguments, got ${args.length}. ` +
          `Expected: [${functionDefinition.inputs.map((input: any) => input.name + ':' + input.type).join(', ')}]`
        );
      }

      // Parse value if provided
      let valueInWei: bigint | undefined;
      if (value) {
        try {
          const valueAmount = parseFloat(value);
          if (valueAmount <= 0) {
            throw new KiloLendError('Value must be greater than 0');
          }
          valueInWei = parseEther(value);
        } catch (error) {
          throw new KiloLendError(`Invalid value format: ${value}`);
        }
      }

      // Get wallet address for balance check
      const walletAddress = walletClient.account.address;

      // Check native token balance if value is required
      if (valueInWei) {
        const nativeBalance = await publicClient.getBalance({ address: walletAddress });
        
        if (nativeBalance < valueInWei) {
          const balanceFormatted = formatEther(nativeBalance);
          throw new InsufficientBalanceError(
            `Insufficient native token balance. Available: ${balanceFormatted}, Required: ${value}`
          );
        }
      }

      // Prepare transaction parameters
      const txParams: any = {
        address: contractAddress as `0x${string}`,
        abi: parsedAbi,
        functionName,
        args,
        value: valueInWei,
      };

      // Add custom gas limit if provided
      if (gasLimit) {
        try {
          txParams.gas = BigInt(gasLimit);
        } catch (error) {
          throw new KiloLendError(`Invalid gas limit format: ${gasLimit}`);
        }
      }

      try {
        let result;

        if (simulate) {
          // Simulate the transaction
          const simulation = await publicClient.simulateContract(txParams);
          
          result = {
            success: true,
            message: `Successfully simulated '${functionName}' call on contract ${contractAddress}`,
            result: {
              functionName,
              contractAddress,
              network: targetNetwork,
              arguments: args,
              value: value,
              simulationResult: simulation.result,
              gasEstimate: simulation.gas ? simulation.gas.toString() : 'unknown',
              gasPrice: simulation.gasPrice ? simulation.gasPrice.toString() : 'unknown',
              timestamp: new Date().toISOString(),
              simulated: true,
            }
          };
        } else {
          // Execute the actual transaction
          const txHash = await walletClient.writeContract(txParams);

          // Wait for transaction confirmation
          const receipt = await publicClient.waitForTransactionReceipt({
            hash: txHash,
          });

          const transactionResult: TransactionResult = {
            hash: txHash,
            status: receipt.status === 'success' ? 'success' : 'failed',
            blockNumber: receipt.blockNumber ? Number(receipt.blockNumber) : undefined,
            gasUsed: receipt.gasUsed ? receipt.gasUsed.toString() : undefined,
          };

          if (transactionResult.status === 'failed') {
            throw new TransactionError('Transaction failed during contract execution');
          }

          result = {
            success: true,
            message: `Successfully executed '${functionName}' call on contract ${contractAddress}`,
            transaction: transactionResult,
            result: {
              functionName,
              contractAddress,
              network: targetNetwork,
              arguments: args,
              value: value,
              gasUsed: transactionResult.gasUsed,
              blockNumber: transactionResult.blockNumber,
              timestamp: new Date().toISOString(),
              simulated: false,
            }
          };
        }

        return result;

      } catch (contractError) {
        if (contractError instanceof Error) {
          if (contractError.message.includes('revert')) {
            throw new KiloLendError(`Contract call reverted: ${contractError.message}`);
          }
          if (contractError.message.includes('execution reverted')) {
            throw new KiloLendError(`Contract execution reverted: ${contractError.message}`);
          }
          if (contractError.message.includes('insufficient funds')) {
            throw new InsufficientBalanceError(`Insufficient funds for transaction: ${contractError.message}`);
          }
          if (contractError.message.includes('gas')) {
            throw new TransactionError(`Gas-related error: ${contractError.message}`);
          }
          if (contractError.message.includes('invalid argument')) {
            throw new KiloLendError(`Invalid function arguments: ${contractError.message}`);
          }
        }
        throw contractError;
      }

    } catch (error) {
      if (error instanceof KiloLendError || error instanceof NetworkError || error instanceof TransactionError || error instanceof InsufficientBalanceError) {
        throw error;
      }

      // Handle RPC/network errors
      if (error instanceof Error) {
        if (error.message.includes('network') || error.message.includes('RPC')) {
          throw new NetworkError(`Network error while executing contract: ${error.message}`);
        }
        if (error.message.includes('timeout')) {
          throw new NetworkError(`Request timeout while executing contract: ${error.message}`);
        }
      }

      throw new KiloLendError(`Unexpected error executing contract: ${error}`);
    }
  }
};

export default UniversalContractWriteTool;