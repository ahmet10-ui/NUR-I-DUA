import React, { useMemo, useState } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  Volume2,
  Shuffle,
  Eye,
  Check,
  X,
  BookOpen,
  ShieldCheck,
  AlertTriangle,
  Square,
} from 'lucide-react';
import { PRAYER_CATEGORIES } from '../../data/defaults';
import { useStudio } from '../../context/StudioContext';
import { buildHighTierTurkishSpeech } from '../../services/stage2Flow';
import { verifiedArabicAudioPlayer } from '../../services/ttsService';
import {
  HighTierDuaEntry,
  PrayerCategoryId,
  PrayerTemplate,
  VerifiedAudioStatus,
} from '../../types/nuridua';
import { renderPersonalizedPrayer } from '../../utils/sanitize';

export const PrayersPage: React.FC = () => {
  const {
    state,
    activeEvent,
    addPrayer,
    updatePrayer,
    deletePrayer,
    togglePrayerActive,
    addHighTierDua,
    updateHighTierDua,
    deleteHighTierDua,
    toggleHighTierDuaActive,
    pickRandomPrayer,
    testVoicePlayback,
  } = useStudio();

  const [activeTab, setActiveTab] = useState<'turkish' | 'high_tier'>('turkish');
  const [selectedCategory, setSelectedCategory] = useState<'all' | PrayerCategoryId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewName, setPreviewName] = useState('Ahmet');
  const [randomResult, setRandomResult] = useState<PrayerTemplate | null>(null);

  // Turkish prayer Add / Edit modal state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formCategory, setFormCategory] = useState<PrayerCategoryId>('general_blessings');
  const [formTemplate, setFormTemplate] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // High-Tier Arabic + Family Dua state
  const [showHighForm, setShowHighForm] = useState(false);
  const [editingHighId, setEditingHighId] = useState<string | null>(null);
  const [highTitle, setHighTitle] = useState('');
  const [highSourceCitation, setHighSourceCitation] = useState('');
  const [highArabicHarekeli, setHighArabicHarekeli] = useState('');
  const [highTurkishMeaning, setHighTurkishMeaning] = useState('');
  const [highPersonalTemplate, setHighPersonalTemplate] = useState('');
  const [highAudioUrl, setHighAudioUrl] = useState('');
  const [highAudioLicense, setHighAudioLicense] = useState('');
  const [highAudioAttribution, setHighAudioAttribution] = useState('');
  const [highAudioSha256, setHighAudioSha256] = useState('');
  const [highAudioStatus, setHighAudioStatus] = useState<VerifiedAudioStatus>(
    'pending_license_verification'
  );
  const [highActive, setHighActive] = useState(true);
  const [highFormError, setHighFormError] = useState<string | null>(null);
  const [confirmDeleteHighId, setConfirmDeleteHighId] = useState<string | null>(null);
  const [playingPreviewId, setPlayingPreviewId] = useState<string | null>(null);
  const [highNotice, setHighNotice] = useState<string | null>(null);

  const highDuas = state.highTierDuas || [];
  const midOpeningCount = useMemo(
    () => state.prayers.filter((p) => p.category === 'mid_opening').length,
    [state.prayers]
  );

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

  const openNewHighForm = () => {
    setEditingHighId(null);
    setHighTitle('');
    setHighSourceCitation('');
    setHighArabicHarekeli('');
    setHighTurkishMeaning('');
    setHighPersonalTemplate(
      "Allah'ım, {isim} kardeşimizi, anne ve babasını, ailesini ve bütün akrabalarını rahmetinle kuşat; hânelerine huzur ve bereket ver. Âmin."
    );
    setHighAudioUrl('');
    setHighAudioLicense('');
    setHighAudioAttribution('');
    setHighAudioSha256('');
    setHighAudioStatus('pending_license_verification');
    setHighActive(true);
    setHighFormError(null);
    setShowHighForm(true);
  };

  const openEditHighForm = (entry: HighTierDuaEntry) => {
    setEditingHighId(entry.id);
    setHighTitle(entry.title);
    setHighSourceCitation(entry.sourceCitation);
    setHighArabicHarekeli(entry.arabicHarekeli);
    setHighTurkishMeaning(entry.turkishMeaning);
    setHighPersonalTemplate(entry.personalPrayerTemplate);
    setHighAudioUrl(entry.audioUrl);
    setHighAudioLicense(entry.audioLicense);
    setHighAudioAttribution(entry.audioAttribution);
    setHighAudioSha256(entry.audioSha256 || '');
    setHighAudioStatus(entry.audioStatus);
    setHighActive(entry.isActive);
    setHighFormError(null);
    setShowHighForm(true);
  };

  const handleSaveHighForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!highTitle.trim() || !highSourceCitation.trim()) {
      setHighFormError('Başlık ve kaynak bilgisi zorunludur.');
      return;
    }
    if (!highArabicHarekeli.trim() || !highTurkishMeaning.trim() || !highPersonalTemplate.trim()) {
      setHighFormError('Arapça harekeli metin, Türkçe meal ve kişiselleştirilmiş aile duası zorunludur.');
      return;
    }
    if (
      highAudioStatus === 'verified_ready' &&
      (!highAudioUrl.trim() || !highAudioLicense.trim())
    ) {
      setHighFormError(
        'Doğrulanmış ses hazır durumunu seçmek için ses dosya yolu ve lisans bilgisi girilmelidir; aksi hâlde "Lisans Doğrulaması Bekleniyor" olarak bırakın.'
      );
      return;
    }

    const payload = {
      title: highTitle.trim(),
      sourceCitation: highSourceCitation.trim(),
      arabicHarekeli: highArabicHarekeli.trim(),
      turkishMeaning: highTurkishMeaning.trim(),
      personalPrayerTemplate: highPersonalTemplate.trim(),
      audioUrl: highAudioUrl.trim(),
      audioLicense: highAudioLicense.trim() || 'Doğrulanmamış / Beklemede',
      audioAttribution: highAudioAttribution.trim(),
      audioSha256: highAudioSha256.trim() || undefined,
      audioStatus: highAudioStatus,
      isActive: highActive,
    };

    if (editingHighId) {
      updateHighTierDua(editingHighId, payload);
    } else {
      addHighTierDua(payload);
    }
    setShowHighForm(false);
  };

  const handlePreviewHighArabicAudio = (entry: HighTierDuaEntry) => {
    if (activeEvent) {
      setHighNotice('Aktif yayın kuyruğu oynatılırken Arapça önizleme ses çalınamaz.');
      return;
    }
    if (playingPreviewId === entry.id && verifiedArabicAudioPlayer.isPlaying()) {
      verifiedArabicAudioPlayer.stop();
      setPlayingPreviewId(null);
      return;
    }
    if (entry.audioStatus !== 'verified_ready' || !entry.audioUrl.trim()) {
      setHighNotice('Bu kayıt için doğrulanmış kârî ses dosyası henüz hazır değil.');
      return;
    }
    setHighNotice(null);
    setPlayingPreviewId(entry.id);
    verifiedArabicAudioPlayer.play(entry.audioUrl, {
      volume: state.voice.volume,
      onEnd: () => setPlayingPreviewId(null),
      onError: (reason) => {
        setPlayingPreviewId(null);
        setHighNotice(`Ses önizleme hatası: ${reason}`);
      },
    });
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
            Turkish &amp; High-Tier Prayer Library
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage Başlangıç Duaları (50–149 Jeton), personalized <code className="font-mono text-[#E5C88B]">{'{isim}'}</code> prayers, and source-verified High-Tier (150–299 Jeton) Arabic + Turkish family duas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {activeTab === 'turkish' ? (
            <>
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
            </>
          ) : (
            <button
              type="button"
              onClick={openNewHighForm}
              className="inline-flex items-center gap-2 bg-[#C9A45C] hover:bg-[#D7B46E] text-[#070D1B] font-semibold text-xs sm:text-sm px-4 py-2.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Yeni Yüksek Seviye Dua</span>
            </button>
          )}
        </div>
      </div>

      {/* Mode Switcher Tabs + Preview Name */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('turkish')}
            className={`px-4 py-2 text-xs sm:text-sm border transition-colors cursor-pointer ${
              activeTab === 'turkish'
                ? 'bg-[#C9A45C] text-[#070D1B] font-semibold border-[#C9A45C]'
                : 'bg-[#0B142B] text-slate-300 border-[#1E3361] hover:text-white'
            }`}
          >
            Türkçe Dua Havuzu ({state.prayers.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('turkish');
              setSelectedCategory('mid_opening');
            }}
            className={`px-3.5 py-2 text-xs sm:text-sm border transition-colors cursor-pointer ${
              activeTab === 'turkish' && selectedCategory === 'mid_opening'
                ? 'bg-[#172C5E] text-[#F7E7C4] border-[#C9A45C]'
                : 'bg-[#0B142B] text-[#E5C88B] border-[#1E3361] hover:border-[#C9A45C]/50'
            }`}
          >
            Başlangıç Duaları · 50–149 Jeton ({midOpeningCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('high_tier')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm border transition-colors cursor-pointer ${
              activeTab === 'high_tier'
                ? 'bg-[#C9A45C] text-[#070D1B] font-semibold border-[#C9A45C]'
                : 'bg-[#0B142B] text-slate-300 border-[#1E3361] hover:text-white'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Yüksek Seviye Arapça &amp; Aile ({highDuas.length})</span>
          </button>
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
            className="w-32 bg-transparent text-sm text-white focus:outline-none"
          />
        </div>
      </div>

      {activeTab === 'high_tier' ? (
        <div className="space-y-5">
          {highNotice && (
            <div className="bg-[#101D3D] border border-[#C9A45C]/40 px-4 py-3 text-xs sm:text-sm text-[#F4E3BD] flex items-center justify-between gap-4">
              <span>{highNotice}</span>
              <button
                type="button"
                onClick={() => setHighNotice(null)}
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Kapat
              </button>
            </div>
          )}

          {showHighForm && (
            <form
              onSubmit={handleSaveHighForm}
              className="bg-[#0D1732] border border-[#C9A45C]/55 p-5 sm:p-6 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl text-white">
                  {editingHighId ? 'Yüksek Seviye Duayı Düzenle' : 'Yeni Yüksek Seviye Arapça + Türkçe Dua'}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowHighForm(false)}
                  className="text-slate-400 hover:text-white p-1 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-300 mb-1.5">Dua Başlığı</label>
                  <input
                    type="text"
                    value={highTitle}
                    onChange={(e) => setHighTitle(e.target.value)}
                    placeholder="örn. Âmenerrasûlü (Bakara 2:285-286)"
                    className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1.5">Doğrulanmış Kaynak</label>
                  <input
                    type="text"
                    value={highSourceCitation}
                    onChange={(e) => setHighSourceCitation(e.target.value)}
                    placeholder="örn. Kur'ân-ı Kerîm · Bakara Sûresi 2:285–286"
                    className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1.5">
                  Harekeli Arapça Metin (Yalnızca Ekranda Gösterilir · Türkçe TTS&apos;e Gönderilmez)
                </label>
                <textarea
                  rows={3}
                  dir="rtl"
                  lang="ar"
                  value={highArabicHarekeli}
                  onChange={(e) => setHighArabicHarekeli(e.target.value)}
                  className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2 text-base text-[#F7E7C4] font-serif focus:outline-none focus:border-[#C9A45C]"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1.5">Türkçe Meal</label>
                <textarea
                  rows={2}
                  value={highTurkishMeaning}
                  onChange={(e) => setHighTurkishMeaning(e.target.value)}
                  className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1.5">
                  Aile, Anne-Baba ve Akrabalar İçin Kişiselleştirilmiş Türkçe Dua (<code className="text-[#E5C88B]">{'{isim}'}</code>)
                </label>
                <textarea
                  rows={3}
                  value={highPersonalTemplate}
                  onChange={(e) => setHighPersonalTemplate(e.target.value)}
                  className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs text-slate-300 mb-1.5">Ses Durumu</label>
                  <select
                    value={highAudioStatus}
                    onChange={(e) => setHighAudioStatus(e.target.value as VerifiedAudioStatus)}
                    className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-xs text-white focus:outline-none focus:border-[#C9A45C]"
                  >
                    <option value="pending_license_verification">
                      Geçici Hazır Değil (Lisans Bekleniyor)
                    </option>
                    <option value="verified_ready">Doğrulanmış Ses Hazır</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1.5">Ses Dosyası / URL</label>
                  <input
                    type="text"
                    value={highAudioUrl}
                    onChange={(e) => setHighAudioUrl(e.target.value)}
                    placeholder="/audio/duas/dosya.mp3"
                    className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#C9A45C]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1.5">Lisans Bilgisi</label>
                  <input
                    type="text"
                    value={highAudioLicense}
                    onChange={(e) => setHighAudioLicense(e.target.value)}
                    placeholder="örn. CC0 1.0 Public Domain"
                    className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-xs text-white focus:outline-none focus:border-[#C9A45C]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1.5">SHA-256 (Opsiyonel)</label>
                  <input
                    type="text"
                    value={highAudioSha256}
                    onChange={(e) => setHighAudioSha256(e.target.value)}
                    placeholder="sha256..."
                    className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#C9A45C]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1.5">Kârî &amp; Kaynak Atıf Notu</label>
                <input
                  type="text"
                  value={highAudioAttribution}
                  onChange={(e) => setHighAudioAttribution(e.target.value)}
                  placeholder="Kârî adı, Wikimedia Commons veya resmi izin kaynağı"
                  className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2 text-xs text-white focus:outline-none focus:border-[#C9A45C]"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                <label className="inline-flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={highActive}
                    onChange={(e) => setHighActive(e.target.checked)}
                    className="accent-[#C9A45C] w-4 h-4"
                  />
                  <span>150–299 Jeton havuzunda aktif</span>
                </label>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowHighForm(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-300 border border-[#233969] cursor-pointer"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 text-xs font-semibold bg-[#C9A45C] hover:bg-[#D7B46E] text-[#070D1B] cursor-pointer"
                  >
                    Kaydet
                  </button>
                </div>
              </div>

              {highFormError && <p className="text-xs text-rose-400">{highFormError}</p>}
            </form>
          )}

          <div className="grid grid-cols-1 gap-4">
            {highDuas.map((entry) => {
              const isVerified = entry.audioStatus === 'verified_ready';
              const isPreviewPlaying = playingPreviewId === entry.id;
              return (
                <div
                  key={entry.id}
                  className={`bg-[#0B142B] border p-5 space-y-3 ${
                    entry.isActive ? 'border-[#1E3361]' : 'border-[#162241] opacity-75'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-[#D4B26A]">{entry.sourceCitation}</p>
                      <h3 className="mt-1 font-display text-2xl font-semibold text-white">
                        {entry.title}
                      </h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 border ${
                          isVerified
                            ? 'border-emerald-500/40 text-emerald-300 bg-emerald-950/30'
                            : 'border-amber-500/40 text-amber-300 bg-amber-950/30'
                        }`}
                      >
                        {isVerified ? (
                          <ShieldCheck className="w-3.5 h-3.5" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {isVerified
                            ? `Doğrulanmış Ses Hazır · ${entry.audioLicense}`
                            : 'Geçici Olarak Hazır Değil'}
                        </span>
                      </span>

                      <button
                        type="button"
                        onClick={() => toggleHighTierDuaActive(entry.id)}
                        className={`text-xs font-medium px-2.5 py-1 border cursor-pointer ${
                          entry.isActive
                            ? 'border-emerald-500/40 text-emerald-300 bg-emerald-950/30'
                            : 'border-slate-600 text-slate-400 bg-slate-900/40'
                        }`}
                      >
                        {entry.isActive ? 'Aktif' : 'Pasif'}
                      </button>
                    </div>
                  </div>

                  <div className="bg-[#070E1F] border border-[#1B2D58] p-3.5 text-right">
                    <p
                      dir="rtl"
                      lang="ar"
                      className="text-base sm:text-lg leading-[1.8] text-[#F7E7C4] font-serif"
                    >
                      {entry.arabicHarekeli}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
                    <div className="bg-[#070E1F]/70 border border-[#16254A] p-3">
                      <p className="text-[#D4B26A] font-medium mb-1">Türkçe Meal</p>
                      <p className="text-slate-200 leading-relaxed">{entry.turkishMeaning}</p>
                    </div>
                    <div className="bg-[#070E1F]/70 border border-[#16254A] p-3">
                      <p className="text-[#D4B26A] font-medium mb-1">
                        Kişiselleştirilmiş Aile &amp; Anne-Baba Duası ({previewName})
                      </p>
                      <p className="text-slate-200 leading-relaxed">
                        {renderPersonalizedPrayer(entry.personalPrayerTemplate, previewName)}
                      </p>
                    </div>
                  </div>

                  {entry.audioAttribution && (
                    <p className="text-[11px] text-slate-400">
                      Ses Kaynağı &amp; Lisans: {entry.audioAttribution}
                    </p>
                  )}

                  <div className="pt-2 border-t border-[#16254A] flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handlePreviewHighArabicAudio(entry)}
                        disabled={!isVerified}
                        className="inline-flex items-center gap-1.5 text-xs text-[#E5C88B] hover:text-white disabled:opacity-40 cursor-pointer"
                      >
                        {isPreviewPlaying ? (
                          <>
                            <Square className="w-3.5 h-3.5" />
                            <span>Arapça Sesi Durdur</span>
                          </>
                        ) : (
                          <>
                            <Volume2 className="w-3.5 h-3.5" />
                            <span>Arapça Kârî Sesini Çal</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          testVoicePlayback(buildHighTierTurkishSpeech(entry, previewName))
                        }
                        className="inline-flex items-center gap-1.5 text-xs text-slate-200 hover:text-white cursor-pointer"
                      >
                        <Volume2 className="w-3.5 h-3.5 text-[#D4B26A]" />
                        <span>Türkçe Aile Duasını Dinle</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => openEditHighForm(entry)}
                        className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-white cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Düzenle</span>
                      </button>

                      {confirmDeleteHighId === entry.id ? (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              deleteHighTierDua(entry.id);
                              setConfirmDeleteHighId(null);
                            }}
                            className="inline-flex items-center gap-1 text-xs text-rose-400 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Onayla</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteHighId(null)}
                            className="text-xs text-slate-400 cursor-pointer"
                          >
                            İptal
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteHighId(entry.id)}
                          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Sil</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          {/* Category Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3">
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
              <option value="all">All Categories ({state.prayers.length})</option>
              {PRAYER_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.labelTr} ({c.labelEn})
                </option>
              ))}
            </select>
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
        </>
      )}
    </div>
  );
};
