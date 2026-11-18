export {
  TikTokLiveConnectorService,
  getTikTokStateLabel,
  normalizeRelayBaseUrl,
} from './tiktokLiveConnectorService';

import { ITikTokGiftAdapter } from '../types/nuridua';

export const simulatedAdapterInfo: ITikTokGiftAdapter = {
  mode: 'simulation',
  isConfigured: true,
  getStatus: () => 'disconnected',
  connect: async () => ({ ok: true }),
  disconnect: () => {},
};
