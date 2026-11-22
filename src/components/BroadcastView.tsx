import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStudio } from '../context/StudioContext';
import {
  formatBroadcastPrayerNotification,
  getActiveTopTierId,
  TOP_TIER_BAR_GRID_COLUMNS,
  TOP_TIER_BAR_ITEMS,
} from '../services/broadcastDisplay';
import { MosqueViewport } from './MosqueViewport';

interface BroadcastViewProps {
  standalone?: boolean;
}

export const BroadcastView: React.FC<BroadcastViewProps> = ({ standalone = false }) => {
  const { state, activeEvent, speakingState, playbackStarted } = useStudio();
  const { broadcast, scholars } = state;

  const activeScholarId = activeEvent?.scholarId || scholars.currentSpeaker;
  const isActivelyPlaying = Boolean(activeEvent && playbackStarted && speakingState === 'speaking');
  const activeTierId = getActiveTopTierId(activeEvent, isActivelyPlaying);
  const notificationText = formatBroadcastPrayerNotification(activeEvent, isActivelyPlaying);
  const brandTitle = (broadcast.studioTitle || '').trim() || 'NUR-I DUA';

  return (
    <div
      className={
        standalone
          ? 'fixed inset-0 bg-[#090706] flex items-center justify-center overflow-hidden'
          : 'w-full h-full flex items-center justify-center'
      }
    >
      {/* 1080x1920 (9:16) Vertical Broadcast Frame */}
      <div
        data-testid="broadcast-frame-9-16"
        className={`relative aspect-[9/16] bg-[#0B0908] overflow-hidden shadow-2xl border border-[#C9A45C]/30 ${
          standalone
            ? 'w-[min(100vw,calc(100dvh*9/16))] h-[min(100dvh,calc(100vw*16/9))]'
            : 'w-full h-full max-h-full'
        }`}
      >
        {/* 3D Ottoman Mosque & Two Animated Scholars (Absolute Layer 0 — never pushes flow) */}
        <div className="absolute inset-0 z-0 overflow-hidden">
          <MosqueViewport cameraPreset={broadcast.cameraPreset} className="absolute inset-0" />
        </div>

        {/* Subtle Edge Scrims */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-28"
          style={{
            background:
              'linear-gradient(0deg, rgba(12,9,7,0.86) 0%, rgba(12,9,7,0.38) 58%, rgba(12,9,7,0) 100%)',
          }}
        />

        {/* Delicate Gold Corner Filigree */}
        <div className="pointer-events-none absolute inset-2 z-10 border border-[#C9A45C]/15" />
        <div className="pointer-events-none absolute top-2 left-2 z-10 w-3.5 h-3.5 border-t-2 border-l-2 border-[#E5C88B]/60" />
        <div className="pointer-events-none absolute top-2 right-2 z-10 w-3.5 h-3.5 border-t-2 border-r-2 border-[#E5C88B]/60" />
        <div className="pointer-events-none absolute bottom-2 left-2 z-10 w-3.5 h-3.5 border-b-2 border-l-2 border-[#E5C88B]/60" />
        <div className="pointer-events-none absolute bottom-2 right-2 z-10 w-3.5 h-3.5 border-b-2 border-r-2 border-[#E5C88B]/60" />

        {/* Fixed Compact Top Coin-Tier Bar (Pinned Top Overlay z-30 · Never Clipped Off-Screen) */}
        <header
          data-testid="broadcast-top-tier-bar"
          className="absolute top-0 inset-x-0 z-30 w-full bg-[#120D0A]/94 border-b border-[#C9A45C]/50 shadow-md"
          style={
            standalone
              ? { paddingTop: 'env(safe-area-inset-top, 0px)' }
              : undefined
          }
        >
          <div className="px-3 pt-1 pb-0.5 flex items-center justify-center">
            <span className="font-display text-[10px] tracking-[0.22em] font-semibold text-[#E5C88B]/90 uppercase truncate">
              {brandTitle}
            </span>
          </div>

          <div
            className="grid gap-1 px-2 pb-1.5 w-full"
            style={{ gridTemplateColumns: TOP_TIER_BAR_GRID_COLUMNS }}
          >
            {TOP_TIER_BAR_ITEMS.map((item) => {
              const isHighlighted = activeTierId === item.tier;
              return (
                <div
                  key={item.tier}
                  data-tier={item.tier}
                  className={`min-w-0 overflow-hidden px-1 py-1 text-center border transition-colors duration-300 ${
                    isHighlighted
                      ? 'bg-[#2C1F14] border-[#E5C88B] shadow-[0_0_10px_rgba(229,200,139,0.22)]'
                      : 'bg-[#1A120D]/95 border-[#C9A45C]/30'
                  }`}
                >
                  <p className="text-[10px] sm:text-[11px] font-bold leading-tight text-[#F3D999] whitespace-nowrap">
                    {item.range}
                  </p>
                  <p className="mt-0.5 text-[8.5px] sm:text-[9.5px] leading-tight text-[#F6F0E4] truncate">
                    {item.label}
                  </p>
                </div>
              );
            })}
          </div>
        </header>

        {/* Bottom Safe Zone: Compact Prayer Notification Card (Only When Audio Actually Starts) */}
        <div className="absolute inset-x-0 bottom-3 z-30 px-3 flex flex-col items-center gap-1.5 pointer-events-none">
          {broadcast.showScholarNames && (
            <div className="w-full flex items-center justify-between px-1 text-[10px]">
              <div
                className={`transition-colors duration-300 px-2 py-0.5 border-b ${
                  activeScholarId === 'scholar_1' && isActivelyPlaying
                    ? 'text-[#E5C88B] font-semibold border-[#E5C88B]'
                    : 'text-[#E7DFD1]/75 border-transparent'
                }`}
              >
                {scholars.profiles.scholar_1.name}
              </div>
              <div
                className={`transition-colors duration-300 px-2 py-0.5 border-b text-right ${
                  activeScholarId === 'scholar_2' && isActivelyPlaying
                    ? 'text-[#E5C88B] font-semibold border-[#E5C88B]'
                    : 'text-[#E7DFD1]/75 border-transparent'
                }`}
              >
                {scholars.profiles.scholar_2.name}
              </div>
            </div>
          )}

          <AnimatePresence mode="wait">
            {notificationText && (
              <motion.div
                key={`${activeEvent?.id || 'notice'}:${notificationText}`}
                data-testid="broadcast-prayer-notification"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="w-full max-w-[96%] bg-[#120D0A]/92 border border-[#C9A45C]/60 px-3.5 py-2 text-center shadow-lg"
              >
                <p className="font-display text-[13px] sm:text-[14px] font-medium leading-snug text-[#FAF5EC] line-clamp-2">
                  {notificationText}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
