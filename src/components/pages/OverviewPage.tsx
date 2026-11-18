import React, { useState } from 'react';
import {
  Play,
  Pause,
  SkipForward,
  Coffee,
  ExternalLink,
  Copy,
  Check,
  AlertCircle,
} from 'lucide-react';
import { PRAYER_CATEGORIES } from '../../data/defaults';
import { useStudio } from '../../context/StudioContext';
import { AdminSectionId } from '../../types/nuridua';
import { browserTTSProvider } from '../../services/ttsService';
import { getTikTokStateLabel } from '../../services/tiktokLiveConnectorService';

interface OverviewPageProps {
  onNavigate: (section: AdminSectionId) => void;
  onOpenStandaloneBroadcast: () => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({
  onNavigate,
  onOpenStandaloneBroadcast,
}) => {
  const {
    state,
    activeEvent,
    speakingState,
    availableVoices,
    simulateSampleCayGift,
    enqueueGiftEvent,
    toggleQueuePause,
    stopCurrentSpeech,
  } = useStudio();

  const [simNotice, setSimNotice] = useState<string | null>(null);
  const [customUser, setCustomUser] = useState('');
  const [customGiftId, setCustomGiftId] = useState(state.gifts[0]?.id || 'Çay');
  const [customQty, setCustomQty] = useState(1);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const pendingCount = state.queue.filter((q) => q.status === 'pending' || q.status === 'speaking').length;
  const completedCount = state.history.filter((h) => h.status === 'completed').length;
  const failedCount = state.queue.filter((q) => q.status === 'failed').length;

  const activeScholarId = activeEvent?.scholarId || state.scholars.currentSpeaker;
  const activeScholar = state.scholars.profiles[activeScholarId];

  const turkishVoicesCount = availableVoices.filter((v) => v.isTurkish).length;
  const speechSupported = browserTTSProvider.isSupported();

  const broadcastUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/?view=broadcast` : '/?view=broadcast';

  const handleQuickCay = () => {
    const res = simulateSampleCayGift();
    if (res.ok && res.event) {
      setSimNotice(
        `Simulated Çay gift queued for ${res.event.displayUsername} → "${res.event.prayerTitle}".`
      );
    } else {
      setSimNotice(res.reason || 'Could not queue simulated gift.');
    }
  };

  const handleCustomSim = (e: React.FormEvent) => {
    e.preventDefault();
    const res = enqueueGiftEvent({
      source: 'simulation',
      username: customUser,
      giftIdOrName: customGiftId,
      quantity: customQty,
    });
    if (res.ok && res.event) {
      setSimNotice(
        `Simulated ${res.event.giftName} x${res.event.quantity} queued for ${res.event.displayUsername}.`
      );
      setCustomUser('');
    } else {
      setSimNotice(res.reason || 'Simulation rejected.');
    }
  };

  const handleCopyBroadcastUrl = () => {
    navigator.clipboard?.writeText(broadcastUrl);
    setCopiedUrl(true);
    window.setTimeout(() => setCopiedUrl(false), 2000);
  };

  const recentEvents = (() => {
    const seen = new Set<string>();
    const combined: typeof state.queue = [];
    for (const ev of [...state.queue, ...state.history]) {
      if (!ev || seen.has(ev.id)) continue;
      seen.add(ev.id);
      combined.push(ev);
      if (combined.length >= 6) break;
    }
    return combined;
  })();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-[#1A2B54] pb-5">
        <div>
          <p className="text-xs text-[#D4B26A] font-medium tracking-[0.14em] uppercase">
            Studio Operations
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-white">
            Broadcast Overview
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Real-time queue telemetry, digital scholar status, and separate simulation controls.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleQuickCay}
            className="inline-flex items-center gap-2 bg-[#C9A45C] hover:bg-[#D7B46E] text-[#070D1B] font-semibold text-xs sm:text-sm px-4 py-2.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Coffee className="w-4 h-4" />
            <span>Simulate Çay Gift</span>
          </button>
          <button
            type="button"
            onClick={onOpenStandaloneBroadcast}
            className="inline-flex items-center gap-2 bg-[#112046] hover:bg-[#182C5E] border border-[#28427D] text-slate-100 text-xs sm:text-sm px-4 py-2.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ExternalLink className="w-4 h-4 text-[#E5C88B]" />
            <span>Open 1080×1920 Studio</span>
          </button>
        </div>
      </div>

      {simNotice && (
        <div className="bg-[#101D3D] border border-[#C9A45C]/40 px-4 py-3 text-sm text-[#F4E3BD] flex items-center justify-between gap-4">
          <span>{simNotice}</span>
          <button
            type="button"
            onClick={() => setSimNotice(null)}
            className="text-xs text-slate-400 hover:text-white cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0B142B] border border-[#1B2D58] p-4 sm:p-5">
          <p className="text-xs text-slate-400">Total Gifts Processed</p>
          <p className="mt-2 font-mono-tabular text-2xl sm:text-3xl font-semibold text-white">
            {state.stats.totalGifts}
          </p>
          <p className="mt-1.5 text-xs text-slate-400">
            Sim {state.stats.simulatedGifts} · Real {state.stats.realGifts}
          </p>
        </div>

        <div className="bg-[#0B142B] border border-[#1B2D58] p-4 sm:p-5">
          <p className="text-xs text-slate-400">Completed Prayers</p>
          <p className="mt-2 font-mono-tabular text-2xl sm:text-3xl font-semibold text-[#E5C88B]">
            {completedCount}
          </p>
          <p className="mt-1.5 text-xs text-slate-400">
            Lifetime count {state.stats.totalPrayers}
          </p>
        </div>

        <div className="bg-[#0B142B] border border-[#1B2D58] p-4 sm:p-5">
          <p className="text-xs text-slate-400">Pending Queue</p>
          <p className="mt-2 font-mono-tabular text-2xl sm:text-3xl font-semibold text-white">
            {pendingCount}
          </p>
          <p className="mt-1.5 text-xs text-slate-400">
            {state.queuePaused ? 'Queue paused' : 'Sequential auto-play'}
            {failedCount > 0 ? ` · ${failedCount} failed` : ''}
          </p>
        </div>

        <div className="bg-[#0B142B] border border-[#1B2D58] p-4 sm:p-5">
          <p className="text-xs text-slate-400">Active Scholar</p>
          <p className="mt-2 font-display text-xl sm:text-2xl font-semibold text-white truncate">
            {activeScholar.name}
          </p>
          <p className="mt-1.5 text-xs text-[#D4B26A]">
            {speakingState === 'speaking'
              ? 'Reciting prayer'
              : speakingState === 'holding'
              ? 'Display hold'
              : 'Idle · Ready'}
          </p>
        </div>
      </div>

      {/* Status Row: TikTok Integration vs Broadcast vs System Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* TikTok LIVE Status */}
        <div className="bg-[#0B142B] border border-[#1B2D58] p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">TikTok LIVE Connection</h2>
              <span className="text-xs font-mono-tabular text-amber-400">
                {getTikTokStateLabel(state.tiktok.connectionState)}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-400 leading-relaxed">
              Real TikTok WebCast integration requires an approved backend connector relay. Simulated events are strictly isolated from live stream telemetry.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-[#16254A] flex items-center justify-between text-xs">
            <span className="text-slate-400">
              Target: {state.tiktok.username ? `@${state.tiktok.username}` : 'Unset'}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('tiktok')}
              className="text-[#E5C88B] hover:underline cursor-pointer"
            >
              Configure Connector
            </button>
          </div>
        </div>

        {/* Broadcast Status & OBS URL */}
        <div className="bg-[#0B142B] border border-[#1B2D58] p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">OBS Broadcast Source</h2>
              <span className="text-xs font-mono-tabular text-slate-300">1080×1920</span>
            </div>
            <p className="mt-2 text-xs text-slate-400 leading-relaxed">
              Add this clean URL in OBS Browser Source (Width 1080, Height 1920). Zero dashboard controls appear in broadcast mode.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-[#16254A] flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={broadcastUrl}
              aria-label="OBS Broadcast URL"
              className="flex-1 min-w-0 bg-[#070E1F] border border-[#1D315E] px-2.5 py-1.5 text-xs font-mono text-slate-300 truncate"
            />
            <button
              type="button"
              onClick={handleCopyBroadcastUrl}
              className="inline-flex items-center gap-1.5 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] px-3 py-1.5 text-xs text-white shrink-0 cursor-pointer"
            >
              {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedUrl ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>

        {/* System Health */}
        <div className="bg-[#0B142B] border border-[#1B2D58] p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">System Health</h2>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Browser SpeechSynthesis</dt>
                <dd className={speechSupported ? 'text-emerald-400 font-medium' : 'text-amber-400'}>
                  {speechSupported ? 'Available' : 'Text-timing fallback'}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Turkish (tr-TR) Voices</dt>
                <dd className="font-mono-tabular text-slate-200">
                  {turkishVoicesCount} detected
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Active Prayer Templates</dt>
                <dd className="font-mono-tabular text-slate-200">
                  {state.prayers.filter((p) => p.isActive).length} / {state.prayers.length}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Local Persistence</dt>
                <dd className="text-emerald-400 font-medium">Active</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      {/* Queue Activity + Simulation Sandbox */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Active Queue & Playback */}
        <div className="lg:col-span-3 bg-[#0B142B] border border-[#1B2D58] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#16254A]">
            <div>
              <h2 className="text-base font-semibold text-white">Live Queue &amp; Playback</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {activeEvent
                  ? `Now speaking for ${activeEvent.displayUsername} (${activeEvent.giftName})`
                  : 'Waiting for incoming gift event'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleQueuePause}
                className="inline-flex items-center gap-1.5 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] px-3 py-1.5 text-xs text-white cursor-pointer"
              >
                {state.queuePaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                <span>{state.queuePaused ? 'Resume Queue' : 'Pause Queue'}</span>
              </button>
              {activeEvent && (
                <button
                  type="button"
                  onClick={stopCurrentSpeech}
                  className="inline-flex items-center gap-1.5 bg-[#2B1822] hover:bg-[#3B202E] border border-rose-500/40 px-3 py-1.5 text-xs text-rose-200 cursor-pointer"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                  <span>Skip Current</span>
                </button>
              )}
            </div>
          </div>

          {activeEvent && (
            <div className="mt-4 bg-[#070E20] border border-[#C9A45C]/40 p-4">
              <div className="flex items-center justify-between text-xs text-[#E5C88B]">
                <span>
                  {activeScholar.name} · {activeEvent.source === 'simulation' ? 'Simulation' : 'Live'}
                </span>
                <span className="font-mono-tabular">{activeEvent.id}</span>
              </div>
              <p className="mt-2 font-display text-lg text-white leading-snug">
                {activeEvent.renderedPrayer}
              </p>
            </div>
          )}

          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span>Recent Gift &amp; Prayer Events</span>
              <button
                type="button"
                onClick={() => onNavigate('history')}
                className="text-[#E5C88B] hover:underline cursor-pointer"
              >
                View All History
              </button>
            </div>

            {recentEvents.length === 0 ? (
              <div className="py-8 text-center border border-dashed border-[#1E3361] text-xs text-slate-400">
                No gift events processed yet. Click &ldquo;Simulate Çay Gift&rdquo; to test the full prayer &amp; 3D scholar pipeline.
              </div>
            ) : (
              <div className="divide-y divide-[#16254A]">
                {recentEvents.map((ev) => {
                  const cat = PRAYER_CATEGORIES.find((c) => c.id === ev.category)?.labelTr || ev.category;
                  return (
                    <div key={ev.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <p className="text-slate-100 font-medium truncate">
                          {ev.displayUsername} · {ev.giftName} × {ev.quantity}
                        </p>
                        <p className="text-slate-400 truncate">
                          {cat} · {ev.source === 'simulation' ? 'Simulation' : 'Real'}
                        </p>
                      </div>
                      <span
                        className={`font-mono-tabular shrink-0 ${
                          ev.status === 'completed'
                            ? 'text-emerald-400'
                            : ev.status === 'speaking'
                            ? 'text-[#E5C88B]'
                            : ev.status === 'failed'
                            ? 'text-rose-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {ev.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Dedicated Simulation Sandbox */}
        <div className="lg:col-span-2 bg-[#0B142B] border border-[#1B2D58] p-5">
          <div className="flex items-center gap-2 text-xs text-[#D4B26A] font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Simulation Sandbox (Isolated from Real TikTok)</span>
          </div>
          <h2 className="mt-2 text-base font-semibold text-white">Custom Simulated Gift</h2>
          <p className="mt-1 text-xs text-slate-400">
            Test username sanitization, random category prayer lookup, Turkish TTS, and sequential queue ordering.
          </p>

          <form onSubmit={handleCustomSim} className="mt-4 space-y-3.5">
            <div>
              <label htmlFor="sim-username" className="block text-xs text-slate-300 mb-1">
                Sample Username (leave blank for random)
              </label>
              <input
                id="sim-username"
                type="text"
                value={customUser}
                onChange={(e) => setCustomUser(e.target.value)}
                placeholder="e.g. mustafa_yilmaz"
                className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label htmlFor="sim-gift" className="block text-xs text-slate-300 mb-1">
                  Configured Gift
                </label>
                <select
                  id="sim-gift"
                  value={customGiftId}
                  onChange={(e) => setCustomGiftId(e.target.value)}
                  className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
                >
                  {state.gifts.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} {!g.enabled ? '(Disabled)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="sim-qty" className="block text-xs text-slate-300 mb-1">
                  Quantity
                </label>
                <input
                  id="sim-qty"
                  type="number"
                  min={1}
                  max={99}
                  value={customQty}
                  onChange={(e) => setCustomQty(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-sm font-mono-tabular text-white focus:outline-none focus:border-[#C9A45C]"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-[#152854] hover:bg-[#1D3670] border border-[#C9A45C]/50 text-[#F4E3BD] font-semibold text-sm py-2.5 px-4 transition-colors cursor-pointer"
            >
              Send Simulated Gift to Queue
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
