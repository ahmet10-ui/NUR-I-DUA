/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  BookOpen,
  Gift,
  Video,
  Users,
  Volume2,
  ListOrdered,
  History,
  Radio,
  Settings,
  Menu,
  X,
  ArrowLeft,
} from 'lucide-react';
import { StudioProvider, useStudio } from './context/StudioContext';
import { AdminSectionId } from './types/nuridua';
import { getTikTokStateLabel } from './services/tiktokLiveConnectorService';
import { Logo } from './components/Logo';
import { LoginScreen } from './components/LoginScreen';
import { BroadcastView } from './components/BroadcastView';
import { OverviewPage } from './components/pages/OverviewPage';
import { PrayersPage } from './components/pages/PrayersPage';
import { GiftsPage } from './components/pages/GiftsPage';
import { LiveStudioPage } from './components/pages/LiveStudioPage';
import { ScholarsPage } from './components/pages/ScholarsPage';
import { VoicePage } from './components/pages/VoicePage';
import { QueuePage } from './components/pages/QueuePage';
import { HistoryPage } from './components/pages/HistoryPage';
import { TikTokPage } from './components/pages/TikTokPage';
import { SettingsPage } from './components/pages/SettingsPage';

interface NavItem {
  id: AdminSectionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'prayers', label: 'Prayer Library', icon: BookOpen },
  { id: 'gifts', label: 'Gift Management', icon: Gift },
  { id: 'studio', label: 'Live Studio', icon: Video },
  { id: 'scholars', label: 'Scholar Settings', icon: Users },
  { id: 'voice', label: 'Voice Settings', icon: Volume2 },
  { id: 'queue', label: 'Event Queue', icon: ListOrdered },
  { id: 'history', label: 'Event History', icon: History },
  { id: 'tiktok', label: 'TikTok Connection', icon: Radio },
  { id: 'settings', label: 'General Settings', icon: Settings },
];

function isBroadcastRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('view') === 'broadcast' || window.location.pathname === '/broadcast';
}

const AdminShell: React.FC<{
  onOpenStandaloneBroadcast: () => void;
  onSignOut: () => void;
}> = ({ onOpenStandaloneBroadcast, onSignOut }) => {
  const { state, activeEvent } = useStudio();
  const [section, setSection] = useState<AdminSectionId>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const pendingQueueCount = state.queue.filter(
    (q) => q.status === 'pending' || q.status === 'speaking'
  ).length;

  const handleSelectSection = (id: AdminSectionId) => {
    setSection(id);
    setMobileNavOpen(false);
  };

  const renderSection = () => {
    switch (section) {
      case 'overview':
        return (
          <OverviewPage
            onNavigate={setSection}
            onOpenStandaloneBroadcast={onOpenStandaloneBroadcast}
          />
        );
      case 'prayers':
        return <PrayersPage />;
      case 'gifts':
        return <GiftsPage />;
      case 'studio':
        return <LiveStudioPage onOpenStandaloneBroadcast={onOpenStandaloneBroadcast} />;
      case 'scholars':
        return <ScholarsPage />;
      case 'voice':
        return <VoicePage />;
      case 'queue':
        return <QueuePage />;
      case 'history':
        return <HistoryPage />;
      case 'tiktok':
        return <TikTokPage />;
      case 'settings':
        return <SettingsPage onSignOut={onSignOut} />;
      default:
        return (
          <OverviewPage
            onNavigate={setSection}
            onOpenStandaloneBroadcast={onOpenStandaloneBroadcast}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#060B17] text-[#F4F6FA] flex flex-col lg:flex-row">
      {/* Mobile Header Bar (<= 15% viewport cap) */}
      <header className="lg:hidden sticky top-0 z-30 bg-[#080F22] border-b border-[#1A2B54] px-4 h-14 flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono-tabular text-[#E5C88B]">
            Queue {pendingQueueCount}
          </span>
          <button
            type="button"
            onClick={() => setMobileNavOpen((prev) => !prev)}
            aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="w-11 h-11 inline-flex items-center justify-center border border-[#233969] bg-[#0D1733] text-white cursor-pointer"
          >
            {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile Drawer Backdrop */}
      {mobileNavOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/65"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Sidebar Navigation (Desktop fixed, Mobile slide-over) */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 h-screen w-64 shrink-0 bg-[#080F22] border-r border-[#1A2B54] flex flex-col justify-between transition-transform duration-200 lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col min-h-0 flex-1">
          <div className="h-16 px-5 border-b border-[#1A2B54] flex items-center justify-between shrink-0">
            <Logo />
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="lg:hidden text-slate-400 hover:text-white p-1 cursor-pointer"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav aria-label="Control Center Sections" className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectSection(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors text-left cursor-pointer ${
                    active
                      ? 'bg-[#12224B] text-[#E5C88B] border border-[#C9A45C]/40 font-medium'
                      : 'text-slate-300 hover:text-white hover:bg-[#0D1836] border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#E5C88B]' : 'text-slate-400'}`} />
                    <span className="truncate whitespace-nowrap">{item.label}</span>
                  </span>
                  {item.id === 'queue' && pendingQueueCount > 0 && (
                    <span className="font-mono-tabular text-xs text-[#E5C88B]">
                      {pendingQueueCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer Status */}
        <div className="p-4 border-t border-[#1A2B54] bg-[#070D1D] text-xs space-y-1.5 shrink-0">
          <div className="flex items-center justify-between text-slate-400">
            <span>TikTok LIVE</span>
            <span className="text-amber-400 font-mono-tabular">
              {getTikTokStateLabel(state.tiktok.connectionState)}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span>Playback</span>
            <span className="text-slate-200 truncate max-w-[120px]">
              {activeEvent ? activeEvent.displayUsername : state.queuePaused ? 'Paused' : 'Ready'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 islamic-lattice-bg">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {renderSection()}
        </div>
      </main>
    </div>
  );
};

export default function App() {
  const [standaloneBroadcast, setStandaloneBroadcast] = useState<boolean>(() => isBroadcastRoute());
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem('nur_i_dua_admin_auth') === 'demo-authenticated';
  });

  useEffect(() => {
    const onPopState = () => {
      setStandaloneBroadcast(isBroadcastRoute());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const enterStandaloneBroadcast = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'broadcast');
    window.history.pushState({}, '', url.toString());
    setStandaloneBroadcast(true);
  };

  const exitStandaloneBroadcast = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    if (url.pathname === '/broadcast') url.pathname = '/';
    window.history.pushState({}, '', url.toString());
    setStandaloneBroadcast(false);
  };

  const handleSignOut = () => {
    sessionStorage.removeItem('nur_i_dua_admin_auth');
    setIsAuthenticated(false);
  };

  // Dedicated OBS Browser Source / Clean Broadcast View (zero dashboard controls)
  if (standaloneBroadcast) {
    const obsClean =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('obs') === '1';
    return (
      <StudioProvider isBroadcastView>
        <div className="relative">
          <BroadcastView standalone />
          {!obsClean && (
            <button
              type="button"
              onClick={exitStandaloneBroadcast}
              className="fixed top-3 left-3 z-50 opacity-20 hover:opacity-100 focus:opacity-100 transition-opacity inline-flex items-center gap-1.5 bg-[#080F22]/90 border border-[#C9A45C]/40 px-3 py-1.5 text-xs text-[#E5C88B] cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Control Center</span>
            </button>
          )}
        </div>
      </StudioProvider>
    );
  }

  if (!isAuthenticated) {
    return (
      <LoginScreen
        onLoginSuccess={() => setIsAuthenticated(true)}
        onOpenBroadcastOnly={enterStandaloneBroadcast}
      />
    );
  }

  return (
    <StudioProvider>
      <AdminShell
        onOpenStandaloneBroadcast={enterStandaloneBroadcast}
        onSignOut={handleSignOut}
      />
    </StudioProvider>
  );
}
