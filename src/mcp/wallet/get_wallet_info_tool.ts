import { z } from "zod";
import { WalletAgent } from "../../agent/wallet";
import { type McpTool } from "../../types";

export const GetWalletInfoTool: McpTool = {
    name: "kilolend_get_wallet_info",
    description: "Get comprehensive wallet information including all token balances",
    schema: {},
    handler: async (agent: WalletAgent, input: Record<string, any>) => {
        try {
            const walletInfo = await agent.getWalletInfo();
            const nativeCurrency = walletInfo.network.name;
            const balanceInNative = parseFloat(walletInfo.nativeBalance.split(' ')[0]);
            const totalPortfolioUSD = parseFloat(walletInfo.totalPortfolioUSD || '0');

            // Format token balances for display
            const tokenBalances = walletInfo.tokens.map((token: any) => ({
                symbol: token.symbol,
                balance: parseFloat(token.balance).toFixed(6),
                balanceUSD: `$${token.balanceUSD}`,
                price: token.price ? `$${token.price.toFixed(6)}` : 'N/A',
                address: token.address
            }));

            // Generate KiloLend-specific recommendations
            const recommendations = [];
            const userTokens = walletInfo.tokens.map((t: any) => t.symbol);

            // Balance status
            if (balanceInNative < 0.01) {
                recommendations.push(`⚠️ Low ${nativeCurrency} balance (${walletInfo.nativeBalance}) - add 0.01 ${nativeCurrency} for operations`);
            } else {
                recommendations.push("✅ Ready for KiloLend operations");
            }

            // KiloLend opportunities
            if (userTokens.length > 0) {
                recommendations.push(`🏦 Supply ${userTokens.slice(0, 2).join(', ')}${userTokens.length > 2 ? '...' : ''} to KiloLend for interest`);
            }

            // Stablecoin opportunities
            const stablecoins = userTokens.filter(token => ['USDT', 'KUSDT', 'USDC', 'DAI'].includes(token));
            if (stablecoins.length > 0) {
                recommendations.push("💡 Supply stablecoins for stable interest on KiloLend");
            }

            // Native token opportunities
            if (userTokens.includes(nativeCurrency)) {
                recommendations.push(`🔄 Use ${nativeCurrency} for lending or as collateral on KiloLend`);
            }

            return {
                status: "success",
                message: "✅ Wallet information retrieved",
                wallet_details: {
                    ...walletInfo,
                    tokenBalances
                },
                account_status: {
                    activated: true,
                    minimum_balance_required: `0.01 ${nativeCurrency}`,
                    can_supply: balanceInNative >= 0.01,
                    ready_for_operations: balanceInNative >= 0.001,
                    total_portfolio_usd: totalPortfolioUSD,
                    token_count: walletInfo.tokens.length
                },
                portfolio_summary: {
                    total_value_usd: `$${totalPortfolioUSD.toFixed(2)}`,
                    native_balance: walletInfo.nativeBalance,
                    native_balance_usd: `$${walletInfo.nativeBalanceUSD}`,
                    token_count: walletInfo.tokens.length,
                    top_tokens: tokenBalances.slice(0, 5)
                },
                recommendations
            };
        } catch (error: any) {
            throw new Error(`Failed to get wallet info: ${error.message}`);
        }
    }
};
