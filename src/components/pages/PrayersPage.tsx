import React, { useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, Volume2, Shuffle, Eye, Check, X } from 'lucide-react';
import { PRAYER_CATEGORIES } from '../../data/defaults';
import { useStudio } from '../../context/StudioContext';
import { PrayerCategoryId, PrayerTemplate } from '../../types/nuridua';
import { renderPersonalizedPrayer } from '../../utils/sanitize';

export const PrayersPage: React.FC = () => {
  const {
    state,
    addPrayer,
    updatePrayer,
    deletePrayer,
    togglePrayerActive,
    pickRandomPrayer,
    testVoicePlayback,
  } = useStudio();

  const [selectedCategory, setSelectedCategory] = useState<'all' | PrayerCategoryId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewName, setPreviewName] = useState('Ahmet');
  const [randomResult, setRandomResult] = useState<PrayerTemplate | null>(null);

  // Add / Edit modal state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formCategory, setFormCategory] = useState<PrayerCategoryId>('general_blessings');
  const [formTemplate, setFormTemplate] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filteredPrayers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return state.prayers.filter((p) => {
      if (selectedCategory !== 'all' && p.category !== selectedCategory) return false;
      if (!q) return true;
      return p.title.toLowerCase().includes(q) || p.template.toLowerCase().includes(q);
    });
  }, [state.prayers, selectedCategory, searchQuery]);

  const openAddForm = () => {
    setEditingId(null);
    setFormTitle('');
    setFormCategory(selectedCategory === 'all' ? 'general_blessings' : selectedCategory);
    setFormTemplate(
      "Allah'ım, {isim} kardeşimize sağlık, huzur, bereket ve hayırlı bir ömür nasip eyle. Âmin."
    );
    setFormActive(true);
    setFormError(null);
    setShowForm(true);
  };

  const openEditForm = (prayer: PrayerTemplate) => {
    setEditingId(prayer.id);
    setFormTitle(prayer.title);
    setFormCategory(prayer.category);
    setFormTemplate(prayer.template);
    setFormActive(prayer.isActive);
    setFormError(null);
    setShowForm(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      setFormError('Please enter a prayer title.');
      return;
    }
    if (!formTemplate.trim() || formTemplate.trim().length < 15) {
      setFormError('Prayer text must be at least 15 characters.');
      return;
    }
    if (editingId) {
      updatePrayer(editingId, {
        title: formTitle,
        category: formCategory,
        template: formTemplate,
        isActive: formActive,
      });
    } else {
      addPrayer({
        title: formTitle,
        category: formCategory,
        template: formTemplate,
        isActive: formActive,
      });
    }
    setShowForm(false);
  };

  const handleRandomTest = () => {
    const targetCat = selectedCategory === 'all' ? 'general_blessings' : selectedCategory;
    const picked = pickRandomPrayer(targetCat);
    setRandomResult(picked);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-[#1A2B54] pb-5">
        <div>
          <p className="text-xs text-[#D4B26A] font-medium tracking-[0.14em] uppercase">
            Prayer Engine
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-white">
            Turkish Prayer Library
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage personalized <code className="font-mono text-[#E5C88B]">{'{isim}'}</code> supplications across 8 categories. Never attributes invented text to sacred sources.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleRandomTest}
            className="inline-flex items-center gap-2 bg-[#112046] hover:bg-[#182C5E] border border-[#28427D] text-slate-100 text-xs sm:text-sm px-4 py-2.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Shuffle className="w-4 h-4 text-[#E5C88B]" />
            <span>Test Random Pick</span>
          </button>
          <button
            type="button"
            onClick={openAddForm}
            className="inline-flex items-center gap-2 bg-[#C9A45C] hover:bg-[#D7B46E] text-[#070D1B] font-semibold text-xs sm:text-sm px-4 py-2.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Prayer</span>
          </button>
        </div>
      </div>

      {/* Category Filter + Preview Name Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 flex flex-col sm:flex-row gap-3">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search prayer title or Turkish text..."
            className="flex-1 bg-[#0B142B] border border-[#1E3361] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
          />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as 'all' | PrayerCategoryId)}
            aria-label="Filter by prayer category"
            className="bg-[#0B142B] border border-[#1E3361] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
          >
            <option value="all">All 8 Categories ({state.prayers.length})</option>
            {PRAYER_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.labelTr} ({c.labelEn})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 bg-[#0B142B] border border-[#1E3361] px-3.5 py-2">
          <Eye className="w-4 h-4 text-[#D4B26A] shrink-0" />
          <label htmlFor="preview-isim" className="text-xs text-slate-400 whitespace-nowrap">
            Preview {'{isim}'}:
          </label>
          <input
            id="preview-isim"
            type="text"
            value={previewName}
            onChange={(e) => setPreviewName(e.target.value)}
            className="flex-1 min-w-0 bg-transparent text-sm text-white focus:outline-none"
          />
        </div>
      </div>

      {/* Random Selection Result Banner */}
      {randomResult && (
        <div className="bg-[#0F1B3A] border border-[#C9A45C]/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs text-[#E5C88B]">
              Random Active Draw · {randomResult.title}
            </p>
            <p className="mt-1 font-display text-lg text-white">
              {renderPersonalizedPrayer(randomResult.template, previewName)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                testVoicePlayback(renderPersonalizedPrayer(randomResult.template, previewName))
              }
              className="inline-flex items-center gap-1.5 bg-[#C9A45C] text-[#070D1B] font-semibold text-xs px-3 py-2 cursor-pointer"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>Speak</span>
            </button>
            <button
              type="button"
              onClick={() => setRandomResult(null)}
              className="text-xs text-slate-400 hover:text-white px-2 py-2 cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Add / Edit Modal Form */}
      {showForm && (
        <form
          onSubmit={handleSave}
          className="bg-[#0D1732] border border-[#C9A45C]/55 p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl text-white">
              {editingId ? 'Edit Prayer Template' : 'New Prayer Template'}
            </h2>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-slate-400 hover:text-white p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="prayer-title" className="block text-xs text-slate-300 mb-1.5">
                Prayer Title
              </label>
              <input
                id="prayer-title"
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="e.g. Şifa ve Huzur Duası"
                className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
              />
            </div>

            <div>
              <label htmlFor="prayer-cat" className="block text-xs text-slate-300 mb-1.5">
                Category
              </label>
              <select
                id="prayer-cat"
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value as PrayerCategoryId)}
                className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
              >
                {PRAYER_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.labelTr} — {c.labelEn}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="prayer-body" className="text-xs text-slate-300">
                Turkish Prayer Text (use {'{isim}'} for donor personalization)
              </label>
              <button
                type="button"
                onClick={() => setFormTemplate((t) => `${t} {isim}`.trim())}
                className="text-xs text-[#E5C88B] hover:underline cursor-pointer"
              >
                Insert {'{isim}'}
              </button>
            </div>
            <textarea
              id="prayer-body"
              rows={3}
              value={formTemplate}
              onChange={(e) => setFormTemplate(e.target.value)}
              className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
            />
            <p className="mt-2 text-xs text-slate-400">
              Live Preview:{' '}
              <span className="text-slate-200">
                {renderPersonalizedPrayer(formTemplate || '...', previewName)}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <label className="inline-flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={formActive}
                onChange={(e) => setFormActive(e.target.checked)}
                className="accent-[#C9A45C] w-4 h-4"
              />
              <span>Active in random selection pool</span>
            </label>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white border border-[#233969] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-xs font-semibold bg-[#C9A45C] hover:bg-[#D7B46E] text-[#070D1B] cursor-pointer"
              >
                Save Prayer
              </button>
            </div>
          </div>

          {formError && <p className="text-xs text-rose-400">{formError}</p>}
        </form>
      )}

      {/* Prayer Cards List */}
      {filteredPrayers.length === 0 ? (
        <div className="bg-[#0B142B] border border-[#1B2D58] p-10 text-center">
          <p className="font-display text-xl text-white">No Prayers Match Filter</p>
          <p className="mt-1 text-sm text-slate-400">
            Clear your search or add a new Turkish prayer template for this category.
          </p>
          <button
            type="button"
            onClick={openAddForm}
            className="mt-4 bg-[#C9A45C] text-[#070D1B] font-semibold text-xs px-4 py-2 cursor-pointer"
          >
            Create Prayer Template
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredPrayers.map((prayer) => {
            const cat = PRAYER_CATEGORIES.find((c) => c.id === prayer.category);
            const personalized = renderPersonalizedPrayer(prayer.template, previewName);
            return (
              <div
                key={prayer.id}
                className={`bg-[#0B142B] border p-5 flex flex-col justify-between transition-colors ${
                  prayer.isActive ? 'border-[#1E3361]' : 'border-[#162241] opacity-75'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-[#D4B26A]">
                        {cat?.labelTr} · {cat?.labelEn}
                      </p>
                      <h3 className="mt-1 font-display text-xl font-semibold text-white">
                        {prayer.title}
                      </h3>
                    </div>

                    <button
                      type="button"
                      onClick={() => togglePrayerActive(prayer.id)}
                      className={`text-xs font-medium px-2.5 py-1 border shrink-0 cursor-pointer ${
                        prayer.isActive
                          ? 'border-emerald-500/40 text-emerald-300 bg-emerald-950/30'
                          : 'border-slate-600 text-slate-400 bg-slate-900/40'
                      }`}
                    >
                      {prayer.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </div>

                  <p className="mt-3 text-sm text-slate-200 leading-relaxed">{personalized}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-[#16254A] flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => testVoicePlayback(personalized)}
                    className="inline-flex items-center gap-1.5 text-xs text-[#E5C88B] hover:text-white py-1 cursor-pointer"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Preview Voice</span>
                  </button>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => openEditForm(prayer)}
                      className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-white py-1 cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>

                    {confirmDeleteId === prayer.id ? (
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            deletePrayer(prayer.id);
                            setConfirmDeleteId(null);
                          }}
                          className="inline-flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Confirm</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs text-slate-400 hover:text-white cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(prayer.id)}
                        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-400 py-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
