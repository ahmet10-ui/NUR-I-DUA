import React from 'react';
import { Volume2, Layers } from 'lucide-react';
import { useStudio } from '../../context/StudioContext';
import { ActiveScholarMode, ScholarId } from '../../types/nuridua';

export const ScholarsPage: React.FC = () => {
  const { state, updateScholarsConfig, updateScholarProfile, testVoicePlayback } = useStudio();
  const { scholars } = state;

  return (
    <div className="space-y-6">
      <div className="border-b border-[#1A2B54] pb-5">
        <p className="text-xs text-[#D4B26A] font-medium tracking-[0.14em] uppercase">
          Photorealistic Live Scene
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-white">
          Scholar Settings
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Configure speaker rotation, natural eye blinking, breathing, head nodding, and voice assignment for Hacı Ahmet Efendi and Hacı Mehmet Efendi.
        </p>
      </div>

      {/* Global Rotation & Motion Tuning */}
      <div className="bg-[#0B142B] border border-[#1B2D58] p-5 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-white">Active Speaker Rotation</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            While the active scholar recites the prayer with audio-reactive mouth &amp; hand animation, the companion scholar listens attentively.
          </p>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {(
              [
                { id: 'alternate', label: 'Alternate Automatically' },
                { id: 'scholar_1', label: `Always ${scholars.profiles.scholar_1.name}` },
                { id: 'scholar_2', label: `Always ${scholars.profiles.scholar_2.name}` },
              ] as Array<{ id: ActiveScholarMode; label: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => updateScholarsConfig({ activeMode: opt.id })}
                className={`px-3.5 py-2.5 text-xs font-medium border text-left transition-colors cursor-pointer ${
                  scholars.activeMode === opt.id
                    ? 'bg-[#C9A45C] text-[#070D1B] border-[#C9A45C]'
                    : 'bg-[#070E1F] text-slate-300 border-[#233969] hover:border-[#C9A45C]/50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 pt-4 border-t border-[#16254A]">
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <label htmlFor="blink-interval" className="text-slate-300">
                Natural Blink Interval
              </label>
              <span className="font-mono-tabular text-[#E5C88B]">
                {scholars.blinkIntervalSec.toFixed(1)}s
              </span>
            </div>
            <input
              id="blink-interval"
              type="range"
              min={2.0}
              max={6.5}
              step={0.2}
              value={scholars.blinkIntervalSec}
              onChange={(e) =>
                updateScholarsConfig({ blinkIntervalSec: Number(e.target.value) })
              }
              className="w-full accent-[#C9A45C]"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <label htmlFor="head-intensity" className="text-slate-300">
                Head Movement Expressiveness
              </label>
              <span className="font-mono-tabular text-[#E5C88B]">
                {Math.round(scholars.headMovementIntensity * 100)}%
              </span>
            </div>
            <input
              id="head-intensity"
              type="range"
              min={0.1}
              max={1.3}
              step={0.05}
              value={scholars.headMovementIntensity}
              onChange={(e) =>
                updateScholarsConfig({ headMovementIntensity: Number(e.target.value) })
              }
              className="w-full accent-[#C9A45C]"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <label htmlFor="breath-intensity" className="text-slate-300">
                Idle Breathing Motion
              </label>
              <span className="font-mono-tabular text-[#E5C88B]">
                {Math.round(scholars.idleBreathingIntensity * 100)}%
              </span>
            </div>
            <input
              id="breath-intensity"
              type="range"
              min={0.1}
              max={1.3}
              step={0.05}
              value={scholars.idleBreathingIntensity}
              onChange={(e) =>
                updateScholarsConfig({ idleBreathingIntensity: Number(e.target.value) })
              }
              className="w-full accent-[#C9A45C]"
            />
          </div>
        </div>

        <label className="inline-flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={scholars.listenerInteractionEnabled}
            onChange={(e) =>
              updateScholarsConfig({ listenerInteractionEnabled: e.target.checked })
            }
            className="accent-[#C9A45C] w-4 h-4"
          />
          <span>Enable subtle listener head turn &amp; nodding toward active speaker</span>
        </label>
      </div>

      {/* Individual Scholar Profiles */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {(['scholar_1', 'scholar_2'] as ScholarId[]).map((sid, idx) => {
          const profile = scholars.profiles[sid];
          return (
            <div key={sid} className="bg-[#0B142B] border border-[#1B2D58] p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-[#D4B26A]">
                    Scholar 0{idx + 1} · Fictional Digital Character
                  </p>
                  <h2 className="mt-0.5 font-display text-2xl font-semibold text-white">
                    {profile.name}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    testVoicePlayback(
                      `Selamün aleyküm, ben ${profile.name}. Hayırlı ve huzurlu yayınlar dilerim.`,
                      sid
                    )
                  }
                  className="inline-flex items-center gap-1.5 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] px-3 py-1.5 text-xs text-white cursor-pointer"
                >
                  <Volume2 className="w-3.5 h-3.5 text-[#E5C88B]" />
                  <span>Test Scholar</span>
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Display Name</label>
                  <input
                    type="text"
                    value={profile.name}
                    onChange={(e) => updateScholarProfile(sid, { name: e.target.value })}
                    className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1">Role / Title</label>
                  <input
                    type="text"
                    value={profile.title}
                    onChange={(e) => updateScholarProfile(sid, { title: e.target.value })}
                    className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Photorealistic Stage Architecture Summary */}
      <div className="bg-[#0B142B] border border-[#1B2D58] p-5 flex items-start gap-3.5 text-xs text-slate-300 leading-relaxed">
        <Layers className="w-5 h-5 text-[#D4B26A] shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-white">
            Photorealistic Mosque Broadcast Stage (WebGL Portrait Animator)
          </p>
          <p className="mt-1 text-slate-400">
            The broadcast viewport renders a high-resolution Ottoman mosque photographic plate driven by a lightweight GPU facial &amp; body motion shader—delivering audio-reactive jaw movement, self-sampled eyelid blinking, chest breathing, subtle dua hand cadence, and listener head turning without heavy 3D meshes or runtime API calls.
          </p>
        </div>
      </div>
    </div>
  );
};
