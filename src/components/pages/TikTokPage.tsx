import React, { useState } from 'react';
import { Radio, AlertTriangle, Coffee, PlugZap, Unplug } from 'lucide-react';
import { useStudio } from '../../context/StudioContext';

export const TikTokPage: React.FC = () => {
  const {
    state,
    updateTikTokConfig,
    attemptTikTokConnect,
    disconnectTikTok,
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

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnecting(true);
    setConnectFeedback(null);
    const res = await attemptTikTokConnect();
    setConnecting(false);
    if (!res.ok) {
      setConnectFeedback(res.error || 'Unable to establish TikTok LIVE connection.');
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
          Modular gift event adapter separating real TikTok LIVE relay configuration from local simulation tests.
        </p>
      </div>

      {/* Honest Integration Banner */}
      <div className="bg-[#121B35] border border-amber-500/40 p-4 flex items-start gap-3 text-xs text-slate-200 leading-relaxed">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-amber-300">
            Integration Status: {tiktok.connectionState === 'unconfigured' ? 'Not Configured' : tiktok.connectionState}
          </p>
          <p className="mt-1 text-slate-300">
            Direct browser access to TikTok LIVE WebCast streams requires an approved external connector or self-hosted relay service. This application never fabricates a live TikTok connection or fake credentials.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Real TikTok LIVE Connector Configuration */}
        <form
          onSubmit={handleConnect}
          className="bg-[#0B142B] border border-[#1B2D58] p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Radio className="w-4 h-4 text-[#D4B26A]" />
              <span>Real TikTok Connector Configuration</span>
            </h2>
            <span className="text-xs font-mono-tabular text-amber-400">
              {tiktok.connectionState}
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
              placeholder="e.g. nuridua.official"
              className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
            />
          </div>

          <div>
            <label htmlFor="tk-endpoint" className="block text-xs text-slate-300 mb-1.5">
              Approved Connector Relay URL (Optional)
            </label>
            <input
              id="tk-endpoint"
              type="url"
              value={tiktok.connectorEndpoint}
              onChange={(e) => updateTikTokConfig({ connectorEndpoint: e.target.value })}
              placeholder="https://your-relay.example.com/tiktok-connect"
              className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-[#C9A45C]"
            />
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
              disabled={connecting}
              className="inline-flex items-center gap-2 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] text-white text-xs font-medium px-4 py-2.5 cursor-pointer"
            >
              <PlugZap className="w-3.5 h-3.5 text-[#E5C88B]" />
              <span>{connecting ? 'Checking Relay...' : 'Verify & Connect'}</span>
            </button>

            <button
              type="button"
              onClick={disconnectTikTok}
              className="inline-flex items-center gap-2 bg-[#070E1F] hover:bg-[#101C3B] border border-[#233969] text-slate-300 text-xs px-4 py-2.5 cursor-pointer"
            >
              <Unplug className="w-3.5 h-3.5" />
              <span>Disconnect</span>
            </button>
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
