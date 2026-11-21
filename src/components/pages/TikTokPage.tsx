import React, { useState } from 'react';
import {
  Radio,
  AlertTriangle,
  Coffee,
  PlugZap,
  Unplug,
  ShieldCheck,
  Server,
  FlaskConical,
  X,
} from 'lucide-react';
import { useStudio } from '../../context/StudioContext';
import { getTikTokStateLabel } from '../../services/tiktokLiveConnectorService';

function getStatusBadgeClass(connectionState: string): string {
  switch (connectionState) {
    case 'connected':
      return 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300';
    case 'connecting':
      return 'bg-sky-500/15 border-sky-500/40 text-sky-300';
    case 'error':
      return 'bg-rose-500/15 border-rose-500/40 text-rose-300';
    case 'disconnected':
      return 'bg-slate-700/40 border-slate-500/40 text-slate-300';
    default:
      return 'bg-amber-500/15 border-amber-500/40 text-amber-300';
  }
}

export const TikTokPage: React.FC = () => {
  const {
    state,
    updateTikTokConfig,
    attemptTikTokConnect,
    disconnectTikTok,
    recoveryGap,
    dismissRecoveryGap,
    simulationStreamActive,
    startSimulationSseListener,
    stopSimulationSseListener,
    triggerRelaySimulation,
    enqueueGiftEvent,
    simulateSampleCayGift,
  } = useStudio();

  const { tiktok } = state;
  const [connecting, setConnecting] = useState(false);
  const [connectFeedback, setConnectFeedback] = useState<string | null>(null);

  // Isolated Test Event Generator
  const [simUser, setSimUser] = useState('zeynep.arslan');
  const [simGiftId, setSimGiftId] = useState(state.gifts[0]?.id || 'Çay');
  const [simQty, setSimQty] = useState(1);
  const [simFeedback, setSimFeedback] = useState<string | null>(null);
  const [relaySimBusy, setRelaySimBusy] = useState(false);
  const [relaySimFeedback, setRelaySimFeedback] = useState<string | null>(null);

  const statusLabel = getTikTokStateLabel(tiktok.connectionState);
  const statusBadgeClass = getStatusBadgeClass(tiktok.connectionState);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnecting(true);
    setConnectFeedback(null);
    const res = await attemptTikTokConnect();
    setConnecting(false);
    if (!res.ok) {
      setConnectFeedback(res.error || 'TikTok LIVE bağlantısı kurulamadı.');
    } else {
      setConnectFeedback(null);
    }
  };

  const handleTestSim = (e: React.FormEvent) => {
    e.preventDefault();
    const res = enqueueGiftEvent({
      source: 'simulation',
      username: simUser,
      giftIdOrName: simGiftId,
      quantity: simQty,
    });
    setSimFeedback(
      res.ok && res.event
        ? `Simulated event ${res.event.id} queued for ${res.event.displayUsername}.`
        : res.reason || 'Simulation blocked.'
    );
  };

  const tiktokLogs = state.logs.filter((l) => l.source === 'tiktok' || l.level === 'error');

  return (
    <div className="space-y-6">
      <div className="border-b border-[#1A2B54] pb-5">
        <p className="text-xs text-[#D4B26A] font-medium tracking-[0.14em] uppercase">
          External Stream Adapter
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-white">
          TikTok LIVE Connection
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Dedicated <code className="font-mono text-slate-200">TikTokLiveConnectorService</code> for public{' '}
          <span className="text-[#E5C88B] font-medium">@{tiktok.username || 'fcproplayer7'}</span>{' '}
          stream gifts, strictly isolated from local simulation tests.
        </p>
      </div>

      {/* Honest Integration & Architecture Banner */}
      <div className="bg-[#121B35] border border-amber-500/40 p-4 flex items-start gap-3 text-xs text-slate-200 leading-relaxed">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1.5 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-amber-300">
              Bağlantı Durumu: {statusLabel}
            </p>
            <span className={`px-2 py-0.5 border font-mono-tabular text-[11px] ${statusBadgeClass}`}>
              {statusLabel}
            </span>
          </div>
          <p className="text-slate-300">
            Android Capacitor uygulaması ve tarayıcılar doğrudan Node.js{' '}
            <code className="font-mono text-slate-100">tiktok-live-connector</code> paketini çalıştıramaz.
            Gerçek TikTok canlı hediyelerini almak için bu istemci ayrı bir ücretsiz Node.js Relay Sunucusuna
            (Render, Koyeb, Fly.io veya yerel bilgisayar) HTTPS + SSE ile bağlanır. Relay URL girilmediğinde
            durum açıkça <strong>Not Configured</strong> olarak kalır; sahte canlı bağlantı üretilmez.
          </p>
          {tiktok.connectionState === 'connected' && (
            <p className="text-emerald-300 font-mono-tabular">
              Aktif Yayın: @{tiktok.username || 'fcproplayer7'}
              {tiktok.roomId ? ` · Oda ID: ${tiktok.roomId}` : ''}
              {typeof tiktok.viewerCount === 'number' ? ` · İzleyici: ${tiktok.viewerCount}` : ''}
            </p>
          )}
          {tiktok.lastError && (
            <p className="text-rose-300">
              Son Bilgi/Hata: {tiktok.lastError}
            </p>
          )}
        </div>
      </div>

      {recoveryGap && (
        <div
          role="alert"
          className="bg-amber-950/40 border border-amber-500/50 p-4 flex items-start justify-between gap-3 text-xs text-amber-100"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-amber-200">
                SSE Olay Kurtarma Uyarısı ({recoveryGap.reason === 'relay_restarted' ? 'Relay Yeniden Başlatıldı' : 'Tampon Boşluğu'})
              </p>
              <p className="text-amber-100/90 leading-relaxed">{recoveryGap.message}</p>
              <p className="text-[11px] text-amber-300/80 font-mono-tabular">
                Zaman: {new Date(recoveryGap.timestamp).toLocaleTimeString()}
                {typeof recoveryGap.missedEstimate === 'number'
                  ? ` · Tahmini Kaçan Olay: ${recoveryGap.missedEstimate}`
                  : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismissRecoveryGap}
            aria-label="Kurtarma uyarısını kapat"
            className="text-amber-200 hover:text-white p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Real TikTok LIVE Connector Configuration */}
        <form
          onSubmit={handleConnect}
          className="bg-[#0B142B] border border-[#1B2D58] p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Radio className="w-4 h-4 text-[#D4B26A]" />
              <span>Real TikTok Connector Configuration</span>
            </h2>
            <span className={`px-2 py-0.5 border text-xs font-mono-tabular ${statusBadgeClass}`}>
              {statusLabel}
            </span>
          </div>

          <div>
            <label htmlFor="tk-username" className="block text-xs text-slate-300 mb-1.5">
              Target TikTok Broadcaster @Username
            </label>
            <input
              id="tk-username"
              type="text"
              value={tiktok.username}
              onChange={(e) => updateTikTokConfig({ username: e.target.value })}
              placeholder="fcproplayer7"
              className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
            />
          </div>

          <div>
            <label htmlFor="tk-endpoint" className="block text-xs text-slate-300 mb-1.5">
              External Node.js Relay Base URL (Optional — HTTP/HTTPS)
            </label>
            <input
              id="tk-endpoint"
              type="url"
              value={tiktok.connectorEndpoint}
              onChange={(e) => updateTikTokConfig({ connectorEndpoint: e.target.value })}
              placeholder="https://your-nuridua-relay.onrender.com"
              className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-[#C9A45C]"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Leave blank to keep status as <strong>Not Configured</strong>. Compatible with the included{' '}
              <code className="font-mono text-slate-200">relay-server/</code> blueprint.
            </p>
          </div>

          <div className="bg-[#070E1F] border border-[#1A2B54] p-3 text-[11px] text-slate-300 space-y-1">
            <div className="flex items-center gap-1.5 text-emerald-300 font-medium">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>Zero-Credential Policy &amp; Streak Deduplication</span>
            </div>
            <p className="text-slate-400">
              Only the public <code className="font-mono text-slate-200">@fcproplayer7</code> handle is used.
              TikTok passwords, session cookies, or private tokens are never requested or stored. Gift streaks
              (<code className="font-mono text-slate-200">giftType === 1 &amp;&amp; !repeatEnd</code>) are buffered
              until completion so each streak queues one prayer with the accurate final quantity.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="tk-retries" className="block text-xs text-slate-300 mb-1">
                Max Retries
              </label>
              <input
                id="tk-retries"
                type="number"
                min={0}
                max={20}
                value={tiktok.maxRetries}
                onChange={(e) =>
                  updateTikTokConfig({ maxRetries: Math.max(0, Number(e.target.value) || 0) })
                }
                className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-sm font-mono-tabular text-white"
              />
            </div>

            <div>
              <label htmlFor="tk-delay" className="block text-xs text-slate-300 mb-1">
                Retry Delay (s)
              </label>
              <input
                id="tk-delay"
                type="number"
                min={2}
                max={60}
                value={tiktok.retryDelaySec}
                onChange={(e) =>
                  updateTikTokConfig({ retryDelaySec: Math.max(2, Number(e.target.value) || 5) })
                }
                className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-sm font-mono-tabular text-white"
              />
            </div>

            <div>
              <label htmlFor="tk-dedupe" className="block text-xs text-slate-300 mb-1">
                Dedupe (s)
              </label>
              <input
                id="tk-dedupe"
                type="number"
                min={2}
                max={60}
                value={tiktok.duplicateWindowSec}
                onChange={(e) =>
                  updateTikTokConfig({
                    duplicateWindowSec: Math.max(2, Number(e.target.value) || 8),
                  })
                }
                className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-sm font-mono-tabular text-white"
              />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={tiktok.autoReconnect}
              onChange={(e) => updateTikTokConfig({ autoReconnect: e.target.checked })}
              className="accent-[#C9A45C] w-4 h-4"
            />
            <span>Enable automatic reconnection backoff when relay is configured</span>
          </label>

          {connectFeedback && (
            <div className="bg-rose-950/40 border border-rose-500/35 px-3.5 py-2.5 text-xs text-rose-200">
              {connectFeedback}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={connecting || tiktok.connectionState === 'connecting'}
              className="inline-flex items-center gap-2 bg-[#13234B] hover:bg-[#1B3166] disabled:opacity-60 border border-[#29437F] text-white text-xs font-medium px-4 py-2.5 cursor-pointer"
            >
              <PlugZap className="w-3.5 h-3.5 text-[#E5C88B]" />
              <span>
                {connecting || tiktok.connectionState === 'connecting'
                  ? 'Bağlanıyor...'
                  : 'Verify & Connect'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => void disconnectTikTok()}
              className="inline-flex items-center gap-2 bg-[#070E1F] hover:bg-[#101C3B] border border-[#233969] text-slate-300 text-xs px-4 py-2.5 cursor-pointer"
            >
              <Unplug className="w-3.5 h-3.5" />
              <span>Disconnect</span>
            </button>
          </div>

          <div className="pt-2 border-t border-[#16254A] text-[11px] text-slate-400 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-[#D4B26A]" />
              <span>Real Gifts Recorded: {state.stats.realGifts}</span>
            </span>
            <span>Simulated Gifts: {state.stats.simulatedGifts}</span>
          </div>
        </form>

        {/* Separate Simulated Event Test Suite */}
        <div className="bg-[#0B142B] border border-[#1B2D58] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">Simulated Test Events</h2>
            <span className="text-xs text-[#D4B26A]">Simulation Only</span>
          </div>
          <p className="text-xs text-slate-400">
            All events generated here are tagged <code className="font-mono text-slate-200">source: &apos;simulation&apos;</code> and kept strictly separate from real TikTok stream metrics.
          </p>

          <form onSubmit={handleTestSim} className="space-y-3.5">
            <div>
              <label htmlFor="tk-sim-user" className="block text-xs text-slate-300 mb-1">
                Test Sender Username
              </label>
              <input
                id="tk-sim-user"
                type="text"
                value={simUser}
                onChange={(e) => setSimUser(e.target.value)}
                className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-sm text-white"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label htmlFor="tk-sim-gift" className="block text-xs text-slate-300 mb-1">
                  Gift Rule
                </label>
                <select
                  id="tk-sim-gift"
                  value={simGiftId}
                  onChange={(e) => setSimGiftId(e.target.value)}
                  className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-sm text-white"
                >
                  {state.gifts.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="tk-sim-qty" className="block text-xs text-slate-300 mb-1">
                  Quantity
                </label>
                <input
                  id="tk-sim-qty"
                  type="number"
                  min={1}
                  max={99}
                  value={simQty}
                  onChange={(e) => setSimQty(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-sm font-mono-tabular text-white"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2.5 pt-1">
              <button
                type="submit"
                className="inline-flex items-center gap-2 bg-[#C9A45C] hover:bg-[#D7B46E] text-[#070D1B] font-semibold text-xs px-4 py-2.5 cursor-pointer"
              >
                <span>Dispatch Test Event</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const res = simulateSampleCayGift();
                  setSimFeedback(
                    res.ok && res.event
                      ? `Random Çay simulation queued for ${res.event.displayUsername}.`
                      : res.reason || 'Blocked.'
                  );
                }}
                className="inline-flex items-center gap-2 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] text-white text-xs px-4 py-2.5 cursor-pointer"
              >
                <Coffee className="w-3.5 h-3.5 text-[#E5C88B]" />
                <span>Random Çay Simulation</span>
              </button>
            </div>
          </form>

          {simFeedback && (
            <p className="text-xs text-[#E5C88B] bg-[#070E1F] border border-[#C9A45C]/30 px-3 py-2">
              {simFeedback}
            </p>
          )}

          {/* Separated Relay SSE End-to-End Simulation Test Panel */}
          <div className="pt-4 border-t border-[#16254A] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-sky-300 shrink-0" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-sky-200">
                  Relay SSE Uçtan Uca Test Paneli
                </h3>
              </div>
              <span className="px-2 py-0.5 text-[10px] border border-sky-500/40 bg-sky-950/40 text-sky-200">
                Gerçek Yayından Bağımsızdır
              </span>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Relay sunucusu yalnızca test ortamında (<code className="font-mono text-slate-200">SIMULATION_ENABLED=true</code>) çalışırken{' '}
              <code className="font-mono text-slate-200">POST /simulate</code> üzerinden gerçek SSE hattına test olayları yollar; production ortamında 404 ile kapalıdır.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (simulationStreamActive) {
                    stopSimulationSseListener();
                    setRelaySimFeedback('Simülasyon SSE dinleyicisi durduruldu.');
                  } else {
                    const res = startSimulationSseListener();
                    setRelaySimFeedback(
                      res.ok
                        ? 'Simülasyon SSE test akışı dinleniyor (gerçek TikTok bağlantısı açılmadı).'
                        : res.error || 'SSE test akışı başlatılamadı.'
                    );
                  }
                }}
                className={`text-[11px] px-3 py-1.5 border cursor-pointer ${
                  simulationStreamActive
                    ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                    : 'border-[#29437F] bg-[#070E1F] text-slate-200 hover:bg-[#101C3B]'
                }`}
              >
                {simulationStreamActive ? 'SSE Test Akışını Durdur' : 'SSE Test Akışını Başlat'}
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(
                [
                  { id: 'follower', label: 'Takipçi' },
                  { id: 'small_gift', label: '1 Coin Küçük' },
                  { id: 'mid_gift', label: '75 Coin Orta' },
                  { id: 'high_gift', label: '200 Coin Yüksek' },
                  { id: 'yasin_300', label: '300+ Yâsîn Eşiği' },
                  { id: 'streak', label: 'Seri + repeatEnd' },
                  { id: 'incomplete_streak', label: 'Yarım Seri Testi' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={relaySimBusy}
                  onClick={async () => {
                    setRelaySimBusy(true);
                    const res = await triggerRelaySimulation(item.id);
                    setRelaySimBusy(false);
                    setRelaySimFeedback(res.message);
                  }}
                  className="bg-[#070E1F] hover:bg-[#112046] disabled:opacity-50 border border-[#233969] text-slate-200 text-[11px] px-2.5 py-2 text-left cursor-pointer"
                >
                  {item.label}
                </button>
              ))}
            </div>

            {relaySimFeedback && (
              <p className="text-[11px] text-sky-200 bg-[#070E1F] border border-sky-500/30 px-3 py-2">
                {relaySimFeedback}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Connection & Error Logs */}
      <div className="bg-[#0B142B] border border-[#1B2D58] p-5">
        <h2 className="text-base font-semibold text-white">Connector &amp; Error Logs</h2>
        {tiktokLogs.length === 0 ? (
          <p className="mt-3 text-xs text-slate-400">
            No TikTok connector errors logged yet.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-[#16254A] max-h-60 overflow-y-auto">
            {tiktokLogs.map((log) => (
              <div key={log.id} className="py-2.5 flex items-start justify-between gap-4 text-xs">
                <span className={log.level === 'error' ? 'text-rose-300' : 'text-amber-300'}>
                  {log.message}
                </span>
                <span className="font-mono-tabular text-slate-500 shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
