import React, { useMemo, useState } from 'react';
import { Download, RotateCcw, Trash2 } from 'lucide-react';
import { useStudio } from '../../context/StudioContext';

export const HistoryPage: React.FC = () => {
  const { state, retryQueueItem, clearHistory } = useStudio();
  const [sourceFilter, setSourceFilter] = useState<'all' | 'simulation' | 'real'>('all');
  const [search, setSearch] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.history.filter((h) => {
      if (sourceFilter !== 'all' && h.source !== sourceFilter) return false;
      if (!q) return true;
      return (
        h.username.toLowerCase().includes(q) ||
        h.giftName.toLowerCase().includes(q) ||
        h.renderedPrayer.toLowerCase().includes(q)
      );
    });
  }, [state.history, sourceFilter, search]);

  const handleExportCsv = () => {
    const header = 'id,source,username,gift,quantity,category,scholar,status,createdAt,completedAt\n';
    const rows = filtered
      .map((item) =>
        [
          item.id,
          item.source,
          `"${item.username}"`,
          `"${item.giftName}"`,
          item.quantity,
          item.category,
          item.scholarId,
          item.status,
          item.createdAt,
          item.completedAt || '',
        ].join(',')
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nur-i-dua-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-[#1A2B54] pb-5">
        <div>
          <p className="text-xs text-[#D4B26A] font-medium tracking-[0.14em] uppercase">
            Audit Log
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-white">
            Event History
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Completed and cancelled prayer broadcasts with clear separation between simulated and real events.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={filtered.length === 0}
            onClick={handleExportCsv}
            className="inline-flex items-center gap-2 bg-[#13234B] disabled:opacity-40 hover:bg-[#1B3166] border border-[#29437F] text-white text-xs px-3.5 py-2.5 cursor-pointer disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5 text-[#E5C88B]" />
            <span>Export CSV</span>
          </button>

          {state.history.length > 0 && (
            confirmClear ? (
              <div className="inline-flex items-center gap-2 bg-[#2B1822] border border-rose-500/40 px-3 py-2 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    clearHistory();
                    setConfirmClear(false);
                  }}
                  className="text-rose-300 font-semibold cursor-pointer"
                >
                  Confirm Clear
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-2 bg-[#2B1822] hover:bg-[#3B202E] border border-rose-500/40 text-rose-200 text-xs px-3.5 py-2.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear History</span>
              </button>
            )
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search username, gift, or prayer..."
          className="flex-1 bg-[#0B142B] border border-[#1E3361] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
        />
        <div className="flex items-center gap-1 p-1 bg-[#0B142B] border border-[#1E3361]">
          {(['all', 'simulation', 'real'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setSourceFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                sourceFilter === tab
                  ? 'bg-[#C9A45C] text-[#070D1B]'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {tab === 'all' ? 'All Events' : tab === 'simulation' ? 'Simulations' : 'Real LIVE'}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-[#0B142B] border border-[#1B2D58] p-12 text-center">
          <p className="font-display text-2xl text-white">No Recorded Events</p>
          <p className="mt-1 text-sm text-slate-400">
            Completed prayer broadcasts will be archived here automatically.
          </p>
        </div>
      ) : (
        <div className="bg-[#0B142B] border border-[#1B2D58] overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#1A2B54] text-slate-400">
                <th className="py-3 px-4 font-medium">Event ID</th>
                <th className="py-3 px-4 font-medium">Source</th>
                <th className="py-3 px-4 font-medium">Sender &amp; Gift</th>
                <th className="py-3 px-4 font-medium">Scholar</th>
                <th className="py-3 px-4 font-medium">Rendered Prayer</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#16254A]">
              {filtered.map((item) => (
                <tr key={item.id} className="hover:bg-[#101C3A]/60">
                  <td className="py-3 px-4 font-mono-tabular text-slate-400 whitespace-nowrap">
                    {item.id}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span className={item.source === 'simulation' ? 'text-amber-300' : 'text-emerald-300'}>
                      {item.source === 'simulation' ? 'Simulation' : 'Real'}
                    </span>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <p className="text-white font-medium">{item.displayUsername}</p>
                    <p className="text-slate-400">
                      {item.giftName} × {item.quantity}
                    </p>
                  </td>
                  <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                    {state.scholars.profiles[item.scholarId].name}
                  </td>
                  <td className="py-3 px-4 text-slate-300 max-w-md">
                    <p className="line-clamp-2">{item.renderedPrayer}</p>
                  </td>
                  <td className="py-3 px-4 font-mono-tabular whitespace-nowrap">
                    <span
                      className={
                        item.status === 'completed'
                          ? 'text-emerald-400'
                          : 'text-slate-400'
                      }
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => retryQueueItem(item.id)}
                      className="inline-flex items-center gap-1 text-[#E5C88B] hover:underline cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Re-queue</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
