import React, { useState } from 'react';
import { Download, Upload, RotateCcw, LogOut, Copy, Check } from 'lucide-react';
import { useStudio } from '../../context/StudioContext';

interface SettingsPageProps {
  onSignOut: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ onSignOut }) => {
  const { state, updateBroadcastConfig, resetAllDefaults, importStateJson } = useStudio();
  const { broadcast } = state;

  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const broadcastUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/?view=broadcast` : '/?view=broadcast';

  const handleCopyUrl = () => {
    navigator.clipboard?.writeText(broadcastUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleExportBackup = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nur-i-dua-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    if (!importText.trim()) return;
    const res = importStateJson(importText);
    if (res.ok) {
      setImportStatus('Backup restored successfully.');
      setImportText('');
    } else {
      setImportStatus(res.error || 'Import failed.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-[#1A2B54] pb-5">
        <p className="text-xs text-[#D4B26A] font-medium tracking-[0.14em] uppercase">
          System Configuration
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-white">
          General Settings
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Broadcast overlay presentation, local persistence backup, optional free-tier upgrade notes, and admin session.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Broadcast Display Options */}
        <div className="bg-[#0B142B] border border-[#1B2D58] p-5 space-y-4">
          <h2 className="text-base font-semibold text-white">Broadcast Overlay Appearance</h2>

          <div>
            <label htmlFor="studio-title" className="block text-xs text-slate-300 mb-1.5">
              Broadcast Header Title
            </label>
            <input
              id="studio-title"
              type="text"
              value={broadcast.studioTitle}
              onChange={(e) => updateBroadcastConfig({ studioTitle: e.target.value })}
              className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <label htmlFor="hold-sec" className="text-slate-300">
                Post-Speech Prayer Display Hold
              </label>
              <span className="font-mono-tabular text-[#E5C88B]">
                {broadcast.postSpeechHoldSec.toFixed(1)}s
              </span>
            </div>
            <input
              id="hold-sec"
              type="range"
              min={0.5}
              max={6.0}
              step={0.5}
              value={broadcast.postSpeechHoldSec}
              onChange={(e) =>
                updateBroadcastConfig({ postSpeechHoldSec: Number(e.target.value) })
              }
              className="w-full accent-[#C9A45C]"
            />
          </div>

          <div className="space-y-2.5 pt-2">
            <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={broadcast.showSenderCard}
                onChange={(e) => updateBroadcastConfig({ showSenderCard: e.target.checked })}
                className="accent-[#C9A45C] w-4 h-4"
              />
              <span>Show animated sender username &amp; gift card</span>
            </label>

            <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={broadcast.showPrayerText}
                onChange={(e) => updateBroadcastConfig({ showPrayerText: e.target.checked })}
                className="accent-[#C9A45C] w-4 h-4"
              />
              <span>Show Turkish prayer text lower-third overlay</span>
            </label>

            <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={broadcast.showScholarNames}
                onChange={(e) => updateBroadcastConfig({ showScholarNames: e.target.checked })}
                className="accent-[#C9A45C] w-4 h-4"
              />
              <span>Show scholar names above prayer overlay</span>
            </label>

            <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={broadcast.goldAnimationsEnabled}
                onChange={(e) =>
                  updateBroadcastConfig({ goldAnimationsEnabled: e.target.checked })
                }
                className="accent-[#C9A45C] w-4 h-4"
              />
              <span>Enable subtle gold shimmer dividers</span>
            </label>
          </div>

          <div className="pt-3 border-t border-[#16254A]">
            <p className="text-xs text-slate-400 mb-1.5">Dedicated OBS Browser Source URL</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={broadcastUrl}
                className="flex-1 min-w-0 bg-[#070E1F] border border-[#233969] px-3 py-2 text-xs font-mono text-slate-300"
              />
              <button
                type="button"
                onClick={handleCopyUrl}
                className="inline-flex items-center gap-1.5 bg-[#13234B] border border-[#29437F] px-3 py-2 text-xs text-white cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Persistence, Backup, Optional Upgrade & Session */}
        <div className="space-y-6">
          <div className="bg-[#0B142B] border border-[#1B2D58] p-5 space-y-4">
            <h2 className="text-base font-semibold text-white">Local Persistence &amp; Backup</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Prayers, gift rules, scholar tuning, and queue history persist locally in your browser and the studio server JSON store—requiring zero paid cloud databases.
            </p>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleExportBackup}
                className="inline-flex items-center gap-2 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] text-white text-xs px-4 py-2.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#E5C88B]" />
                <span>Export JSON Backup</span>
              </button>

              {confirmReset ? (
                <div className="inline-flex items-center gap-2 bg-[#2B1822] border border-rose-500/40 px-3 py-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      resetAllDefaults();
                      setConfirmReset(false);
                    }}
                    className="text-rose-300 font-semibold cursor-pointer"
                  >
                    Confirm Reset All
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    className="text-slate-300 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="inline-flex items-center gap-2 bg-[#2B1822] hover:bg-[#3B202E] border border-rose-500/40 text-rose-200 text-xs px-4 py-2.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset to Defaults</span>
                </button>
              )}
            </div>

            <div className="pt-2 border-t border-[#16254A] space-y-2">
              <label htmlFor="import-json" className="block text-xs text-slate-300">
                Restore from Backup JSON
              </label>
              <textarea
                id="import-json"
                rows={2}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="Paste exported JSON backup here..."
                className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-xs font-mono text-white"
              />
              <button
                type="button"
                onClick={handleImport}
                className="inline-flex items-center gap-2 bg-[#112046] hover:bg-[#182C5E] border border-[#28427D] text-xs text-white px-3.5 py-2 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-[#E5C88B]" />
                <span>Restore Backup</span>
              </button>
              {importStatus && <p className="text-xs text-[#E5C88B]">{importStatus}</p>}
            </div>
          </div>

          <div className="bg-[#0B142B] border border-[#1B2D58] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Admin Session (Demo Auth)</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Signed in locally as {sessionStorage.getItem('nur_i_dua_operator') || 'Studio Admin'}.
              </p>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-2 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] text-white text-xs px-4 py-2.5 shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5 text-[#E5C88B]" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
