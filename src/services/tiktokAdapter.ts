import { ITikTokGiftAdapter, TikTokConnectionState } from '../types/nuridua';
import { sanitizeTikTokHandle } from '../utils/sanitize';

/**
 * Honest, non-fabricated TikTok LIVE adapter.
 * A browser SPA cannot establish a direct TikTok WebCast socket without an approved
 * external relay/connector service. This adapter strictly reports 'unconfigured'
 * unless a real WebSocket/HTTP relay endpoint is provided and verified.
 */
export class UnconfiguredLiveTikTokAdapter implements ITikTokGiftAdapter {
  readonly mode = 'real' as const;
  private endpoint: string;
  private status: TikTokConnectionState = 'unconfigured';

  constructor(connectorEndpoint = '') {
    this.endpoint = connectorEndpoint.trim();
    this.status = this.endpoint ? 'disconnected' : 'unconfigured';
  }

  get isConfigured(): boolean {
    return this.endpoint.length > 0;
  }

  getStatus(): TikTokConnectionState {
    return this.status;
  }

  async connect(username: string): Promise<{ ok: boolean; error?: string }> {
    const cleanHandle = sanitizeTikTokHandle(username);
    if (!cleanHandle) {
      this.status = 'error';
      return {
        ok: false,
        error: 'Enter a valid TikTok @username before attempting connection.',
      };
    }

    if (!this.endpoint) {
      this.status = 'unconfigured';
      return {
        ok: false,
        error:
          'TikTok LIVE Connector Relay is not configured. Official TikTok LIVE integration requires an approved backend relay URL; use the Simulation panel for local testing.',
      };
    }

    this.status = 'connecting';
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 5000);
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanHandle }),
        signal: controller.signal,
      });
      window.clearTimeout(timer);

      if (!response.ok) {
        this.status = 'error';
        return {
          ok: false,
          error: `Connector relay responded with HTTP ${response.status}. Connection not established.`,
        };
      }
      this.status = 'disconnected';
      return {
        ok: false,
        error: 'Connector handshake verification incomplete. Verify WebCast stream permissions on your relay server.',
      };
    } catch (err) {
      this.status = 'error';
      return {
        ok: false,
        error:
          err instanceof Error
            ? `Unable to reach TikTok connector relay: ${err.message}`
            : 'Unable to reach TikTok connector relay.',
      };
    }
  }

  disconnect(): void {
    this.status = this.endpoint ? 'disconnected' : 'unconfigured';
  }
}

export const simulatedAdapterInfo: ITikTokGiftAdapter = {
  mode: 'simulation',
  isConfigured: true,
  getStatus: () => 'disconnected',
  connect: async () => ({ ok: true }),
  disconnect: () => {},
};
