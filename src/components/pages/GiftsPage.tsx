import React, { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, Coffee, X, Check, UserPlus, Sparkles, ShieldCheck } from 'lucide-react';
import { PRAYER_CATEGORIES } from '../../data/defaults';
import { useStudio } from '../../context/StudioContext';
import { resolveTierRules } from '../../services/interactionClassifier';
import { GiftPriority, GiftRule, PrayerCategoryId, TierRuleConfig } from '../../types/nuridua';
import { renderPersonalizedPrayer } from '../../utils/sanitize';

export const GiftsPage: React.FC = () => {
  const {
    state,
    addGift,
    updateGift,
    deleteGift,
    toggleGiftEnabled,
    enqueueGiftEvent,
    enqueueFollowEvent,
    updateTierRules,
  } = useStudio();

  const effectiveTierRules = resolveTierRules(state.tierRules);
  const [tierDraft, setTierDraft] = useState<TierRuleConfig>(effectiveTierRules);
  const [simSampleUser, setSimSampleUser] = useState('Mehmet');

  useEffect(() => {
    setTierDraft(resolveTierRules(state.tierRules));
  }, [state.tierRules]);

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

  const handleSaveTierRules = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      tierDraft.smallGiftMinCoins > tierDraft.smallGiftMaxCoins ||
      tierDraft.midGiftMinCoins > tierDraft.midGiftMaxCoins ||
      tierDraft.highGiftMinCoins > tierDraft.highGiftMaxCoins
    ) {
      setNotice('Hata: Alt jeton eşiği üst jeton eşiğinden büyük olamaz.');
      return;
    }
    updateTierRules(tierDraft);
    setNotice('Etkileşim seviyesi eşikleri ve selamlama metinleri kaydedildi.');
  };

  const handleTierToggle = (
    key: 'followerEnabled' | 'smallGiftEnabled' | 'midGiftEnabled' | 'highGiftEnabled' | 'yasinEnabled'
  ) => {
    const nextVal = !(effectiveTierRules[key] ?? true);
    updateTierRules({ [key]: nextVal });
    setNotice('Seviye durumu güncellendi.');
  };

  const runStage2Sim = (mode: 'follow' | 'small' | 'mid' | 'high' | 'yasin') => {
    if (mode === 'follow') {
      const res = enqueueFollowEvent({ source: 'simulation', username: simSampleUser });
      setNotice(
        res.ok && res.event
          ? `Takipçi simülasyonu eklendi: ${res.event.renderedPrayer}`
          : res.reason || 'Takipçi simülasyonu eklenemedi.'
      );
      return;
    }

    const presets = {
      small: { giftIdOrName: 'Simülasyon Gülü', unitCoins: tierDraft.smallGiftMinCoins },
      mid: { giftIdOrName: 'Simülasyon Buket', unitCoins: tierDraft.midGiftMinCoins },
      high: { giftIdOrName: 'Simülasyon Tacı', unitCoins: tierDraft.highGiftMinCoins },
      yasin: { giftIdOrName: 'Simülasyon Yâsîn Hediyesi', unitCoins: tierDraft.yasinMinCoins },
    }[mode];

    const res = enqueueGiftEvent({
      source: 'simulation',
      username: simSampleUser,
      giftIdOrName: presets.giftIdOrName,
      unitCoins: presets.unitCoins,
      quantity: 1,
    });
    setNotice(
      res.ok && res.event
        ? `${presets.unitCoins} Jeton (${res.event.tier}) kuyruğa eklendi → ${res.event.prayerTitle}`
        : res.reason || 'Simülasyon reddedildi.'
    );
  };

  const tierToggleCards: Array<{
    key: 'followerEnabled' | 'smallGiftEnabled' | 'midGiftEnabled' | 'highGiftEnabled' | 'yasinEnabled';
    title: string;
    subtitle: string;
  }> = [
    {
      key: 'followerEnabled',
      title: 'Yeni Takipçi',
      subtitle: 'Otomatik selamlama',
    },
    {
      key: 'smallGiftEnabled',
      title: 'Küçük Hediye',
      subtitle: `${effectiveTierRules.smallGiftMinCoins}–${effectiveTierRules.smallGiftMaxCoins} Jeton · Sadece selam`,
    },
    {
      key: 'midGiftEnabled',
      title: 'Orta Hediye',
      subtitle: `${effectiveTierRules.midGiftMinCoins}–${effectiveTierRules.midGiftMaxCoins} Jeton · Başlangıç duası`,
    },
    {
      key: 'highGiftEnabled',
      title: 'Yüksek Hediye',
      subtitle: `${effectiveTierRules.highGiftMinCoins}–${effectiveTierRules.highGiftMaxCoins} Jeton · Arapça + Aile`,
    },
    {
      key: 'yasinEnabled',
      title: 'Yâsîn-i Şerîf',
      subtitle: `${effectiveTierRules.yasinMinCoins}+ Jeton · Tam Yâsîn`,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-[#1A2B54] pb-5">
        <div>
          <p className="text-xs text-[#D4B26A] font-medium tracking-[0.14em] uppercase">
            Gift Rules &amp; Tier Engine
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-white">
            Gift &amp; Interaction Management
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage coin thresholds, per-tier enable switches, greeting templates, and custom TikTok gift overrides.
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

      {/* Stage 2 Tier Controls & Coin Thresholds */}
      <div className="bg-[#0B142B] border border-[#1E3361] p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 border-b border-[#16254A] pb-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-[#D4B26A] uppercase tracking-[0.12em]">
              <ShieldCheck className="w-4 h-4" />
              <span>Aşama 2 · Etkileşim Seviyeleri ve Jeton Eşikleri</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Küçük hediyeler dua okumaz (yalnızca selam); orta hediyeler Başlangıç Duaları havuzunu, yüksek hediyeler doğrulanmış Arapça kârî + Türkçe aile duasını kullanır.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={simSampleUser}
              onChange={(e) => setSimSampleUser(e.target.value)}
              aria-label="Test kullanıcı adı"
              placeholder="Örnek isim"
              className="w-28 bg-[#070E1F] border border-[#233969] px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#C9A45C]"
            />
            <button
              type="button"
              onClick={() => runStage2Sim('follow')}
              className="inline-flex items-center gap-1.5 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] px-2.5 py-1.5 text-xs text-[#E5C88B] cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Takipçi</span>
            </button>
            <button
              type="button"
              onClick={() => runStage2Sim('small')}
              className="bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] px-2.5 py-1.5 text-xs text-slate-200 cursor-pointer"
            >
              Küçük ({tierDraft.smallGiftMinCoins})
            </button>
            <button
              type="button"
              onClick={() => runStage2Sim('mid')}
              className="bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] px-2.5 py-1.5 text-xs text-slate-200 cursor-pointer"
            >
              Orta ({tierDraft.midGiftMinCoins})
            </button>
            <button
              type="button"
              onClick={() => runStage2Sim('high')}
              className="inline-flex items-center gap-1 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] px-2.5 py-1.5 text-xs text-[#E5C88B] cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Yüksek ({tierDraft.highGiftMinCoins})</span>
            </button>
            <button
              type="button"
              onClick={() => runStage2Sim('yasin')}
              className="inline-flex items-center gap-1 bg-[#C9A45C] hover:bg-[#D7B46E] px-2.5 py-1.5 text-xs font-semibold text-[#070D1B] cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Yâsîn ({tierDraft.yasinMinCoins}+)</span>
            </button>
          </div>
        </div>

        {/* 5 Tier Enable Switches */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {tierToggleCards.map((item) => {
            const isOn = effectiveTierRules[item.key] ?? true;
            return (
              <div
                key={item.key}
                className={`border p-3 flex items-center justify-between gap-2 ${
                  isOn ? 'bg-[#070E1F] border-[#26407A]' : 'bg-[#070E1F]/50 border-[#162344] opacity-75'
                }`}
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{item.title}</p>
                  <p className="text-[11px] text-slate-400 truncate">{item.subtitle}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleTierToggle(item.key)}
                  className={`text-[11px] font-medium px-2 py-1 border shrink-0 cursor-pointer ${
                    isOn
                      ? 'border-emerald-500/40 text-emerald-300 bg-emerald-950/30'
                      : 'border-slate-600 text-slate-400 bg-slate-900/40'
                  }`}
                >
                  {isOn ? 'Açık' : 'Kapalı'}
                </button>
              </div>
            );
          })}
        </div>

        {/* Editable Thresholds & Greeting Templates */}
        <form onSubmit={handleSaveTierRules} className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Küçük Min</label>
              <input
                type="number"
                min={1}
                value={tierDraft.smallGiftMinCoins}
                onChange={(e) =>
                  setTierDraft((d) => ({ ...d, smallGiftMinCoins: Math.max(1, Number(e.target.value) || 1) }))
                }
                className="w-full bg-[#070E1F] border border-[#233969] px-2.5 py-1.5 text-xs font-mono-tabular text-white focus:outline-none focus:border-[#C9A45C]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Küçük Max</label>
              <input
                type="number"
                min={1}
                value={tierDraft.smallGiftMaxCoins}
                onChange={(e) =>
                  setTierDraft((d) => ({ ...d, smallGiftMaxCoins: Math.max(1, Number(e.target.value) || 1) }))
                }
                className="w-full bg-[#070E1F] border border-[#233969] px-2.5 py-1.5 text-xs font-mono-tabular text-white focus:outline-none focus:border-[#C9A45C]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Orta Min</label>
              <input
                type="number"
                min={1}
                value={tierDraft.midGiftMinCoins}
                onChange={(e) =>
                  setTierDraft((d) => ({ ...d, midGiftMinCoins: Math.max(1, Number(e.target.value) || 1) }))
                }
                className="w-full bg-[#070E1F] border border-[#233969] px-2.5 py-1.5 text-xs font-mono-tabular text-white focus:outline-none focus:border-[#C9A45C]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Orta Max</label>
              <input
                type="number"
                min={1}
                value={tierDraft.midGiftMaxCoins}
                onChange={(e) =>
                  setTierDraft((d) => ({ ...d, midGiftMaxCoins: Math.max(1, Number(e.target.value) || 1) }))
                }
                className="w-full bg-[#070E1F] border border-[#233969] px-2.5 py-1.5 text-xs font-mono-tabular text-white focus:outline-none focus:border-[#C9A45C]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Yüksek Min</label>
              <input
                type="number"
                min={1}
                value={tierDraft.highGiftMinCoins}
                onChange={(e) =>
                  setTierDraft((d) => ({ ...d, highGiftMinCoins: Math.max(1, Number(e.target.value) || 1) }))
                }
                className="w-full bg-[#070E1F] border border-[#233969] px-2.5 py-1.5 text-xs font-mono-tabular text-white focus:outline-none focus:border-[#C9A45C]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Yüksek Max</label>
              <input
                type="number"
                min={1}
                value={tierDraft.highGiftMaxCoins}
                onChange={(e) =>
                  setTierDraft((d) => ({ ...d, highGiftMaxCoins: Math.max(1, Number(e.target.value) || 1) }))
                }
                className="w-full bg-[#070E1F] border border-[#233969] px-2.5 py-1.5 text-xs font-mono-tabular text-white focus:outline-none focus:border-[#C9A45C]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Yâsîn Min</label>
              <input
                type="number"
                min={1}
                value={tierDraft.yasinMinCoins}
                onChange={(e) =>
                  setTierDraft((d) => ({ ...d, yasinMinCoins: Math.max(1, Number(e.target.value) || 1) }))
                }
                className="w-full bg-[#070E1F] border border-[#233969] px-2.5 py-1.5 text-xs font-mono-tabular text-white focus:outline-none focus:border-[#C9A45C]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Hesap Modu</label>
              <select
                value={tierDraft.coinEvaluationMode}
                onChange={(e) =>
                  setTierDraft((d) => ({
                    ...d,
                    coinEvaluationMode: e.target.value as TierRuleConfig['coinEvaluationMode'],
                  }))
                }
                className="w-full bg-[#070E1F] border border-[#233969] px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#C9A45C]"
              >
                <option value="event_total">Tek Hediye Toplamı</option>
                <option value="unit_only">Birim Jeton</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label htmlFor="tier-follow-tpl" className="block text-xs text-slate-300 mb-1">
                Takipçi Selamlama Şablonu (<code className="text-[#E5C88B]">{'{isim}'}</code>)
              </label>
              <input
                id="tier-follow-tpl"
                type="text"
                value={tierDraft.followerGreetingTemplate}
                onChange={(e) =>
                  setTierDraft((d) => ({ ...d, followerGreetingTemplate: e.target.value }))
                }
                className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-xs text-white focus:outline-none focus:border-[#C9A45C]"
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Önizleme:{' '}
                <span className="text-slate-200">
                  {renderPersonalizedPrayer(tierDraft.followerGreetingTemplate, simSampleUser || 'Misafir')}
                </span>
              </p>
            </div>

            <div>
              <label htmlFor="tier-small-tpl" className="block text-xs text-slate-300 mb-1">
                Küçük Hediye (1–49) Selamlama Şablonu (<code className="text-[#E5C88B]">{'{isim}'}</code>)
              </label>
              <input
                id="tier-small-tpl"
                type="text"
                value={tierDraft.smallGiftGreetingTemplate}
                onChange={(e) =>
                  setTierDraft((d) => ({ ...d, smallGiftGreetingTemplate: e.target.value }))
                }
                className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-xs text-white focus:outline-none focus:border-[#C9A45C]"
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Önizleme:{' '}
                <span className="text-slate-200">
                  {renderPersonalizedPrayer(tierDraft.smallGiftGreetingTemplate, simSampleUser || 'Misafir')}
                </span>
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="px-4 py-2 bg-[#C9A45C] hover:bg-[#D7B46E] text-[#070D1B] font-semibold text-xs cursor-pointer"
            >
              Seviye Ayarlarını Kaydet
            </button>
          </div>
        </form>
      </div>

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
