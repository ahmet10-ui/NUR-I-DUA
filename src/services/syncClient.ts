import { AppState, QueueEvent, ScholarId } from '../types/nuridua';

const STORAGE_KEY = 'nur_i_dua_studio_state_v1';
const BROADCAST_CHANNEL_NAME = 'nur_i_dua_sync_channel';

export interface LivePlaybackPayload {
  activeEvent: QueueEvent | null;
  speakingState: 'idle' | 'speaking' | 'holding';
  activeScholar: ScholarId;
  mouthLevel: number;
  playbackStarted?: boolean;
}

export function loadLocalState(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AppState;
  } catch {
    return null;
  }
}

export function saveLocalState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage quota exceeded or unavailable
  }
}

export function clearLocalState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export async function fetchServerState(): Promise<{
  appState: AppState | null;
  livePlayback: LivePlaybackPayload | null;
} | null> {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function pushServerState(state: AppState): Promise<boolean> {
  try {
    const res = await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appState: state }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function pushLivePlayback(payload: LivePlaybackPayload): Promise<void> {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      ch.postMessage({ type: 'live_playback', payload });
      ch.close();
    }
  } catch {
    // ignore
  }
  try {
    await fetch('/api/live-playback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Offline or static fallback
  }
}

export function notifyLocalChannelState(state: AppState): void {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      ch.postMessage({ type: 'state_sync', payload: state });
      ch.close();
    }
  } catch {
    // ignore
  }
}

export function subscribeToStudioSync(handlers: {
  onState?: (state: AppState) => void;
  onLivePlayback?: (payload: LivePlaybackPayload) => void;
}): () => void {
  let channel: BroadcastChannel | null = null;
  let eventSource: EventSource | null = null;

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      channel.onmessage = (ev) => {
        if (ev.data?.type === 'state_sync' && ev.data.payload) {
          handlers.onState?.(ev.data.payload);
        } else if (ev.data?.type === 'live_playback' && ev.data.payload) {
          handlers.onLivePlayback?.(ev.data.payload);
        }
      };
    } catch {
      channel = null;
    }
  }

  if (typeof EventSource !== 'undefined') {
    try {
      eventSource = new EventSource('/api/stream');
      eventSource.addEventListener('initial', (ev) => {
        try {
          const parsed = JSON.parse((ev as MessageEvent).data);
          if (parsed.appState) handlers.onState?.(parsed.appState);
          if (parsed.livePlayback) handlers.onLivePlayback?.(parsed.livePlayback);
        } catch {
          // ignore
        }
      });
      eventSource.addEventListener('state_sync', (ev) => {
        try {
          const parsed = JSON.parse((ev as MessageEvent).data);
          if (parsed.appState) handlers.onState?.(parsed.appState);
        } catch {
          // ignore
        }
      });
      eventSource.addEventListener('live_playback', (ev) => {
        try {
          const parsed = JSON.parse((ev as MessageEvent).data);
          handlers.onLivePlayback?.(parsed);
        } catch {
          // ignore
        }
      });
    } catch {
      eventSource = null;
    }
  }

  return () => {
    channel?.close();
    eventSource?.close();
  };
}
