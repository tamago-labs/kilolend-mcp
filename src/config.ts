import { Chain, createPublicClient, createWalletClient, http, WalletClient } from 'viem';
import { privateKeyToAccount, Address, Account, generatePrivateKey } from 'viem/accounts';
import { kaia } from 'viem/chains'
import { z } from 'zod';

// Define custom chains for KUB and Etherlink since they're not in viem/chains
const kub = {
  id: 96,
  name: 'KUB Chain',
  nativeCurrency: { name: 'KUB', symbol: 'KUB', decimals: 18 },
  rpcUrls: {
    public: { http: ['https://rpc.bitkubchain.io'] },
    default: { http: ['https://rpc.bitkubchain.io'] },
  },
  blockExplorers: {
    default: { name: 'KUB Scan', url: 'https://www.kubscan.com' },
  },
} as const;

const etherlink = {
  id: 42793,
  name: 'Etherlink',
  nativeCurrency: { name: 'Tezos', symbol: 'XTZ', decimals: 18 },
  rpcUrls: {
    public: { http: ['https://node.mainnet.etherlink.com'] },
    default: { http: ['https://node.mainnet.etherlink.com'] },
  },
  blockExplorers: {
    default: { name: 'Etherlink Explorer', url: 'https://explorer.etherlink.com' },
  },
} as const;

type NetworkType = 'kaia' | 'kub' | 'etherlink'

type AgentMode = 'readonly' | 'transaction';

interface NetworkConfig {
    rpcProviderUrl: string;
    blockExplorer: string;
    chain: Chain;
    chainId: number;
    nativeCurrency: string;
}

// KiloLend MCP Environment Configuration
export interface KiloLendMCPEnvironment {
    rpcUrl: string;
    privateKey?: string;
    agentMode: AgentMode;
    chainId: number;
    network: NetworkType;
}

// Validation schemas using zod
export const KiloLendMCPEnvironmentSchema = z.object({
    rpcUrl: z.string().url().describe("RPC URL"),
    privateKey: z.string().optional().describe("Wallet private key for transaction mode"),
    agentMode: z.enum(['readonly', 'transaction']).default('readonly').describe("Agent mode: readonly or transaction"),
    chainId: z.number().refine((val) => [8217, 42793, 96].includes(val), {
        message: "CHAIN_ID must be 8217 (KAIA), 42793 (Etherlink), or 96 (KUB)"
    }).describe("Chain ID"),
    network: z.enum(['kaia', 'kub', 'etherlink']).default('kaia').describe("Network to use")
});

export type KiloLendMCPEnvironmentInput = z.infer<typeof KiloLendMCPEnvironmentSchema>;

// Chain configurations for KiloLend multi-chain support
export const CHAIN_CONFIGS = {
  kaia: {
    chainId: 8217,
    chainName: 'KAIA',
    blocksPerYear: 15768000, // 2 second block time
    rpcUrl: 'https://public-en.node.kaia.io',
    blockExplorer: 'https://kaiascan.io',
    nativeCurrency: {
      name: 'KAIA',
      symbol: 'KAIA',
      decimals: 18
    }
  },
  kub: {
    chainId: 96,
    chainName: 'KUB',
    blocksPerYear: 6307200, // 5 second block time
    rpcUrl: 'https://rpc.bitkubchain.io',
    blockExplorer: 'https://www.kubscan.com',
    nativeCurrency: {
      name: 'KUB',
      symbol: 'KUB',
      decimals: 18
    }
  },
  etherlink: {
    chainId: 42793,
    chainName: 'Etherlink',
    blocksPerYear: 39420000, // 0.8 second block time
    rpcUrl: 'https://node.mainnet.etherlink.com',
    blockExplorer: 'https://explorer.etherlink.com',
    nativeCurrency: {
      name: 'Tezos',
      symbol: 'XTZ',
      decimals: 18
    }
  }
} as const;

// Smart Contract Addresses for each chain (System contracts and cTokens only)
export const CHAIN_CONTRACTS = {
  kaia: {
    // System contracts
    Comptroller: '0x2591d179a0B1dB1c804210E111035a3a13c95a48',
    KiloOracle: '0xE370336C3074E76163b2f9B07876d0Cb3425488D',
    StablecoinJumpRateModel: '0x9948DFaC28D39c2EeDB7543E24c28df2922568A6',
    VolatileRateModel: '0x836B1A7A6996cC04bA2387e691c7947679A1eF0d',
    // cToken contracts
    cUSDT: '0x20A2Cbc68fbee094754b2F03d15B1F5466f1F649',
    cSIX: '0x287770f1236AdbE3F4dA4f29D0f1a776f303C966',
    cBORA: '0xA7247a6f5EaC85354642e0E90B515E2dC027d5F4',
    cMBX: '0xa024B1DE3a6022FB552C2ED9a8050926Fb22d7b6',
    cKAIA: '0x2029f3E3C667EBd68b1D29dbd61dc383BdbB56e5',
    cStKAIA: '0x8A424cCf2D2B7D85F1DFb756307411D2BBc73e07'
  },
  kub: {
    // System contracts
    Comptroller: '0x42f098E6aE5e81f357D3fD6e104BAA77A195133A',
    KiloOracle: '0xE370336C3074E76163b2f9B07876d0Cb3425488D',
    StablecoinRateModel: '0x7a4399356987E22156b9a0f8449E0a5a9713D5a6',
    VolatileRateModel: '0x790057160a6B183C80C0514f644eA6BCE9EDa0D4',
    // cToken contracts
    cKUSDT: '0x5E9aF11F9a09174B87550B4Bfb4EdE65De933085',
    cKUB: '0x0cA8DaD1e517a9BB760Ba0C27051C4C3A036eA75'
  },
  etherlink: {
    // System contracts
    Comptroller: '0x42f098E6aE5e81f357D3fD6e104BAA77A195133A',
    KiloOracle: '0xE370336C3074E76163b2f9B07876d0Cb3425488D',
    StablecoinRateModel: '0x7a4399356987E22156b9a0f8449E0a5a9713D5a6',
    VolatileRateModel: '0x790057160a6B183C80C0514f644eA6BCE9EDa0D4',
    // cToken contracts
    cUSDT: '0x5E9aF11F9a09174B87550B4Bfb4EdE65De933085',
    cXTZ: '0x0cA8DaD1e517a9BB760Ba0C27051C4C3A036eA75'
  }
} as const;

// Token configurations for each chain
export const TOKEN_CONFIGS = {
  kaia: [
    {
      name: 'Tether USD',
      symbol: 'USDT',
      decimals: 6,
      address: '0xd077A400968890Eacc75cdc901F0356c943e4fDb'
    },
    {
      name: 'SIX Token',
      symbol: 'SIX',
      decimals: 18,
      address: '0xEf82b1C6A550e730D8283E1eDD4977cd01FAF435'
    },
    {
      name: 'BORA Token',
      symbol: 'BORA',
      decimals: 18,
      address: '0x02cbE46fB8A1F579254a9B485788f2D86Cad51aa'
    },
    {
      name: 'MARBLEX Token',
      symbol: 'MBX',
      decimals: 18,
      address: '0xD068c52d81f4409B9502dA926aCE3301cc41f623'
    },
    {
      name: 'KAIA',
      symbol: 'KAIA',
      decimals: 18,
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
    },
    {
      name: 'Lair Staked KAIA',
      symbol: 'stKAIA',
      decimals: 18,
      address: '0x42952b873ed6f7f0a7e4992e2a9818e3a9001995'
    }
  ],
  kub: [
    {
      name: 'KUB Tether USD',
      symbol: 'KUSDT',
      decimals: 6,
      address: '0x2C03058C8AFC06713be23e58D2febC8337dbfE6A'
    },
    {
      name: 'KUB Token',
      symbol: 'KUB',
      decimals: 18,
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
    }
  ],
  etherlink: [
    {
      name: 'Tether USD',
      symbol: 'USDT',
      decimals: 6,
      address: '0x2C03058C8AFC06713be23e58D2febC8337dbfE6A'
    },
    {
      name: 'Tezos',
      symbol: 'XTZ',
      decimals: 18,
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
    }
  ]
} as const;


export function getEnvironmentConfig(): KiloLendMCPEnvironment {
    // Validate required environment variables
    const required = ['RPC_URL', 'CHAIN_ID'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
        console.error(`💡 Please set the following in your .env file:`);
        console.error(`   RPC_URL=your_rpc_url_here`);
        console.error(`   CHAIN_ID=8217 (or 42793 or 96)`);
        throw new Error('Missing required KiloLend MCP configuration');
    }

    // Parse and validate CHAIN_ID
    const chainId = parseInt(process.env.CHAIN_ID!);
    if (![8217, 42793, 96].includes(chainId)) {
        throw new Error(`Invalid CHAIN_ID: ${chainId}. Must be 8217 (KAIA), 42793 (Etherlink), or 96 (KUB)`);
    }

    // Determine network from chainId
    let network: NetworkType;
    switch (chainId) {
        case 8217:
            network = 'kaia';
            break;
        case 42793:
            network = 'etherlink';
            break;
        case 96:
            network = 'kub';
            break;
        default:
            throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    const config: KiloLendMCPEnvironment = {
        rpcUrl: process.env.RPC_URL!,
        chainId,
        agentMode: (process.env.AGENT_MODE as AgentMode) || 'readonly',
        network
    };

    // Only add private key if it exists (support both old and new env var names)
    const privateKey = process.env.PRIVATE_KEY || process.env.KAIA_PRIVATE_KEY;
    if (privateKey) {
        config.privateKey = privateKey;
    }

    return config;
}

// Validate environment variables and log configuration
export function validateEnvironment(): void {
    try {
        const config = getEnvironmentConfig();
        const keyStatus = config.privateKey ? 'with private key' : 'read-only';
        console.error(`✅ KAIA-MCP configured: ${config.agentMode} mode on ${config.network} network (${keyStatus})`);
    } catch (error) {
        console.error('❌ Invalid environment configuration:', error);
        throw error;
    }
}

// Network configurations for all supported chains
const networkConfigs: Record<NetworkType, NetworkConfig> = {
    kaia: {
        rpcProviderUrl: 'https://public-en.node.kaia.io',
        blockExplorer: 'https://www.kaiascan.io',
        chain: kaia,
        chainId: 8217,
        nativeCurrency: 'KAIA'
    },
    kub: {
        rpcProviderUrl: 'https://rpc.bitkubchain.io',
        blockExplorer: 'https://www.kubscan.com',
        chain: kub,
        chainId: 96,
        nativeCurrency: 'KUB'
    },
    etherlink: {
        rpcProviderUrl: 'https://node.mainnet.etherlink.com',
        blockExplorer: 'https://explorer.etherlink.com',
        chain: etherlink,
        chainId: 42793,
        nativeCurrency: 'XTZ'
    }
} as const;

const getNetwork = (): NetworkType => {
    const config = getEnvironmentConfig();
    const network = config.network;

    if (network && !(network in networkConfigs)) {
        throw new Error(`Invalid network: ${network}. Supported networks: kaia, kub, etherlink.`);
    }
    return network || 'kaia';
};

const getAccount = (): Account => {
    const config = getEnvironmentConfig();
    const hasPrivateKey = !!(config?.privateKey);

    if (!hasPrivateKey) {
        const privateKey = generatePrivateKey();
        return privateKeyToAccount(privateKey);
    } else {
        const privateKey = config.privateKey!;
        const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
        
        // Validate that the private key is a valid hex string
        if (!/^0x[0-9a-fA-F]{64}$/.test(formattedPrivateKey)) {
            throw new Error(`Invalid private key format. Expected 64 hex characters (32 bytes), got: ${formattedPrivateKey.length - 2} characters`);
        }
        
        return privateKeyToAccount(formattedPrivateKey as `0x${string}`);
    }
}

// Initialize client configuration
export const network = getNetwork();

export const networkInfo = {
    ...networkConfigs[network],
    rpcProviderUrl: getEnvironmentConfig().rpcUrl,
};

// API Configuration
export const apiConfig = {
    baseUrl: process.env.API_BASE_URL || 'https://kvxdikvk5b.execute-api.ap-southeast-1.amazonaws.com/prod',
    priceUrl: process.env.PRICE_URL || 'https://kvxdikvk5b.execute-api.ap-southeast-1.amazonaws.com/prod/prices',
    timeout: 10000
};

export const account: Account = getAccount()

const getMode = (): AgentMode => {
    const config = getEnvironmentConfig();
    return config.agentMode;
}

export const agentMode: AgentMode = getMode()

const baseConfig = {
    chain: networkInfo.chain,
    transport: http(networkInfo.rpcProviderUrl),
} as const;

export const publicClient = createPublicClient(baseConfig);

export const walletClient = createWalletClient({
    ...baseConfig,
    account,
}) as WalletClient;

// Multi-chain client factory
export function createClientForNetwork(networkType: NetworkType) {
    const config = networkConfigs[networkType];
    const baseConfig = {
        chain: config.chain,
        transport: http(config.rpcProviderUrl),
    };

    return {
        publicClient: createPublicClient(baseConfig),
        walletClient: createWalletClient({
            ...baseConfig,
            account,
        }) as WalletClient,
        networkInfo: config
    };
}

// Get contract addresses for a network
export function getContractAddresses(networkType: NetworkType) {
    return CHAIN_CONTRACTS[networkType];
}

// Get token configurations for a network
export function getTokenConfigs(networkType: NetworkType) {
    return TOKEN_CONFIGS[networkType];
}

// Find token by symbol on a specific network
export function findTokenBySymbol(networkType: NetworkType, symbol: string) {
    const tokens = TOKEN_CONFIGS[networkType];
    return tokens.find(token => token.symbol.toLowerCase() === symbol.toLowerCase());
}

// Get all supported tokens for a network
export function getSupportedTokens(networkType: NetworkType) {
    return TOKEN_CONFIGS[networkType];
}

// Export network configs for external use
export { networkConfigs, type NetworkType };
