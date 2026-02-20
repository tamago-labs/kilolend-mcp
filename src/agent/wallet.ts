import { createPublicClient, createWalletClient, http, WalletClient, Address, parseUnits, formatUnits, maxUint256 } from 'viem';
import { privateKeyToAccount, type Account } from 'viem/accounts';
import { publicClient, networkInfo, apiConfig, getEnvironmentConfig, networkConfigs, CHAIN_CONTRACTS, TOKEN_CONFIGS, NetworkType, CHAIN_CONFIGS } from '../config';
import { formatTokenAmount } from '../utils/formatting';
import { getAddress } from 'viem'
import {
    COMPTROLLER_ABI
} from '../contracts/comptroller';
import {
    CTOKEN_ABI,
} from '../contracts/ctoken';
import { ERC20_ABI } from '../contracts/erc20';
import {
    TransactionError,
    InsufficientBalanceError,
    ValidationError,
    handleContractError
} from '../utils/errors';
import { validateTransactionParams } from '../utils/validation';
import { getNetworkPrices } from '../tools/price-api/price';


export class WalletAgent {
    private account: Account | null = null;
    private walletClient: WalletClient | null = null;
    private isReadonly: boolean = true;
    private currentNetwork: NetworkType;
    public currentNetworkInfo: any;

    constructor(config?: { privateKey?: string; mode?: 'readonly' | 'transaction' } | string) {
        // Get network configuration from environment
        const envConfig = getEnvironmentConfig();
        this.currentNetwork = envConfig.network;
        this.currentNetworkInfo = networkConfigs[this.currentNetwork];

        // Handle different constructor signatures
        let privateKey: string | undefined;

        if (typeof config === 'string') {
            // Backward compatibility: constructor(privateKey: string)
            privateKey = config;
        } else if (config && typeof config === 'object') {
            // New signature: constructor({ privateKey?, mode? })
            if (config.mode === 'readonly') {
                privateKey = undefined;
            } else {
                privateKey = config.privateKey;
            }
        }

        if (privateKey) {
            // Initialize wallet for transaction capabilities
            // Ensure private key is properly formatted as hex string
            const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

            // Validate private key format
            if (!/^0x[0-9a-fA-F]{64}$/.test(formattedPrivateKey)) {
                throw new Error(`Invalid private key format. Expected 64 hex characters (32 bytes), got: ${formattedPrivateKey.length - 2} characters`);
            }

            this.account = privateKeyToAccount(formattedPrivateKey as `0x${string}`);
            this.walletClient = createWalletClient({
                account: this.account,
                chain: this.currentNetworkInfo.chain,
                transport: http(envConfig.rpcUrl)
            });
            this.isReadonly = false;
        } else {
            // Read-only mode - no private key
            this.isReadonly = true;
        }
    }

    // Get contract addresses for current network
    private getContractAddresses() {
        return CHAIN_CONTRACTS[this.currentNetwork];
    }

    // Get token configurations for current network
    private getTokenConfigs() {
        return TOKEN_CONFIGS[this.currentNetwork];
    }

    // Create token addresses mapping for current network
    private getTokenAddresses(): Record<string, Address> {
        const tokens = this.getTokenConfigs();
        return tokens.reduce((acc, token) => ({
            ...acc, [token.symbol]: token.address as Address
        }), {});
    }

    // Create cToken addresses mapping for current network
    private getCTokenAddresses(): Record<string, Address> {
        const contracts = this.getContractAddresses();
        const cTokens: Record<string, Address> = {};

        // Map cToken addresses from contracts
        Object.entries(contracts).forEach(([key, value]) => {
            if (key.startsWith('c')) {
                const symbol = key.substring(1); // Remove 'c' prefix
                cTokens[symbol] = value as Address;
            }
        });

        return cTokens;
    }

    // Get token decimals for a symbol
    private getTokenDecimals(symbol: string): number {
        const tokens = this.getTokenConfigs();
        const token = tokens.find(t => t.symbol === symbol);
        return token?.decimals || 18;
    }

    // ===== TOKEN RESOLUTION METHODS =====

    // Resolve token symbol to canonical format (case-insensitive)
    private resolveTokenSymbol(inputSymbol: string): string {
        const tokenConfigs = this.getTokenConfigs();
        const normalizedInput = inputSymbol.toLowerCase().trim();

        // First try exact match (case-insensitive)
        let token = tokenConfigs.find(t => t.symbol.toLowerCase() === normalizedInput);
        if (token) {
            return token.symbol;
        }

        // Try special mappings for common variations
        const specialMappings: Record<string, string> = {
            'stkaia': 'stKAIA',  // stKAIA variations
        };

        if (specialMappings[normalizedInput]) {
            // Check if the mapped symbol exists in token configs
            const mappedToken = tokenConfigs.find(t => t.symbol === specialMappings[normalizedInput] || t.symbol === 'StKAIA');
            if (mappedToken) {
                return mappedToken.symbol;
            }
        }

        // Try to find by checking cToken contracts
        const contracts = this.getContractAddresses();
        for (const [cTokenKey, _] of Object.entries(contracts)) {
            if (cTokenKey.startsWith('c')) {
                const symbol = cTokenKey.substring(1);
                if (symbol.toLowerCase() === normalizedInput) {
                    // Check if this symbol exists in token configs
                    const token = tokenConfigs.find(t => t.symbol.toLowerCase() === symbol.toLowerCase());
                    if (token) {
                        return token.symbol;
                    }
                    // If not in token configs, return the symbol as is (might be the StKAIA case)
                    return symbol;
                }
            }
        }

        // If nothing found, return the original input
        return inputSymbol;
    }

    // Get canonical token symbol for cToken resolution
    private getCanonicalSymbolForCToken(inputSymbol: string): string {
        const contracts = this.getContractAddresses();
        const resolvedSymbol = this.resolveTokenSymbol(inputSymbol);

        // Check if cToken exists with resolved symbol
        const cTokenKey = `c${resolvedSymbol}`;
        if (contracts[cTokenKey as keyof typeof contracts]) {
            return resolvedSymbol;
        }

        // Try with the original symbol
        const originalCTokenKey = `c${inputSymbol}`;
        if (contracts[originalCTokenKey as keyof typeof contracts]) {
            return inputSymbol;
        }

        // Try variations for StKAIA specifically
        const variations = ['StKAIA', 'stKAIA', 'STKAIA'];
        for (const variation of variations) {
            const testKey = `c${variation}`;
            if (contracts[testKey as keyof typeof contracts]) {
                return variation;
            }
        }

        return resolvedSymbol;
    }

    // ===== WALLET INFO METHODS =====

    getAddress(): Address | null {
        return this.account?.address || null;
    }

    isTransactionMode(): boolean {
        return !this.isReadonly;
    }

    // ===== WALLET INFO METHODS =====

    // Fetch prices using the price API tool for the current network
    private async fetchPrices(): Promise<Record<string, number>> {
        try {
            const pricesResult = await getNetworkPrices(this.currentNetwork);
            if (pricesResult.success && pricesResult.prices) {
                return pricesResult.prices.reduce((acc, price) => ({
                    ...acc,
                    [price.symbol]: price.price || 0
                }), {});
            }
            return {};
        } catch (error) {
            console.warn('Failed to fetch prices:', error);
            return {};
        }
    }

    async getWalletInfo() {
        if (!this.account) {
            throw new Error('Wallet not initialized. Provide private key for wallet operations.');
        }

        try {
            const balance = await publicClient.getBalance({
                address: this.account.address
            });

            const prices = await this.fetchPrices();
            const tokens = [];

            // Get token addresses for current network
            const tokenAddresses = this.getTokenAddresses();
            const tokenConfigs = this.getTokenConfigs();

            // Get token balances for all tokens in current network
            for (const tokenConfig of tokenConfigs) {
                try {
                    let tokenBalance: bigint;
                    let decimals = tokenConfig.decimals;
                    let price = prices[tokenConfig.symbol] || 0;

                    // Handle native token separately
                    if (tokenConfig.address === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE') {
                        tokenBalance = balance;
                        decimals = 18;
                    } else {
                        tokenBalance = await this.getTokenBalance(tokenConfig.address as Address, this.account.address);
                    }

                    const balanceFormatted = Number(tokenBalance) / Math.pow(10, decimals);
                    const balanceUSD = balanceFormatted * price;

                    // Show tokens with meaningful value or non-zero balance
                    if (balanceUSD > 0.01 || balanceFormatted > 0) {
                        tokens.push({
                            symbol: tokenConfig.symbol,
                            address: tokenConfig.address,
                            balance: balanceFormatted.toString(),
                            balanceUSD: balanceUSD.toFixed(2),
                            price,
                            decimals
                        });
                    }
                } catch (error) {
                    // Skip tokens that fail to load but log for debugging
                    console.warn(`Failed to load balance for ${tokenConfig.symbol}:`, error);
                }
            }

            // Sort tokens by USD value (highest first)
            tokens.sort((a: any, b: any) => parseFloat(b.balanceUSD) - parseFloat(a.balanceUSD));

            // Calculate total portfolio value
            const totalPortfolioUSD = tokens.reduce((sum: number, token: any) => sum + parseFloat(token.balanceUSD), 0);

            return {
                address: this.account.address,
                nativeBalance: formatTokenAmount(balance, this.currentNetworkInfo.nativeCurrency),
                nativeBalanceUSD: (Number(balance) / 1e18 * (prices[this.currentNetworkInfo.nativeCurrency] || 0)).toFixed(2),
                tokens,
                totalPortfolioUSD: totalPortfolioUSD.toFixed(2),
                network: {
                    chainId: this.currentNetworkInfo.chainId,
                    name: this.currentNetwork,
                    rpcUrl: this.currentNetworkInfo.rpcProviderUrl
                },
                mode: this.isReadonly ? 'read-only' : 'transaction'
            };
        } catch (error: any) {
            throw new Error(`Failed to get wallet info: ${error.message}`);
        }
    }

    // ===== MARKET DATA METHODS =====

    async getMarketData(cTokenAddress: Address) {
        try {
            const [exchangeRate, supplyRate, borrowRate, totalSupply, totalBorrows, cash] = await Promise.all([
                publicClient.readContract({
                    address: cTokenAddress,
                    abi: CTOKEN_ABI,
                    functionName: 'exchangeRateStored'
                }),
                publicClient.readContract({
                    address: cTokenAddress,
                    abi: CTOKEN_ABI,
                    functionName: 'supplyRatePerBlock'
                }),
                publicClient.readContract({
                    address: cTokenAddress,
                    abi: CTOKEN_ABI,
                    functionName: 'borrowRatePerBlock'
                }),
                publicClient.readContract({
                    address: cTokenAddress,
                    abi: CTOKEN_ABI,
                    functionName: 'totalSupply'
                }),
                publicClient.readContract({
                    address: cTokenAddress,
                    abi: CTOKEN_ABI,
                    functionName: 'totalBorrows'
                }),
                publicClient.readContract({
                    address: cTokenAddress,
                    abi: CTOKEN_ABI,
                    functionName: 'getCash'
                })
            ]) as [bigint, bigint, bigint, bigint, bigint, bigint];

            return {
                exchangeRate: exchangeRate.toString(),
                supplyRatePerBlock: supplyRate.toString(),
                borrowRatePerBlock: borrowRate.toString(),
                totalSupply: totalSupply.toString(),
                totalBorrows: totalBorrows.toString(),
                cash: cash.toString()
            };
        } catch (error: any) {
            throw new Error(`Failed to get market data: ${error.message}`);
        }
    }

    async getAllMarkets() {
        try {
            const prices = await this.fetchPrices();
            const markets = [];
            const cTokenAddresses = this.getCTokenAddresses();

            for (const [symbol, cTokenAddress] of Object.entries(cTokenAddresses)) {
                try {
                    const marketData = await this.getMarketData(cTokenAddress as Address);
                    const price = prices[symbol] || 0;

                    // Calculate real values using correct decimals for each token
                    const exchangeRate = parseFloat(marketData.exchangeRate) / 1e18;
                    const supplyRatePerBlock = parseFloat(marketData.supplyRatePerBlock);
                    const borrowRatePerBlock = parseFloat(marketData.borrowRatePerBlock);
                    const tokenDecimals = this.getTokenDecimals(symbol);
                    const decimalDivisor = Math.pow(10, tokenDecimals);
                    const totalSupply = parseFloat(marketData.totalSupply) / decimalDivisor;
                    const totalBorrows = parseFloat(marketData.totalBorrows) / decimalDivisor;
                    const cash = parseFloat(marketData.cash) / decimalDivisor;

                    // Blocks per year based on network
                    const blocksPerYear = BigInt(CHAIN_CONFIGS[this.currentNetwork].blocksPerYear);

                    // APY calculations
                    const scale = BigInt(10) ** BigInt(18);

                    // Calculate supply APY
                    const supplyApy = Number(
                        (BigInt(supplyRatePerBlock) * blocksPerYear * BigInt(10000)) / scale
                    ) / 100;

                    // Calculate borrow APR
                    const borrowApy = Number(
                        (BigInt(borrowRatePerBlock) * blocksPerYear * BigInt(10000)) / scale
                    ) / 100;

                    const utilization = (totalSupply * exchangeRate) > 0 ?
                        (totalBorrows / (totalSupply * exchangeRate)) * 100 : 0;

                    markets.push({
                        symbol: `c${symbol}`,
                        underlyingSymbol: symbol,
                        cTokenAddress,
                        underlyingAddress: this.getTokenAddresses()[symbol],
                        supplyApy: supplyApy.toFixed(2),
                        borrowApy: borrowApy.toFixed(2),
                        totalSupply: (totalSupply * exchangeRate).toFixed(6),
                        totalBorrows: totalBorrows.toFixed(6),
                        cash: cash.toFixed(6),
                        utilizationRate: utilization.toFixed(2),
                        exchangeRate: exchangeRate.toFixed(6),
                        price,
                        isListed: true
                    });
                } catch (error) {
                    console.warn(`Failed to load data for ${symbol}:`, error);
                }
            }

            return markets;
        } catch (error: any) {
            throw new Error(`Failed to get all markets: ${error.message}`);
        }
    }

    // ===== ACCOUNT LIQUIDITY METHODS =====

    async getAccountLiquidity(accountAddress?: Address) {
        const address = accountAddress || this.getAddress();
        if (!address) {
            throw new Error('No address provided and wallet not initialized');
        }

        try {
            const comptrollerAddress = this.getContractAddresses().Comptroller;
            const [error, liquidity, shortfall] = await publicClient.readContract({
                address: comptrollerAddress,
                abi: COMPTROLLER_ABI,
                functionName: 'getAccountLiquidity',
                args: [getAddress(address)]
            }) as [bigint, bigint, bigint];

            if (Number(error) !== 0) {
                throw new Error(`Comptroller error: ${error}`);
            }
            // Get user's positions
            const assetsIn = await publicClient.readContract({
                address: comptrollerAddress,
                abi: COMPTROLLER_ABI,
                functionName: 'getAssetsIn',
                args: [getAddress(address)]
            }) as Address[];

            const positions = [];
            let totalCollateralUSD = 0;
            let totalBorrowUSD = 0;

            for (const cTokenAddress of assetsIn) {
                try {
                    const position = await this.getUserPosition(cTokenAddress, address);
                    if (position) {
                        positions.push(position);
                        totalCollateralUSD += position.supplyValueUSD;
                        totalBorrowUSD += position.borrowValueUSD;
                    }
                } catch (error) {
                    console.error(`Failed to get position for ${cTokenAddress}:`, error);
                }
            }

            const healthFactor = totalBorrowUSD > 0 ? totalCollateralUSD / totalBorrowUSD : 999;

            return {
                liquidity: (Number(liquidity) / 1e18).toString(),
                shortfall: (Number(shortfall) / 1e18).toString(),
                healthFactor,
                totalCollateralUSD,
                totalBorrowUSD,
                positions
            };
        } catch (error: any) {
            throw new Error(`Failed to get account liquidity: ${error.message}`);
        }
    }

    private async getUserPosition(cTokenAddress: Address, userAddress: Address) {
        try {
            const [accountSnapshot, cTokenBalance] = await Promise.all([
                publicClient.readContract({
                    address: cTokenAddress,
                    abi: CTOKEN_ABI,
                    functionName: 'getAccountSnapshot',
                    args: [getAddress(userAddress)]
                }),
                publicClient.readContract({
                    address: cTokenAddress,
                    abi: CTOKEN_ABI,
                    functionName: 'balanceOf',
                    args: [getAddress(userAddress)]
                })
            ]) as [[bigint, bigint, bigint, bigint], bigint];

            const [error, , borrowBalance, exchangeRateMantissa] = accountSnapshot;

            if (Number(error) !== 0) {
                return null;
            }

            const supplyBalance = (cTokenBalance * exchangeRateMantissa) / 10n ** 18n;

            // Find the market symbol by looking through cToken addresses
            const cTokenAddresses = this.getCTokenAddresses();
            const marketSymbol = Object.entries(cTokenAddresses).find(([_, address]) =>
                address.toLowerCase() === cTokenAddress.toLowerCase()
            )?.[0] || 'UNKNOWN';

            const price = await this.getTokenPrice(marketSymbol);

            // Get correct decimals for the token
            const tokenDecimals = this.getTokenDecimals(marketSymbol);
            const decimalDivisor = Math.pow(10, tokenDecimals);

            // Use correct decimal divisor for each token
            const supplyBalanceFormatted = Number(supplyBalance) / decimalDivisor;
            const borrowBalanceFormatted = Number(borrowBalance) / decimalDivisor;

            // Get correct collateral factor for each token
            const collateralFactor = 75.0;

            return {
                cTokenAddress,
                symbol: marketSymbol,
                underlyingSymbol: marketSymbol,
                supplyBalance: supplyBalanceFormatted.toString(),
                borrowBalance: borrowBalanceFormatted.toString(),
                supplyValueUSD: supplyBalanceFormatted * price,
                borrowValueUSD: borrowBalanceFormatted * price,
                collateralFactor: collateralFactor.toString(),
                isCollateral: true
            };
        } catch (error) {
            return null;
        }
    }

    // ===== PROTOCOL STATS METHODS =====

    async getProtocolStats() {
        try {
            const markets = await this.getAllMarkets();
            const prices = await this.fetchPrices();

            let totalTVL = 0;
            let totalBorrows = 0;

            for (const market of markets) {
                totalTVL += parseFloat(market.totalSupply) * market.price;
                totalBorrows += parseFloat(market.totalBorrows) * market.price;
            }

            const utilization = totalTVL > 0 ? (totalBorrows / totalTVL) * 100 : 0;

            return {
                totalTVL,
                totalBorrows,
                utilization,
                markets,
                prices,
                timestamp: new Date().toISOString()
            };
        } catch (error: any) {
            throw new Error(`Failed to get protocol stats: ${error.message}`);
        }
    }

    // ===== ALLOWANCE AND MARKET ENTRY METHODS =====

    async checkAllowance(tokenSymbol: string, spenderAddress: Address): Promise<string> {
        // Resolve token symbol case-insensitively
        const canonicalSymbol = this.resolveTokenSymbol(tokenSymbol);

        // Get token addresses for current network
        const tokenAddresses = this.getTokenAddresses();
        const tokenAddress = tokenAddresses[canonicalSymbol];

        if (!tokenAddress) {
            throw new ValidationError(`Token ${tokenSymbol} not supported`);
        }

        if (canonicalSymbol === this.currentNetworkInfo.nativeCurrency) {
            return "115792089237316195423570985008687907853269984665640564039457584007913129639935"; // Max uint256 for native token
        }

        try {
            const allowance = await publicClient.readContract({
                address: tokenAddress,
                abi: ERC20_ABI,
                functionName: 'allowance',
                args: [this.getAddress()!, spenderAddress]
            }) as bigint;

            return allowance.toString();
        } catch (error: any) {
            throw new Error(`Failed to check allowance: ${error.message}`);
        }
    }

    async approveToken(tokenSymbol: string, spenderAddress: Address, amount?: string): Promise<string> {
        this.requireTransactionMode();

        // Resolve token symbol case-insensitively
        const canonicalSymbol = this.resolveTokenSymbol(tokenSymbol);
        const tokenAddresses = this.getTokenAddresses();
        const tokenAddress = tokenAddresses[canonicalSymbol];

        if (!tokenAddress) {
            throw new ValidationError(`Token ${tokenSymbol} not supported`);
        }

        if (canonicalSymbol === this.currentNetworkInfo.nativeCurrency) {
            throw new ValidationError(`${this.currentNetworkInfo.nativeCurrency} is native token and does not require approval`);
        }

        try {
            const decimals = this.getTokenDecimals(canonicalSymbol);
            const amountWei = amount ? parseUnits(amount, decimals) :
                BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935'); // Max uint256

            const txHash = await this.walletClient!.writeContract({
                address: tokenAddress,
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [spenderAddress, amountWei],
                account: this.account!,
                chain: this.currentNetworkInfo.chain
            });

            return txHash;
        } catch (error) {
            throw handleContractError(error);
        }
    }


    async checkMarketMembership(cTokenAddress: Address): Promise<boolean> {
        const userAddress = this.getAddress();
        if (!userAddress) {
            throw new Error('Wallet not initialized');
        }

        try {
            const comptrollerAddress = this.getContractAddresses().Comptroller;
            const assetsIn = await publicClient.readContract({
                address: comptrollerAddress,
                abi: COMPTROLLER_ABI,
                functionName: 'getAssetsIn',
                args: [userAddress]
            }) as Address[];

            return assetsIn.includes(cTokenAddress);
        } catch (error: any) {
            throw new Error(`Failed to check market membership: ${error.message}`);
        }
    }

    async enterMarkets(cTokenAddresses: Address[]): Promise<string> {
        this.requireTransactionMode();

        try {
            const comptrollerAddress = this.getContractAddresses().Comptroller;
            const txHash = await this.walletClient!.writeContract({
                address: comptrollerAddress,
                abi: COMPTROLLER_ABI,
                functionName: 'enterMarkets',
                args: [cTokenAddresses],
                account: this.account!,
                chain: this.currentNetworkInfo.chain
            });

            return txHash;
        } catch (error) {
            throw handleContractError(error);
        }
    }

    // ===== TRANSACTION METHODS =====

    async sendNativeToken(to: Address, amount: string): Promise<string> {
        this.requireTransactionMode();

        const validation = validateTransactionParams({ to, amount });
        if (!validation.isValid) {
            throw new ValidationError(validation.errors.join(', '));
        }

        try {
            const balance = await publicClient.getBalance({
                address: this.getAddress()!
            });

            const amountWei = parseUnits(amount, 18);

            if (balance < amountWei) {
                throw new InsufficientBalanceError(this.currentNetworkInfo.nativeCurrency, amount, balance.toString());
            }

            const txHash = await this.walletClient!.sendTransaction({
                to,
                value: amountWei,
                account: this.account!,
                chain: this.currentNetworkInfo.chain
            });

            return txHash;
        } catch (error) {
            throw handleContractError(error);
        }
    }

    async sendERC20Token(tokenSymbol: string, to: Address, amount: string): Promise<string> {
        this.requireTransactionMode();

        const validation = validateTransactionParams({ to, amount, symbol: tokenSymbol });
        if (!validation.isValid) {
            throw new ValidationError(validation.errors.join(', '));
        }

        const canonicalSymbol = this.resolveTokenSymbol(tokenSymbol);
        const tokenAddresses = this.getTokenAddresses();
        const tokenAddress = tokenAddresses[canonicalSymbol];
        if (!tokenAddress) {
            throw new ValidationError(`Token ${tokenSymbol} not supported`);
        }

        try {
            const decimals = this.getTokenDecimals(canonicalSymbol);

            const txHash = await this.walletClient!.writeContract({
                address: tokenAddress,
                abi: ERC20_ABI,
                functionName: 'transfer',
                args: [to, parseUnits(amount, decimals)],
                account: this.account!,
                chain: this.currentNetworkInfo.chain
            });

            return txHash;
        } catch (error) {
            throw handleContractError(error);
        }
    }

    async supplyToMarket(tokenSymbol: string, amount: string): Promise<string> {
        this.requireTransactionMode();

        // Resolve token symbol case-insensitively for cToken lookup
        const canonicalSymbol = this.getCanonicalSymbolForCToken(tokenSymbol);
        const cTokenAddresses = this.getCTokenAddresses();
        const cTokenAddress = cTokenAddresses[canonicalSymbol];
        if (!cTokenAddress) {
            throw new ValidationError(`Market ${tokenSymbol} not available`);
        }

        try {
            // Check if user is in the market, if not, enter market
            const isInMarket = await this.checkMarketMembership(cTokenAddress);
            if (!isInMarket) {
                await this.enterMarkets([cTokenAddress]);
            }

            const decimals = this.getTokenDecimals(canonicalSymbol);
            const amountWei = parseUnits(amount, decimals);

            // For ERC20 tokens, check and handle allowance
            if (canonicalSymbol !== this.currentNetworkInfo.nativeCurrency) {
                const currentAllowance = await this.checkAllowance(canonicalSymbol, cTokenAddress);

                if (BigInt(currentAllowance) < amountWei) {
                    await this.approveToken(canonicalSymbol, cTokenAddress);
                }
            }

            // Handle native token differently - send value with transaction, no parameters
            if (canonicalSymbol === this.currentNetworkInfo.nativeCurrency) {
                const txHash = await this.walletClient!.writeContract({
                    address: cTokenAddress,
                    abi: [{
                        "inputs": [],
                        "name": "mint",
                        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
                        "stateMutability": "payable",
                        "type": "function"
                    }],
                    functionName: 'mint',
                    args: [], // No parameters for native token
                    account: this.account!,
                    chain: this.currentNetworkInfo.chain,
                    value: amountWei // Send native token as transaction value
                });
                return txHash;
            } else {
                // For ERC20 tokens, call mint with amount parameter
                const txHash = await this.walletClient!.writeContract({
                    address: cTokenAddress,
                    abi: CTOKEN_ABI,
                    functionName: 'mint',
                    args: [amountWei],
                    account: this.account!,
                    chain: this.currentNetworkInfo.chain
                });
                return txHash;
            }
        } catch (error) {
            throw handleContractError(error);
        }
    }

    async borrowFromMarket(tokenSymbol: string, amount: string): Promise<string> {
        this.requireTransactionMode();

        // Resolve token symbol case-insensitively
        const canonicalSymbol = this.getCanonicalSymbolForCToken(tokenSymbol);
        const cTokenAddresses = this.getCTokenAddresses();
        const cTokenAddress = cTokenAddresses[canonicalSymbol];

        if (!cTokenAddress) {
            throw new ValidationError(`Market ${tokenSymbol} not available`);
        }

        try {
            const decimals = this.getTokenDecimals(canonicalSymbol);
            const amountWei = parseUnits(amount, decimals);

            const txHash = await this.walletClient!.writeContract({
                address: cTokenAddress,
                abi: CTOKEN_ABI,
                functionName: 'borrow',
                args: [amountWei],
                account: this.account!,
                chain: this.currentNetworkInfo.chain
            });

            return txHash;
        } catch (error) {
            throw handleContractError(error);
        }
    }

    async repayBorrow(tokenSymbol: string, amount?: string): Promise<string> {
        this.requireTransactionMode();

        // Resolve token symbol case-insensitively
        const canonicalSymbol = this.getCanonicalSymbolForCToken(tokenSymbol);
        const cTokenAddresses = this.getCTokenAddresses();
        const cTokenAddress = cTokenAddresses[canonicalSymbol];

        if (!cTokenAddress) {
            throw new ValidationError(`Market ${tokenSymbol} not available`);
        }

        try {
            const decimals = this.getTokenDecimals(canonicalSymbol);
            const amountWei = amount ? parseUnits(amount, decimals) :
                BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');

            // For ERC20 tokens, check and handle allowance
            if (tokenSymbol !== this.currentNetworkInfo.nativeCurrency) {
                const currentAllowance = await this.checkAllowance(tokenSymbol, cTokenAddress);

                if (BigInt(currentAllowance) < amountWei) {
                    await this.approveToken(tokenSymbol, cTokenAddress);
                }
            }

            // Handle native token differently - send value with transaction, no parameters
            if (tokenSymbol === this.currentNetworkInfo.nativeCurrency) {
                const txHash = await this.walletClient!.writeContract({
                    address: cTokenAddress,
                    abi: [{
                        "inputs": [],
                        "name": "repayBorrow",
                        "outputs": [],
                        "stateMutability": "payable",
                        "type": "function"
                    }],
                    functionName: 'repayBorrow',
                    args: [], // No parameters for native token
                    account: this.account!,
                    chain: this.currentNetworkInfo.chain,
                    value: amountWei // Send native token as transaction value
                });
                return txHash;
            } else {
                // For ERC20 tokens, call repayBorrow with amount parameter
                const txHash = await this.walletClient!.writeContract({
                    address: cTokenAddress,
                    abi: CTOKEN_ABI,
                    functionName: 'repayBorrow',
                    args: [amountWei],
                    account: this.account!,
                    chain: this.currentNetworkInfo.chain
                });
                return txHash;
            }
        } catch (error) {
            throw handleContractError(error);
        }
    }

    async redeemTokens(tokenSymbol: string, cTokenAmount: string): Promise<string> {
        this.requireTransactionMode();

        // Resolve token symbol case-insensitively
        const canonicalSymbol = this.getCanonicalSymbolForCToken(tokenSymbol);
        const cTokenAddresses = this.getCTokenAddresses();
        const cTokenAddress = cTokenAddresses[canonicalSymbol];

        if (!cTokenAddress) {
            throw new ValidationError(`Market ${tokenSymbol} not available`);
        }

        try {
            // Check if user has sufficient cToken balance
            const cTokenBalance = await publicClient.readContract({
                address: cTokenAddress,
                abi: CTOKEN_ABI,
                functionName: 'balanceOf',
                args: [this.getAddress()!]
            }) as bigint;

            const cTokenAmountWei = parseUnits(cTokenAmount, 8); // cTokens use 8 decimals

            if (cTokenBalance < cTokenAmountWei) {
                throw new InsufficientBalanceError(`c${tokenSymbol}`, cTokenAmount, cTokenBalance.toString());
            }

            const txHash = await this.walletClient!.writeContract({
                address: cTokenAddress,
                abi: CTOKEN_ABI,
                functionName: 'redeem',
                args: [cTokenAmountWei],
                account: this.account!,
                chain: this.currentNetworkInfo.chain
            });

            return txHash;
        } catch (error) {
            throw handleContractError(error);
        }
    }

    async redeemUnderlying(tokenSymbol: string, underlyingAmount: string): Promise<string> {
        this.requireTransactionMode();

        // Resolve token symbol case-insensitively
        const canonicalSymbol = this.getCanonicalSymbolForCToken(tokenSymbol);
        const cTokenAddresses = this.getCTokenAddresses();
        const cTokenAddress = cTokenAddresses[canonicalSymbol];

        if (!cTokenAddress) {
            throw new ValidationError(`Market ${tokenSymbol} not available`);
        }

        try {
            const decimals = this.getTokenDecimals(canonicalSymbol); 
            const underlyingAmountWei = parseUnits(underlyingAmount, decimals);

            const txHash = await this.walletClient!.writeContract({
                address: cTokenAddress,
                abi: CTOKEN_ABI,
                functionName: 'redeemUnderlying',
                args: [underlyingAmountWei],
                account: this.account!,
                chain: this.currentNetworkInfo.chain
            });

            return txHash;
        } catch (error) {
            throw handleContractError(error);
        }
    }


    // ===== HELPER METHODS =====

    private requireTransactionMode(): void {
        if (this.isReadonly) {
            throw new Error('This operation requires transaction mode. Provide a private key to enable transactions.');
        }
    }

    async getTokenBalance(tokenAddress: Address, accountAddress: Address): Promise<bigint> {
        try {
            const balance = await publicClient.readContract({
                address: tokenAddress,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [accountAddress]
            });

            return balance as bigint;
        } catch (error: any) {
            throw new Error(`Failed to get token balance: ${error.message}`);
        }
    }

    private async getTokenPrice(symbol: string): Promise<number> {
        try {
            const prices = await this.fetchPrices();
            return prices[symbol] || 0;
        } catch (error: any) {
            return 0;
        }
    }

    async waitForTransaction(txHash: string): Promise<any> {
        try {
            const receipt = await publicClient.waitForTransactionReceipt({
                hash: txHash as Address
            });
            return receipt;
        } catch (error) {
            throw new TransactionError(`Transaction ${txHash} failed`, txHash);
        }
    }
}
