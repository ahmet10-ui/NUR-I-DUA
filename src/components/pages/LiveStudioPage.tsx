import React, { useState } from 'react';
import { Coffee, Copy, Check, ExternalLink, Pause, Play, SkipForward, Camera } from 'lucide-react';
import { useStudio } from '../../context/StudioContext';
import { BroadcastView } from '../BroadcastView';
import { CameraPreset } from '../../three/MosqueScene';

interface LiveStudioPageProps {
  onOpenStandaloneBroadcast: () => void;
}

export const LiveStudioPage: React.FC<LiveStudioPageProps> = ({ onOpenStandaloneBroadcast }) => {
  const {
    state,
    activeEvent,
    speakingState,
    simulateSampleCayGift,
    toggleQueuePause,
    stopCurrentSpeech,
    updateBroadcastConfig,
  } = useStudio();

  const [copied, setCopied] = useState(false);

  const broadcastUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/?view=broadcast` : '/?view=broadcast';

  const handleCopy = () => {
    navigator.clipboard?.writeText(broadcastUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-[#1A2B54] pb-5">
        <div>
          <p className="text-xs text-[#D4B26A] font-medium tracking-[0.14em] uppercase">
            1080×1920 Vertical Canvas
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-white">
            Live Broadcast Studio
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Real-time 3D Ottoman mosque preview with synchronized Turkish speech and gold prayer overlays.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => simulateSampleCayGift()}
            className="inline-flex items-center gap-2 bg-[#C9A45C] hover:bg-[#D7B46E] text-[#070D1B] font-semibold text-xs sm:text-sm px-4 py-2.5 cursor-pointer"
          >
            <Coffee className="w-4 h-4" />
            <span>Simulate Çay</span>
          </button>
          <button
            type="button"
            onClick={onOpenStandaloneBroadcast}
            className="inline-flex items-center gap-2 bg-[#112046] hover:bg-[#182C5E] border border-[#28427D] text-white text-xs sm:text-sm px-4 py-2.5 cursor-pointer"
          >
            <ExternalLink className="w-4 h-4 text-[#E5C88B]" />
            <span>Clean OBS View</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* 9:16 Vertical Studio Preview */}
        <div className="lg:col-span-6 xl:col-span-5 flex justify-center bg-[#060B17] border border-[#1B2D58] p-4">
          <div className="w-full max-w-[360px] aspect-[9/16]">
            <BroadcastView />
          </div>
        </div>

        {/* Studio Controls & OBS Browser Source Config */}
        <div className="lg:col-span-6 xl:col-span-7 space-y-4">
          <div className="bg-[#0B142B] border border-[#1B2D58] p-5 space-y-4">
            <h2 className="text-base font-semibold text-white">Playback &amp; Camera Controls</h2>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleQueuePause}
                className="inline-flex items-center gap-2 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] px-3.5 py-2 text-xs text-white cursor-pointer"
              >
                {state.queuePaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                <span>{state.queuePaused ? 'Resume Queue' : 'Pause Queue'}</span>
              </button>

              <button
                type="button"
                disabled={!activeEvent}
                onClick={stopCurrentSpeech}
                className="inline-flex items-center gap-2 bg-[#2B1822] disabled:opacity-40 hover:bg-[#3B202E] border border-rose-500/40 px-3.5 py-2 text-xs text-rose-200 cursor-pointer disabled:cursor-not-allowed"
              >
                <SkipForward className="w-3.5 h-3.5" />
                <span>Stop Current Prayer</span>
              </button>
            </div>

            <div className="pt-2 border-t border-[#16254A]">
              <p className="text-xs text-slate-400 mb-2 flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-[#D4B26A]" />
                <span>3D Camera Framing Preset</span>
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'broadcast_portrait', label: '9:16 Portrait' },
                    { id: 'wide_mihrab', label: 'Wide Mihrab' },
                    { id: 'scholar_closeup', label: 'Scholar Focus' },
                  ] as Array<{ id: CameraPreset; label: string }>
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => updateBroadcastConfig({ cameraPreset: preset.id })}
                    className={`px-3 py-2 text-xs font-medium border transition-colors cursor-pointer ${
                      state.broadcast.cameraPreset === preset.id
                        ? 'bg-[#C9A45C] text-[#070D1B] border-[#C9A45C]'
                        : 'bg-[#070E1F] text-slate-300 border-[#233969] hover:border-[#C9A45C]/50'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-[#0B142B] border border-[#1B2D58] p-5 space-y-3">
            <h2 className="text-base font-semibold text-white">OBS Browser Source Integration</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              In OBS Studio, add a new <strong>Browser Source</strong>, set width to{' '}
              <span className="font-mono text-slate-200">1080</span> and height to{' '}
              <span className="font-mono text-slate-200">1920</span>, and paste the dedicated clean broadcast URL below. All simulated or live events synchronize via server-sent events.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={broadcastUrl}
                aria-label="Dedicated OBS Broadcast URL"
                className="flex-1 min-w-0 bg-[#070E1F] border border-[#233969] px-3 py-2 text-xs font-mono text-slate-200"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 bg-[#C9A45C] text-[#070D1B] font-semibold text-xs px-3.5 py-2 shrink-0 cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy URL'}</span>
              </button>
            </div>
          </div>

          <div className="bg-[#0B142B] border border-[#1B2D58] p-5">
            <h2 className="text-sm font-semibold text-white">Current Broadcast Telemetry</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-slate-400">Scene State</dt>
                <dd className="mt-0.5 text-slate-100 capitalize">{speakingState}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Queued Waiting</dt>
                <dd className="mt-0.5 font-mono-tabular text-slate-100">
                  {state.queue.filter((q) => q.status === 'pending').length}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Current Speaker</dt>
                <dd className="mt-0.5 text-[#E5C88B]">
                  {state.scholars.profiles[activeEvent?.scholarId || state.scholars.currentSpeaker].name}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Post-Speech Hold</dt>
                <dd className="mt-0.5 font-mono-tabular text-slate-100">
                  {state.broadcast.postSpeechHoldSec}s
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
};
