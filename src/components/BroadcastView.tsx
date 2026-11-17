import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { PRAYER_CATEGORIES } from '../data/defaults';
import { useStudio } from '../context/StudioContext';
import { Logo } from './Logo';
import { MosqueViewport } from './MosqueViewport';

interface BroadcastViewProps {
  standalone?: boolean;
}

export const BroadcastView: React.FC<BroadcastViewProps> = ({ standalone = false }) => {
  const { state, activeEvent, speakingState } = useStudio();
  const { broadcast, scholars } = state;

  const activeScholarId = activeEvent?.scholarId || scholars.currentSpeaker;
  const activeScholarProfile = scholars.profiles[activeScholarId];
  const categoryMeta = activeEvent
    ? PRAYER_CATEGORIES.find((c) => c.id === activeEvent.category)
    : null;

  const showActiveCard = Boolean(activeEvent && speakingState !== 'idle');

  return (
    <div
      className={
        standalone
          ? 'w-screen h-screen bg-[#040812] flex items-center justify-center overflow-hidden'
          : 'w-full h-full flex items-center justify-center'
      }
    >
      {/* 1080x1920 (9:16) Vertical Broadcast Frame */}
      <div
        className="relative w-full h-full max-h-full aspect-[9/16] bg-[#070E21] overflow-hidden shadow-2xl border border-[#C9A45C]/25"
        style={{ maxWidth: standalone ? 'calc(100vh * 9 / 16)' : undefined }}
      >
        {/* 3D Ottoman Mosque & Two Animated Scholars (Unobstructed Central Focus) */}
        <MosqueViewport cameraPreset={broadcast.cameraPreset} className="absolute inset-0" />

        {/* Subtle Edge-Only Scrims so Mosque & Scholars Stay Crisp and Bright */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-28"
          style={{
            background:
              'linear-gradient(180deg, rgba(5,10,24,0.82) 0%, rgba(5,10,24,0.34) 65%, rgba(5,10,24,0) 100%)',
          }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-44"
          style={{
            background:
              'linear-gradient(0deg, rgba(5,10,24,0.92) 0%, rgba(5,10,24,0.56) 60%, rgba(5,10,24,0) 100%)',
          }}
        />

        {/* Delicate Gold Corner Filigree */}
        <div className="pointer-events-none absolute inset-2.5 border border-[#C9A45C]/18" />
        <div className="pointer-events-none absolute top-2.5 left-2.5 w-4 h-4 border-t-2 border-l-2 border-[#E5C88B]/65" />
        <div className="pointer-events-none absolute top-2.5 right-2.5 w-4 h-4 border-t-2 border-r-2 border-[#E5C88B]/65" />
        <div className="pointer-events-none absolute bottom-2.5 left-2.5 w-4 h-4 border-b-2 border-l-2 border-[#E5C88B]/65" />
        <div className="pointer-events-none absolute bottom-2.5 right-2.5 w-4 h-4 border-b-2 border-r-2 border-[#E5C88B]/65" />

        {/* Compact Top Safe Zone: Studio Crest + Sender Gift Strip */}
        <div className="relative z-10 flex flex-col items-center pt-3.5 px-4 text-center">
          <div className="flex items-center gap-2.5 scale-90 origin-top">
            <Logo />
          </div>
          {broadcast.studioTitle && broadcast.studioTitle !== 'NUR-I DUA' && (
            <p className="mt-0.5 text-[10px] tracking-[0.2em] text-[#E5C88B]/80 uppercase">
              {broadcast.studioTitle}
            </p>
          )}

          {/* Compact Animated Sender & Gift Banner (stays strictly in top ~14% zone) */}
          <div className="w-full mt-2 min-h-[42px]">
            <AnimatePresence mode="wait">
              {showActiveCard && activeEvent && broadcast.showSenderCard && (
                <motion.div
                  key={activeEvent.id}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="mx-auto max-w-[94%] bg-[#070E20]/82 border border-[#C9A45C]/55 px-3.5 py-1.5 flex items-center justify-between gap-2 shadow-md"
                >
                  <div className="min-w-0 text-left">
                    <p className="text-[9px] tracking-[0.16em] uppercase text-[#D4B26A] leading-tight">
                      Dua Niyeti
                    </p>
                    <p className="font-display text-base sm:text-lg font-semibold text-white truncate leading-tight">
                      {activeEvent.displayUsername}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] font-semibold text-[#E5C88B] leading-tight">
                      {activeEvent.giftName} × {activeEvent.quantity}
                    </p>
                    <p className="text-[10px] text-slate-300 leading-tight">
                      {categoryMeta?.labelTr || activeEvent.category}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Compact Bottom Safe Zone: Refined Semi-Transparent Dark Prayer Panel */}
        <div className="absolute inset-x-0 bottom-3.5 z-10 px-4 flex flex-col items-center gap-1.5">
          {broadcast.showScholarNames && (
            <div className="w-full flex items-center justify-between px-1.5 text-[10px] sm:text-[11px]">
              <div
                className={`transition-all duration-300 px-2 py-0.5 border-b ${
                  activeScholarId === 'scholar_1' && speakingState === 'speaking'
                    ? 'text-[#E5C88B] font-semibold border-[#E5C88B]'
                    : 'text-slate-300/80 border-transparent'
                }`}
              >
                {scholars.profiles.scholar_1.name}
              </div>
              <div
                className={`transition-all duration-300 px-2 py-0.5 border-b text-right ${
                  activeScholarId === 'scholar_2' && speakingState === 'speaking'
                    ? 'text-[#E5C88B] font-semibold border-[#E5C88B]'
                    : 'text-slate-300/80 border-transparent'
                }`}
              >
                {scholars.profiles.scholar_2.name}
              </div>
            </div>
          )}

          <AnimatePresence mode="wait">
            {showActiveCard && activeEvent && broadcast.showPrayerText ? (
              <motion.div
                key={`prayer-${activeEvent.id}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                className="w-full bg-[#060C1D]/78 border border-[#C9A45C]/45 px-3.5 py-2.5 text-center"
              >
                <div className="flex items-center justify-center gap-1.5 text-[10px] text-[#E5C88B] tracking-[0.12em] uppercase">
                  <span className="truncate">{activeScholarProfile.name}</span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{activeEvent.prayerTitle}</span>
                </div>
                {broadcast.goldAnimationsEnabled && (
                  <div className="my-1.5 mx-auto h-px w-20 gold-shimmer-line" />
                )}
                <p className="font-display text-[15px] sm:text-[17px] leading-[1.32] text-[#F8FAFC] font-medium line-clamp-4">
                  {activeEvent.renderedPrayer}
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="idle-banner"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full bg-[#060C1D]/70 border border-[#C9A45C]/25 px-3.5 py-2 text-center"
              >
                <p className="font-display text-sm sm:text-base text-[#E5C88B] leading-tight">
                  Hayırlı ve Huzurlu Yayınlar · Dua için hazır
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
