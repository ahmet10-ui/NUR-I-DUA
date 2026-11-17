import React, { useState } from 'react';
import { Plus, Edit2, Trash2, Coffee, X, Check } from 'lucide-react';
import { PRAYER_CATEGORIES } from '../../data/defaults';
import { useStudio } from '../../context/StudioContext';
import { GiftPriority, GiftRule, PrayerCategoryId } from '../../types/nuridua';

export const GiftsPage: React.FC = () => {
  const { state, addGift, updateGift, deleteGift, toggleGiftEnabled, enqueueGiftEvent } = useStudio();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [tiktokGiftId, setTiktokGiftId] = useState('');
  const [category, setCategory] = useState<PrayerCategoryId>('general_blessings');
  const [quantityMultiplier, setQuantityMultiplier] = useState(1);
  const [repeatPerQuantity, setRepeatPerQuantity] = useState(false);
  const [priority, setPriority] = useState<GiftPriority>('normal');
  const [minCoins, setMinCoins] = useState(1);
  const [enabled, setEnabled] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const openNew = () => {
    setEditingId(null);
    setName('');
    setTiktokGiftId('');
    setCategory('general_blessings');
    setQuantityMultiplier(1);
    setRepeatPerQuantity(false);
    setPriority('normal');
    setMinCoins(1);
    setEnabled(true);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (g: GiftRule) => {
    setEditingId(g.id);
    setName(g.name);
    setTiktokGiftId(g.tiktokGiftId);
    setCategory(g.category);
    setQuantityMultiplier(g.quantityMultiplier);
    setRepeatPerQuantity(g.repeatPerQuantity);
    setPriority(g.priority);
    setMinCoins(g.minCoins);
    setEnabled(g.enabled);
    setFormError(null);
    setShowForm(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Gift name is required.');
      return;
    }
    if (editingId) {
      updateGift(editingId, {
        name,
        tiktokGiftId: tiktokGiftId || name.toLowerCase().replace(/\s+/g, '_'),
        category,
        quantityMultiplier,
        repeatPerQuantity,
        priority,
        minCoins,
        enabled,
      });
    } else {
      addGift({
        name,
        tiktokGiftId: tiktokGiftId || name.toLowerCase().replace(/\s+/g, '_'),
        category,
        quantityMultiplier,
        repeatPerQuantity,
        priority,
        minCoins,
        enabled,
      });
    }
    setShowForm(false);
  };

  const handleTestGift = (g: GiftRule) => {
    const res = enqueueGiftEvent({
      source: 'simulation',
      giftIdOrName: g.id,
      quantity: 1,
    });
    setNotice(
      res.ok && res.event
        ? `Simulated "${g.name}" queued for ${res.event.displayUsername}.`
        : res.reason || 'Could not simulate gift.'
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-[#1A2B54] pb-5">
        <div>
          <p className="text-xs text-[#D4B26A] font-medium tracking-[0.14em] uppercase">
            Gift Rules
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-white">
            Gift Management
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Map incoming gifts (starting with Çay) to prayer categories, priorities, and quantity rules.
          </p>
        </div>

        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 bg-[#C9A45C] hover:bg-[#D7B46E] text-[#070D1B] font-semibold text-xs sm:text-sm px-4 py-2.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add Gift Rule</span>
        </button>
      </div>

      {notice && (
        <div className="bg-[#101D3D] border border-[#C9A45C]/40 px-4 py-3 text-sm text-[#F4E3BD] flex items-center justify-between gap-4">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs text-slate-400 hover:text-white cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleSave}
          className="bg-[#0D1732] border border-[#C9A45C]/55 p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl text-white">
              {editingId ? 'Edit Gift Rule' : 'New Gift Rule'}
            </h2>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-slate-400 hover:text-white p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label htmlFor="gift-name" className="block text-xs text-slate-300 mb-1.5">
                Gift Name
              </label>
              <input
                id="gift-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Çay, Gül, Kalp"
                className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
              />
            </div>

            <div>
              <label htmlFor="gift-id" className="block text-xs text-slate-300 mb-1.5">
                TikTok Gift Key
              </label>
              <input
                id="gift-id"
                type="text"
                value={tiktokGiftId}
                onChange={(e) => setTiktokGiftId(e.target.value)}
                placeholder="e.g. cay"
                className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-[#C9A45C]"
              />
            </div>

            <div>
              <label htmlFor="gift-category" className="block text-xs text-slate-300 mb-1.5">
                Assigned Prayer Category
              </label>
              <select
                id="gift-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as PrayerCategoryId)}
                className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
              >
                {PRAYER_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.labelTr}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="gift-priority" className="block text-xs text-slate-300 mb-1.5">
                Queue Priority
              </label>
              <select
                id="gift-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as GiftPriority)}
                className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <div>
              <label htmlFor="gift-mult" className="block text-xs text-slate-300 mb-1.5">
                Quantity Multiplier
              </label>
              <input
                id="gift-mult"
                type="number"
                min={1}
                max={20}
                value={quantityMultiplier}
                onChange={(e) => setQuantityMultiplier(Math.max(1, Number(e.target.value) || 1))}
                className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm font-mono-tabular text-white focus:outline-none focus:border-[#C9A45C]"
              />
            </div>

            <div>
              <label htmlFor="gift-coins" className="block text-xs text-slate-300 mb-1.5">
                Minimum Coin Value
              </label>
              <input
                id="gift-coins"
                type="number"
                min={1}
                value={minCoins}
                onChange={(e) => setMinCoins(Math.max(1, Number(e.target.value) || 1))}
                className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm font-mono-tabular text-white focus:outline-none focus:border-[#C9A45C]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <div className="flex flex-wrap items-center gap-6">
              <label className="inline-flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="accent-[#C9A45C] w-4 h-4"
                />
                <span>Rule Enabled</span>
              </label>

              <label className="inline-flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={repeatPerQuantity}
                  onChange={(e) => setRepeatPerQuantity(e.target.checked)}
                  className="accent-[#C9A45C] w-4 h-4"
                />
                <span>Queue separate prayer per gift unit</span>
              </label>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-xs font-medium text-slate-300 border border-[#233969] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-xs font-semibold bg-[#C9A45C] hover:bg-[#D7B46E] text-[#070D1B] cursor-pointer"
              >
                Save Gift Rule
              </button>
            </div>
          </div>

          {formError && <p className="text-xs text-rose-400">{formError}</p>}
        </form>
      )}

      {/* Gifts List */}
      {state.gifts.length === 0 ? (
        <div className="bg-[#0B142B] border border-[#1B2D58] p-10 text-center">
          <p className="font-display text-xl text-white">No Gift Rules Configured</p>
          <p className="mt-1 text-sm text-slate-400">
            Add a gift rule such as Çay to connect TikTok gifts or simulations to prayers.
          </p>
          <button
            type="button"
            onClick={openNew}
            className="mt-4 bg-[#C9A45C] text-[#070D1B] font-semibold text-xs px-4 py-2 cursor-pointer"
          >
            Add First Gift
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {state.gifts.map((gift) => {
            const cat = PRAYER_CATEGORIES.find((c) => c.id === gift.category);
            return (
              <div
                key={gift.id}
                className={`bg-[#0B142B] border p-5 flex flex-col justify-between ${
                  gift.enabled ? 'border-[#1E3361]' : 'border-[#162241] opacity-75'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-mono text-slate-400">Key: {gift.tiktokGiftId}</p>
                      <h3 className="mt-1 font-display text-2xl font-semibold text-white">
                        {gift.name}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleGiftEnabled(gift.id)}
                      className={`text-xs font-medium px-2.5 py-1 border cursor-pointer ${
                        gift.enabled
                          ? 'border-emerald-500/40 text-emerald-300 bg-emerald-950/30'
                          : 'border-slate-600 text-slate-400 bg-slate-900/40'
                      }`}
                    >
                      {gift.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>

                  <dl className="mt-4 space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <dt className="text-slate-400">Prayer Category</dt>
                      <dd className="text-slate-200 font-medium">{cat?.labelTr}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-400">Priority</dt>
                      <dd className="text-[#E5C88B] capitalize">{gift.priority}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-400">Quantity Mode</dt>
                      <dd className="font-mono-tabular text-slate-200">
                        {gift.repeatPerQuantity ? `×${gift.quantityMultiplier} per unit` : 'Single bundled prayer'}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-400">Min Coins</dt>
                      <dd className="font-mono-tabular text-slate-200">{gift.minCoins}</dd>
                    </div>
                  </dl>
                </div>

                <div className="mt-5 pt-3 border-t border-[#16254A] flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleTestGift(gift)}
                    className="inline-flex items-center gap-1.5 text-xs text-[#E5C88B] hover:text-white cursor-pointer"
                  >
                    <Coffee className="w-3.5 h-3.5" />
                    <span>Simulate</span>
                  </button>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => openEdit(gift)}
                      className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-white cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>

                    {confirmDeleteId === gift.id ? (
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            deleteGift(gift.id);
                            setConfirmDeleteId(null);
                          }}
                          className="inline-flex items-center gap-1 text-xs text-rose-400 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Confirm</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs text-slate-400 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(gift.id)}
                        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove</span>
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
