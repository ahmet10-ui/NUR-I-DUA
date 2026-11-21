import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getServerTTSProvider, getServerTTSStatus } from './server/tts/providers';
import { NeuralTTSProviderId } from './server/tts/types';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = path.join(__dirname, '.nur-i-dua-state.json');

interface BroadcastSnapshot {
  appState: unknown | null;
  livePlayback: {
    activeEvent: unknown | null;
    speakingState: 'idle' | 'speaking' | 'holding';
    activeScholar: 'scholar_1' | 'scholar_2';
    mouthLevel: number;
    playbackStarted: boolean;
    updatedAt: string;
  };
}

let snapshot: BroadcastSnapshot = {
  appState: null,
  livePlayback: {
    activeEvent: null,
    speakingState: 'idle',
    activeScholar: 'scholar_1',
    mouthLevel: 0,
    playbackStarted: false,
    updatedAt: new Date().toISOString(),
  },
};

try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      snapshot.appState = parsed.appState ?? null;
    }
  }
} catch {
  // Safe fallback if local file is unreadable
}

function persistStateToDisk() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ appState: snapshot.appState, savedAt: new Date().toISOString() }, null, 2),
      'utf-8'
    );
  } catch {
    // Non-fatal in read-only environments
  }
}

const sseClients = new Set<express.Response>();

function broadcastSSE(eventName: string, payload: unknown) {
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(data);
    } catch {
      sseClients.delete(res);
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'nur-i-dua-studio',
      timestamp: new Date().toISOString(),
      connectedClients: sseClients.size,
      hasPersistedState: snapshot.appState !== null,
    });
  });

  app.get('/api/state', (_req, res) => {
    res.json({
      appState: snapshot.appState,
      livePlayback: snapshot.livePlayback,
    });
  });

  app.put('/api/state', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ ok: false, error: 'Invalid state payload' });
      return;
    }
    if ('appState' in body) {
      snapshot.appState = body.appState;
      persistStateToDisk();
      broadcastSSE('state_sync', { appState: snapshot.appState });
    }
    res.json({ ok: true, savedAt: new Date().toISOString() });
  });

  app.post('/api/live-playback', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ ok: false, error: 'Invalid live playback payload' });
      return;
    }
    snapshot.livePlayback = {
      activeEvent: body.activeEvent ?? null,
      speakingState: body.speakingState ?? 'idle',
      activeScholar: body.activeScholar ?? 'scholar_1',
      mouthLevel: typeof body.mouthLevel === 'number' ? body.mouthLevel : 0,
      playbackStarted: Boolean(body.playbackStarted),
      updatedAt: new Date().toISOString(),
    };
    broadcastSSE('live_playback', snapshot.livePlayback);
    res.json({ ok: true });
  });

  app.get('/api/tts/status', (_req, res) => {
    res.json(getServerTTSStatus());
  });

  app.post('/api/tts/synthesize', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ ok: false, error: 'Invalid TTS synthesis payload.' });
      return;
    }

    const rawText = typeof body.text === 'string' ? body.text.trim() : '';
    if (!rawText) {
      res.status(400).json({ ok: false, error: 'Text is required for TTS synthesis.' });
      return;
    }

    const cleanText = rawText.replace(/<[^>]*>/g, '').slice(0, 900);
    const providerId = (body.provider || 'azure_neural') as NeuralTTSProviderId;
    const provider = getServerTTSProvider(providerId);

    if (!provider) {
      res.status(400).json({ ok: false, error: `Unknown TTS provider: ${String(providerId)}` });
      return;
    }

    const result = await provider.synthesize({
      text: cleanText,
      provider: providerId,
      voiceId: typeof body.voiceId === 'string' ? body.voiceId : undefined,
      rate: typeof body.rate === 'number' ? body.rate : 0.86,
      pitch: typeof body.pitch === 'number' ? body.pitch : 0.84,
      tone: body.tone === 'warm_classic' ? 'warm_classic' : 'calm_elderly',
    });

    if (!result.ok || !result.audioBuffer) {
      res.status(result.statusCode || 503).json({
        ok: false,
        configured: result.configured,
        provider: result.provider,
        missingEnv: result.missingEnv || [],
        error: result.error || 'Neural TTS synthesis failed.',
      });
      return;
    }

    res.setHeader('Content-Type', result.contentType || 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(result.audioBuffer);
  });

  app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    sseClients.add(res);
    res.write(
      `event: initial\ndata: ${JSON.stringify({
        appState: snapshot.appState,
        livePlayback: snapshot.livePlayback,
      })}\n\n`
    );

    const keepAlive = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NUR-I DUA server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
