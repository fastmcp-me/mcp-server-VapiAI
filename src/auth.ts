import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as crypto from 'crypto';

const CONFIG_DIR = path.join(os.homedir(), '.vapi');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Vapi Dashboard URL for OAuth
const VAPI_DASHBOARD_URL = process.env.VAPI_DASHBOARD_URL || 'https://dashboard.vapi.ai';

interface VapiConfig {
  apiKey?: string;
  email?: string;
  orgId?: string;
}

// In-memory state
let cachedConfig: VapiConfig | null = null;
let authInProgress = false;
let authUrl: string | null = null;
let authServer: http.Server | null = null;

/**
 * Load stored Vapi configuration from ~/.vapi/config.json
 */
export function loadConfig(): VapiConfig {
  if (cachedConfig) {
    return cachedConfig;
  }
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      cachedConfig = JSON.parse(content);
      return cachedConfig!;
    }
  } catch (error) {
    // Ignore errors, return empty config
  }
  return {};
}

/**
 * Save Vapi configuration to ~/.vapi/config.json
 */
export function saveConfig(config: VapiConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    cachedConfig = config;
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}

/**
 * Check if we have a valid API token
 */
export function hasValidToken(): boolean {
  // Check environment variable first
  if (process.env.VAPI_TOKEN) {
    return true;
  }
  // Check config file
  const config = loadConfig();
  return !!config.apiKey;
}

/**
 * Get the API token (from env or config)
 */
export function getToken(): string | null {
  if (process.env.VAPI_TOKEN) {
    return process.env.VAPI_TOKEN;
  }
  const config = loadConfig();
  return config.apiKey || null;
}

/**
 * Check if auth is currently in progress
 */
export function isAuthInProgress(): boolean {
  return authInProgress;
}

/**
 * Get the current auth URL (if auth is in progress)
 */
export function getAuthUrl(): string | null {
  return authUrl;
}

/**
 * Start the OAuth flow - returns the auth URL
 */
export function startAuthFlow(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (authInProgress) {
      if (authUrl) {
        resolve(authUrl);
      } else {
        reject(new Error('Auth in progress but no URL available'));
      }
      return;
    }

    // Generate random state for security
    const state = crypto.randomUUID();
    authInProgress = true;

    // Start local server to receive callback
    authServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost`);

      if (url.pathname === '/callback') {
        const returnedState = url.searchParams.get('state');
        const apiKey = url.searchParams.get('api_key');
        const orgId = url.searchParams.get('org_id');
        const email = url.searchParams.get('email');
        const error = url.searchParams.get('error');

        // Verify state matches
        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(errorPage('Security Error', 'State mismatch. Please try again.'));
          return;
        }

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(errorPage('Authentication Failed', error));
          cleanupAuth();
          return;
        }

        if (apiKey) {
          // Save to config
          saveConfig({ apiKey, orgId: orgId || undefined, email: email || undefined });

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(successPage());
          cleanupAuth();
          return;
        }

        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing API key');
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    });

    // Find available port and start server
    authServer.listen(0, '127.0.0.1', () => {
      const address = authServer!.address();
      if (!address || typeof address === 'string') {
        authInProgress = false;
        reject(new Error('Failed to start local server'));
        return;
      }

      const port = (address as any).port;
      const redirectUri = `http://localhost:${port}/callback`;
      authUrl = `${VAPI_DASHBOARD_URL}/auth/cli?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;

      resolve(authUrl);

      // Timeout after 10 minutes
      setTimeout(() => {
        if (authInProgress) {
          cleanupAuth();
        }
      }, 10 * 60 * 1000);
    });

    authServer.on('error', (err) => {
      authInProgress = false;
      reject(err);
    });
  });
}

function cleanupAuth() {
  authInProgress = false;
  authUrl = null;
  if (authServer) {
    authServer.close();
    authServer = null;
  }
}

function successPage(): string {
  return `
    <html>
      <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #111;">
        <div style="text-align: center; color: white;">
          <div style="font-size: 64px; margin-bottom: 16px;">✓</div>
          <h1 style="color: #16a34a;">Connected to Vapi!</h1>
          <p style="color: #888;">You can close this window and return to Claude.</p>
        </div>
      </body>
    </html>
  `;
}

function errorPage(title: string, message: string): string {
  return `
    <html>
      <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #111;">
        <div style="text-align: center; color: white;">
          <div style="font-size: 64px; margin-bottom: 16px;">✗</div>
          <h1 style="color: #dc2626;">${title}</h1>
          <p style="color: #888;">${message}</p>
        </div>
      </body>
    </html>
  `;
}
