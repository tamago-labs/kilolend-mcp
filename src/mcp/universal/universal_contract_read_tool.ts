import { z } from 'zod';
import { publicClient, network, getContractAddresses } from '../../config';
import { KiloLendError, NetworkError } from '../../types';
import { McpTool } from '../../types';

const UniversalContractReadTool: McpTool = {
  name: 'universal_contract_read',
  description: 'Execute read-only calls on any smart contract by providing contract address, ABI, and function parameters',
  schema: {
    contractAddress: z.string().describe('Contract address to interact with (0x...)'),
    abi: z.string().describe('Contract ABI as JSON string or array'),
    functionName: z.string().describe('Name of the function to call'),
    args: z.array(z.any()).optional().describe('Array of arguments for the function'),
    network: z.string().optional().describe('Network to use (overrides current network)'),
  },
  handler: async (agent, input) => {
    try {
      const { contractAddress, abi, functionName, args = [], network: networkOverride } = input;

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

      // Check if function is view/pure (read-only)
      if (functionDefinition.stateMutability && 
          !['view', 'pure'].includes(functionDefinition.stateMutability)) {
        throw new KiloLendError(`Function '${functionName}' is not read-only. Use universal_contract_write for state-changing functions.`);
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

      try {
        // Execute the read contract call
        const result = await publicClient.readContract({
          address: contractAddress as `0x${string}`,
          abi: parsedAbi,
          functionName,
          args,
        });

        // Format the result for better readability
        const formattedResult = {
          success: true,
          message: `Successfully executed read call '${functionName}' on contract ${contractAddress}`,
          result: {
            functionName,
            contractAddress,
            network: targetNetwork,
            arguments: args,
            returnValue: result,
            returnType: functionDefinition.outputs?.map((output: any) => output.type).join(', ') || 'unknown',
            timestamp: new Date().toISOString(),
          }
        };

        return formattedResult;

      } catch (contractError) {
        if (contractError instanceof Error) {
          if (contractError.message.includes('revert')) {
            throw new KiloLendError(`Contract call reverted: ${contractError.message}`);
          }
          if (contractError.message.includes('execution reverted')) {
            throw new KiloLendError(`Contract execution reverted: ${contractError.message}`);
          }
          if (contractError.message.includes('invalid argument')) {
            throw new KiloLendError(`Invalid function arguments: ${contractError.message}`);
          }
        }
        throw contractError;
      }

    } catch (error) {
      if (error instanceof KiloLendError || error instanceof NetworkError) {
        throw error;
      }

      // Handle RPC/network errors
      if (error instanceof Error) {
        if (error.message.includes('network') || error.message.includes('RPC')) {
          throw new NetworkError(`Network error while reading contract: ${error.message}`);
        }
        if (error.message.includes('timeout')) {
          throw new NetworkError(`Request timeout while reading contract: ${error.message}`);
        }
      }

      throw new KiloLendError(`Unexpected error reading contract: ${error}`);
    }
  }
};

export default UniversalContractReadTool;