// AI Agent Token Management Tools
// Provides tools for managing AI Agent tokens, including burn functionality

import BurnTokensTool from './burn_tokens_tool';

export { default as BurnTokensTool } from './burn_tokens_tool';

export const aiagentTools = [
    { name: "BurnTokensTool", tool: BurnTokensTool, handler: BurnTokensTool.handler }
];
