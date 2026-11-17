import React from 'react';
import { Pause, Play, Trash2, RotateCcw, SkipForward, Coffee } from 'lucide-react';
import { PRAYER_CATEGORIES } from '../../data/defaults';
import { useStudio } from '../../context/StudioContext';

export const QueuePage: React.FC = () => {
  const {
    state,
    activeEvent,
    hasUserGesture,
    unlockAudioByGesture,
    toggleQueuePause,
    stopCurrentSpeech,
    removeQueueItem,
    retryQueueItem,
    clearQueue,
    simulateSampleCayGift,
  } = useStudio();

  const hasPendingAwaitingGesture =
    !hasUserGesture && !state.queuePaused && state.queue.some((q) => q.status === 'pending');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-[#1A2B54] pb-5">
        <div>
          <p className="text-xs text-[#D4B26A] font-medium tracking-[0.14em] uppercase">
            Sequential Playback
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-white">
            Smart Event Queue
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Unique event IDs, {state.tiktok.duplicateWindowSec}s duplicate protection, priority ordering, and persistent reload recovery.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => simulateSampleCayGift()}
            className="inline-flex items-center gap-2 bg-[#C9A45C] hover:bg-[#D7B46E] text-[#070D1B] font-semibold text-xs px-3.5 py-2.5 cursor-pointer"
          >
            <Coffee className="w-3.5 h-3.5" />
            <span>Add Test Çay</span>
          </button>

          <button
            type="button"
            onClick={toggleQueuePause}
            className="inline-flex items-center gap-2 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] text-white text-xs px-3.5 py-2.5 cursor-pointer"
          >
            {state.queuePaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            <span>{state.queuePaused ? 'Resume Queue' : 'Pause Queue'}</span>
          </button>

          {state.queue.length > 0 && (
            <button
              type="button"
              onClick={clearQueue}
              className="inline-flex items-center gap-2 bg-[#2B1822] hover:bg-[#3B202E] border border-rose-500/40 text-rose-200 text-xs px-3.5 py-2.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Queue</span>
            </button>
          )}
        </div>
      </div>

      {hasPendingAwaitingGesture && (
        <div className="bg-[#0E1834] border border-[#C9A45C]/50 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-xs text-slate-200">
            <strong className="text-[#E5C88B]">Android / Tarayıcı Ses İzni Bekleniyor:</strong>{' '}
            Kuyrukta bekleyen dua var. Otomatik ses başlatmayı engellememek için ses motorunu dokunarak başlatın.
          </div>
          <button
            type="button"
            onClick={unlockAudioByGesture}
            className="inline-flex items-center gap-2 bg-[#C9A45C] hover:bg-[#D7B46E] text-[#070D1B] font-semibold text-xs px-4 py-2 shrink-0 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Sesi ve Kuyruğu Başlat</span>
          </button>
        </div>
      )}

      {/* Queue State Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-[#0B142B] border border-[#1B2D58] p-4">
          <p className="text-xs text-slate-400">Queue Status</p>
          <p className="mt-1 text-base font-semibold text-white">
            {state.queuePaused ? 'Paused' : activeEvent ? 'Playing' : 'Listening / Ready'}
          </p>
        </div>
        <div className="bg-[#0B142B] border border-[#1B2D58] p-4">
          <p className="text-xs text-slate-400">Items in Queue</p>
          <p className="mt-1 font-mono-tabular text-xl font-semibold text-white">
            {state.queue.length}
          </p>
        </div>
        <div className="bg-[#0B142B] border border-[#1B2D58] p-4">
          <p className="text-xs text-slate-400">Dedupe Window</p>
          <p className="mt-1 font-mono-tabular text-xl font-semibold text-[#E5C88B]">
            {state.tiktok.duplicateWindowSec}s
          </p>
        </div>
        <div className="bg-[#0B142B] border border-[#1B2D58] p-4">
          <p className="text-xs text-slate-400">Failed Items</p>
          <p className="mt-1 font-mono-tabular text-xl font-semibold text-white">
            {state.queue.filter((q) => q.status === 'failed').length}
          </p>
        </div>
      </div>

      {/* Queue List */}
      {state.queue.length === 0 ? (
        <div className="bg-[#0B142B] border border-[#1B2D58] p-12 text-center">
          <p className="font-display text-2xl text-white">Queue is Empty</p>
          <p className="mt-1 text-sm text-slate-400">
            Incoming gifts from simulated tests or configured TikTok connectors appear here in priority order.
          </p>
          <button
            type="button"
            onClick={() => simulateSampleCayGift()}
            className="mt-4 bg-[#C9A45C] text-[#070D1B] font-semibold text-xs px-4 py-2.5 cursor-pointer"
          >
            Simulate Çay Gift
          </button>
        </div>
      ) : (
        <div className="bg-[#0B142B] border border-[#1B2D58] divide-y divide-[#16254A]">
          {state.queue.map((item, index) => {
            const cat = PRAYER_CATEGORIES.find((c) => c.id === item.category)?.labelTr || item.category;
            const scholarName = state.scholars.profiles[item.scholarId].name;
            return (
              <div
                key={item.id}
                className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono-tabular text-slate-400">#{index + 1}</span>
                    <span className="font-mono-tabular text-slate-400">{item.id}</span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className={item.source === 'simulation' ? 'text-amber-300' : 'text-emerald-300'}>
                      {item.source === 'simulation' ? 'Simulation' : 'Real TikTok'}
                    </span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="capitalize text-slate-300">{item.priority} priority</span>
                  </div>

                  <p className="text-base font-semibold text-white">
                    {item.displayUsername} — {item.giftName} × {item.quantity}
                  </p>

                  <p className="text-xs text-slate-400">
                    {scholarName} · {cat} · {item.prayerTitle}
                  </p>

                  <p className="text-xs text-slate-300 line-clamp-2 pt-0.5">
                    {item.renderedPrayer}
                  </p>

                  {item.errorMessage && (
                    <p className="text-xs text-rose-400 pt-1">Error: {item.errorMessage}</p>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`text-xs font-mono-tabular px-2.5 py-1 border ${
                      item.status === 'speaking'
                        ? 'border-[#C9A45C]/60 text-[#E5C88B] bg-[#C9A45C]/10'
                        : item.status === 'failed'
                        ? 'border-rose-500/40 text-rose-300 bg-rose-950/30'
                        : 'border-[#253B6E] text-slate-300 bg-[#070E1F]'
                    }`}
                  >
                    {item.status}
                  </span>

                  {item.status === 'failed' && (
                    <button
                      type="button"
                      onClick={() => retryQueueItem(item.id)}
                      className="inline-flex items-center gap-1 text-xs text-[#E5C88B] hover:text-white px-2 py-1.5 border border-[#29437F] cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Retry</span>
                    </button>
                  )}

                  {item.status === 'speaking' ? (
                    <button
                      type="button"
                      onClick={stopCurrentSpeech}
                      className="inline-flex items-center gap-1 text-xs text-rose-300 hover:text-white px-2.5 py-1.5 border border-rose-500/40 cursor-pointer"
                    >
                      <SkipForward className="w-3.5 h-3.5" />
                      <span>Skip</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => removeQueueItem(item.id)}
                      className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-400 px-2.5 py-1.5 border border-[#233969] cursor-pointer"
                      aria-label={`Remove ${item.displayUsername} from queue`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
