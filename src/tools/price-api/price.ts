import axios from 'axios';
import { TOKEN_CONFIGS, NetworkType, apiConfig } from '../../config';

const PRICE_API_URL = apiConfig.priceUrl

// Token symbol mapping for better user experience
// Maps API response symbols to our standard symbols across all chains
const TOKEN_SYMBOL_MAP: Record<string, string> = {
    // API symbol -> Standard symbol
    'STAKED_KAIA': 'stKAIA',        // Lair Staked KAIA
    'MARBLEX': 'MBX',               // MARBLEX token
    'KAIA': 'KAIA',                 // Keep as is
    'BORA': 'BORA',                 // Keep as is
    'SIX': 'SIX',                   // Keep as is
    'USDT': 'USDT',                 // Standard USDT
    'KUB': 'KUB',                   // Keep as is
    'XTZ': 'XTZ'                   // Keep as is
};

// Reverse mapping for API requests
const REVERSE_TOKEN_MAP: Record<string, string> = {};
Object.entries(TOKEN_SYMBOL_MAP).forEach(([apiSymbol, standardSymbol]) => {
    REVERSE_TOKEN_MAP[standardSymbol] = apiSymbol;
});

// Get all available token symbols across all chains
function getAllTokenSymbols(): string[] {
    const symbols = new Set<string>();
    
    Object.values(TOKEN_CONFIGS).forEach(chainTokens => {
        chainTokens.forEach(token => {
            symbols.add(token.symbol);
        });
    });
    
    return Array.from(symbols);
}

// Get tokens for a specific chain
function getTokensForChain(network: NetworkType): string[] {
    return TOKEN_CONFIGS[network].map(token => token.symbol);
}

// Map API response to standard symbols and add derived tokens
function mapApiResponse(prices: any[]): any[] {
    const mappedPrices = prices.map(item => ({
        ...item,
        symbol: TOKEN_SYMBOL_MAP[item.symbol] || item.symbol
    }));

    // Find USDT price to create KUSDT entry
    const usdtPrice = mappedPrices.find(price => price.symbol === 'USDT');
    
    if (usdtPrice) {
        // Add KUSDT entry using USDT price (for KUB chain)
        const kusdtEntry = {
            ...usdtPrice,
            symbol: 'KUSDT',
            name: 'KUB Tether USD'
        };
        
        mappedPrices.push(kusdtEntry);
    }

    return mappedPrices;
}

/**
 * Get all available prices from the KiloLend price API
 * @returns All price data with success status
 */
export const getAllPrices = async () => {
    try {
        const response = await axios.get(PRICE_API_URL);

        if (response.data.success) {
            // Map API symbols to standard symbols for better user experience
            const mappedPrices = mapApiResponse(response.data.data);
            return {
                success: true,
                prices: mappedPrices,
                count: response.data.count
            };
        } else {
            return {
                success: false,
                error: 'API returned unsuccessful response'
            };
        }
    } catch (error: any) {
        console.error('Error fetching all prices:', error);
        return {
            success: false,
            error: error.message || 'Failed to fetch prices from API'
        };
    }
};

/**
 * Get prices for specific token symbols
 * @param symbols Array of token symbols (e.g., ['KAIA', 'BTC', 'ETH'])
 * @returns Filtered price data for requested symbols
 */
export const getTokenPrices = async (symbols: string[]) => {
    try {
        const allPricesResult = await getAllPrices();

        if (!allPricesResult.success) {
            return allPricesResult;
        }

        const filteredPrices = (allPricesResult.prices || []).filter((price: any) =>
            symbols.includes(price.symbol)
        );

        return {
            success: true,
            prices: filteredPrices,
            count: filteredPrices.length,
            requestedSymbols: symbols,
            foundSymbols: filteredPrices.map((price: any) => price.symbol)
        };
    } catch (error: any) {
        console.error('Error fetching token prices:', error);
        return {
            success: false,
            error: error.message || 'Failed to fetch token prices'
        };
    }
};

/**
 * Get prices for KAIA ecosystem tokens only
 * @returns KAIA ecosystem price data
 */
export const getKaiaEcosystemPrices = async () => {
    try {
        const allPricesResult = await getAllPrices();

        if (!allPricesResult.success) {
            return allPricesResult;
        }

        // KAIA ecosystem tokens (using standard symbols)
        const kaiaEcosystemSymbols = ['KAIA', 'BORA', 'MBX', 'SIX', 'stKAIA', 'USDT'];

        const ecosystemPrices = (allPricesResult.prices || []).filter((price: any) =>
            kaiaEcosystemSymbols.includes(price.symbol)
        );

        return {
            success: true,
            prices: ecosystemPrices,
            count: ecosystemPrices.length,
            category: 'kaia_ecosystem'
        };
    } catch (error: any) {
        console.error('Error fetching KAIA ecosystem prices:', error);
        return {
            success: false,
            error: error.message || 'Failed to fetch KAIA ecosystem prices'
        };
    }
};

/**
 * Get prices for KUB ecosystem tokens only
 * @returns KUB ecosystem price data
 */
export const getKubEcosystemPrices = async () => {
    try {
        const allPricesResult = await getAllPrices();

        if (!allPricesResult.success) {
            return allPricesResult;
        }

        // KUB ecosystem tokens (using standard symbols)
        const kubEcosystemSymbols = ['KUB', 'KUSDT'];

        const ecosystemPrices = (allPricesResult.prices || []).filter((price: any) =>
            kubEcosystemSymbols.includes(price.symbol)
        );

        return {
            success: true,
            prices: ecosystemPrices,
            count: ecosystemPrices.length,
            category: 'kub_ecosystem'
        };
    } catch (error: any) {
        console.error('Error fetching KUB ecosystem prices:', error);
        return {
            success: false,
            error: error.message || 'Failed to fetch KUB ecosystem prices'
        };
    }
};

/**
 * Get prices for Etherlink ecosystem tokens only
 * @returns Etherlink ecosystem price data
 */
export const getEtherlinkEcosystemPrices = async () => {
    try {
        const allPricesResult = await getAllPrices();

        if (!allPricesResult.success) {
            return allPricesResult;
        }

        // Etherlink ecosystem tokens (using standard symbols)
        const etherlinkEcosystemSymbols = ['XTZ', 'USDT'];

        const ecosystemPrices = (allPricesResult.prices || []).filter((price: any) =>
            etherlinkEcosystemSymbols.includes(price.symbol)
        );

        return {
            success: true,
            prices: ecosystemPrices,
            count: ecosystemPrices.length,
            category: 'etherlink_ecosystem'
        };
    } catch (error: any) {
        console.error('Error fetching Etherlink ecosystem prices:', error);
        return {
            success: false,
            error: error.message || 'Failed to fetch Etherlink ecosystem prices'
        };
    }
};

/**
 * Get prices for a specific network's tokens
 * @param network Network type ('kaia', 'kub', 'etherlink')
 * @returns Network-specific price data
 */
export const getNetworkPrices = async (network: NetworkType) => {
    try {
        const allPricesResult = await getAllPrices();

        if (!allPricesResult.success) {
            return allPricesResult;
        }

        // Get token symbols for the specific network
        const networkSymbols = getTokensForChain(network);

        const networkPrices = (allPricesResult.prices || []).filter((price: any) =>
            networkSymbols.includes(price.symbol)
        );

        return {
            success: true,
            prices: networkPrices,
            count: networkPrices.length,
            network,
            requestedSymbols: networkSymbols,
            foundSymbols: networkPrices.map((price: any) => price.symbol)
        };
    } catch (error: any) {
        console.error(`Error fetching ${network} network prices:`, error);
        return {
            success: false,
            error: error.message || `Failed to fetch ${network} network prices`
        };
    }
};
 
