#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VapiClient } from '@vapi-ai/server-sdk';
import { hasValidToken, getToken, startAuthFlow, isAuthInProgress, getAuthUrl } from './auth.js';
import { registerAllTools } from './tools/index.js';

import dotenv from 'dotenv';
dotenv.config();

// Lazy-initialized Vapi client
let vapiClient: VapiClient | null = null;

function getVapiClient(): VapiClient {
  const token = getToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  // Reset client if token changed
  if (!vapiClient) {
    vapiClient = new VapiClient({ token });
  }
  return vapiClient;
}

function createMcpServer() {
  const mcpServer = new McpServer({
    name: 'Vapi MCP',
    version: '0.1.0',
    capabilities: [],
  });

  // Register the login tool - always available
  mcpServer.tool(
    'vapi_login',
    'Authenticate with Vapi. Call this first if other tools return authentication errors.',
    {},
    async () => {
      // Check if already authenticated
      if (hasValidToken()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Already authenticated with Vapi! You can now use other Vapi tools.',
            },
          ],
        };
      }

      // Check if auth is already in progress
      if (isAuthInProgress()) {
        const url = getAuthUrl();
        return {
          content: [
            {
              type: 'text' as const,
              text: `Authentication in progress. Please complete sign-in at:\n\n${url}\n\nAfter signing in, try your request again.`,
            },
          ],
        };
      }

      // Start auth flow
      try {
        const authUrl = await startAuthFlow();
        return {
          content: [
            {
              type: 'text' as const,
              text: `Please sign in to Vapi by opening this URL:\n\n${authUrl}\n\nAfter signing in, try your request again.`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to start authentication: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register status tool
  mcpServer.tool(
    'vapi_status',
    'Check Vapi authentication status',
    {},
    async () => {
      if (hasValidToken()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Authenticated with Vapi and ready to use.',
            },
          ],
        };
      }

      if (isAuthInProgress()) {
        const url = getAuthUrl();
        return {
          content: [
            {
              type: 'text' as const,
              text: `Authentication in progress. Please complete sign-in at:\n\n${url}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: 'Not authenticated. Use the vapi_login tool to sign in.',
          },
        ],
      };
    }
  );

  // Register all Vapi tools - they will check auth via createToolHandler
  // We use a proxy that creates the client lazily
  const clientProxy = new Proxy({} as VapiClient, {
    get(_, prop) {
      return getVapiClient()[prop as keyof VapiClient];
    },
  });

  registerAllTools(mcpServer, clientProxy);

  return mcpServer;
}

async function main() {
  try {
    const mcpServer = createMcpServer();

    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);

    setupShutdownHandler(mcpServer);
  } catch (err) {
    console.error('Failed to start MCP server:', err);
    process.exit(1);
  }
}

function setupShutdownHandler(mcpServer: McpServer) {
  process.on('SIGINT', async () => {
    try {
      await mcpServer.close();
      process.exit(0);
    } catch (err) {
      process.exit(1);
    }
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

export { createMcpServer };
