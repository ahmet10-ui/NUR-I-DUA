# -*- coding: utf-8 -*-
"""
Seslen-TTS Turkish G2P & Sentence Chunker for Android (Chaquopy).
Uses pure-Python `turkce_normalize` and `turkce_vurgu` packages so
token IDs, stress marks, question pitch curves, and punctuation markers
match `seslen-tr/seslen-tts` (`metin.onnx` + `ses.onnx`) exactly.
"""
from __future__ import annotations

import json
import re
from typing import Any

from turkce_normalize import paragraflar, uzun_cumleyi_bol, virgulden_bol
from turkce_vurgu import g2p

UZUN_CUMLE = 220
PARCA_SOZCUK = 12
PARCA_MS = 175
CUMLE_MS = 450
PARAGRAF_KAT = 2.0
KISA_SOZCUK = 2
TASIYICI = " Hem bunu sana daha önce de söylemiştim."
SORU_TEPE = 6.0

_UNLU = set("aeɯiouøyœæɛɪʊ")
_SORU_EKI = re.compile(
    r"^m[ɯiuy](s[ɯiuy]n([ɯiuy]z)?|j[ɯiuy][mz]|d[ɯiuy]ɾ?|jd[ɯiuy](m|n|[ɯiuy]z)?|jmɯʃ|jmiʃ|jmuʃ|jmyʃ)?[?.,!]*$"
)
_KISA = re.compile(r"(?:^|(?<=[.!?…]\s))((?:[^\s.!?…;]+\s)?([^\s.!?…;]+))([.!]+)\s+(\w)(?=(\w?))")
_KISALTMA = {"prof", "doç", "dr", "sn", "av", "bkz", "vb", "vs", "örn", "yrd", "mah", "cad", "sok", "no", "op", "uzm"}

_semboller_cache: dict[str, dict[str, int]] = {}


def _load_semboller(semboller_path: str) -> dict[str, int]:
    if semboller_path not in _semboller_cache:
        with open(semboller_path, "r", encoding="utf-8") as f:
            _semboller_cache[semboller_path] = json.load(f)
    return _semboller_cache[semboller_path]


def warm_up(semboller_path: str) -> dict[str, Any]:
    """Preloads semboller.json and initializes Python G2P caches at startup."""
    semboller = _load_semboller(semboller_path)
    sample_okunus = g2p("merhaba", vurgu=True)
    return {"ok": True, "symbolCount": len(semboller), "warmSampleLen": len(sample_okunus)}


def _kucuk(s: str) -> str:
    return s.replace("I", "ı").replace("İ", "i").lower()


def _akici(metin: str) -> str:
    def bagla(m: re.Match[str]) -> str:
        son, isaret, ilk, ikinci = m.group(2), m.group(3), m.group(4), m.group(5)
        if isaret == "." and (len(son) < 4 or _kucuk(son) in _KISALTMA or any(c.isdigit() for c in m.group(1))):
            return m.group(0)
        if not ikinci or ikinci.islower():
            ilk = _kucuk(ilk)
        return f"{m.group(1)}, {ilk}"

    for _ in range(3):
        metin, eski = _KISA.sub(bagla, metin), metin
        if metin == eski:
            break
    return metin


def _bol(metin: str) -> list[str]:
    metin = _akici(" ".join(metin.split()))
    return [c for c in re.split(r"(?<=[.!?…])\s+", metin) if c]


def _bolumler(metin: str) -> list[tuple[str, bool]]:
    cikti: list[tuple[str, bool]] = []
    for p in paragraflar(metin):
        cumleler = [q for c in _bol(p) for q in uzun_cumleyi_bol(c, UZUN_CUMLE)]
        cumleler = [c for c in cumleler if any(ch.isalnum() for ch in c)]
        cikti += [(c, i == len(cumleler) - 1) for i, c in enumerate(cumleler)]
    return cikti


def _soru_egrisi(okunus: str, sozluk: dict[str, int]) -> list[float]:
    ek = [0.0] * len(okunus)
    if "?" in okunus:
        sozcukler: list[tuple[int, str]] = []
        i = 0
        for s in okunus.split(" "):
            sozcukler.append((i, s))
            i += len(s) + 1
        for j in range(1, len(sozcukler)):
            bas, s = sozcukler[j]
            if not _SORU_EKI.match(s.replace("ˈ", "")) or "?" not in okunus[bas:]:
                continue
            b0, onceki = sozcukler[j - 1]
            if not onceki or onceki[-1] in "?.,!;:":
                continue
            v = onceki.rfind("ˈ")
            if v < 0:
                v = max((k for k, c in enumerate(onceki) if c in _UNLU), default=0)
                if v > 0 and onceki[v - 1] not in _UNLU:
                    v -= 1
            k = next((idx for idx in range(v, len(onceki)) if onceki[idx] in _UNLU), len(onceki))
            while k < len(onceki) and (onceki[k] in _UNLU or onceki[k] == "ː"):
                k += 1
            sonraki = next((m for m in range(k, len(onceki)) if onceki[m] in _UNLU), None)
            son = len(onceki) if sonraki is None else max(sonraki - 1, k)
            for idx in range(b0 + v, b0 + son):
                if 0 <= idx < len(ek):
                    ek[idx] = SORU_TEPE
    return [float(e) for c, e in zip(okunus, ek) if c in sozluk]


def _kisa_bitis(
    metin: str, semboller: dict[str, int], nokta_set: set[int]
) -> tuple[int, str | None]:
    s = metin.strip()
    if len(s.split()) > KISA_SOZCUK or not s.endswith((".", "!")):
        return 0, None
    okunus_s = g2p(s, vurgu=True)
    kod = [semboller[c] for c in okunus_s if c in semboller]
    okunus_uzun = g2p(s + TASIYICI, vurgu=True)
    uzun = [semboller[c] for c in okunus_uzun if c in semboller]
    same_raw = s == metin
    if uzun[:len(kod)] != kod:
        return 0, (okunus_s if same_raw else None)
    son = len(kod)
    while son > 1 and kod[son - 1] in nokta_set:
        son -= 1
    if son > 0:
        return son, (okunus_uzun if same_raw else None)
    return 0, (okunus_s if same_raw else None)


def _son_harf(kod: list[int], semboller: dict[str, int]) -> int:
    harfsiz = {i for c, i in semboller.items() if not c.isalpha()}
    son = len(kod)
    while son and kod[son - 1] in harfsiz:
        son -= 1
    return son


def prepare_chunks(text: str, semboller_path: str) -> str:
    """
    Splits Turkish text into bounded chunks and produces ONNX-ready token IDs,
    question pitch curves, and punctuation positions.
    Returns JSON string.
    """
    semboller = _load_semboller(semboller_path)
    virgul_id = semboller.get(",", -1)
    noktali_id = semboller.get(";", -1)
    iki_nokta_id = semboller.get(":", -1)
    nokta_set = {semboller[c] for c in ".!…," if c in semboller}

    chunks_out: list[dict[str, Any]] = []
    for cumle, paragraf_sonu in _bolumler(text):
        parcalar = virgulden_bol(cumle, PARCA_SOZCUK)
        for j, p in enumerate(parcalar):
            bitis, cached_okunus = _kisa_bitis(p, semboller, nokta_set)
            kaynak = (p + TASIYICI) if bitis > 0 else p
            okunus = cached_okunus if cached_okunus is not None else g2p(kaynak, vurgu=True)
            kod = [semboller[c] for c in okunus if c in semboller]
            if not kod:
                continue

            tokens = [0] + kod + [0]
            egri = [0.0] + _soru_egrisi(okunus, semboller) + [0.0]

            comma_idx: list[int] = []
            semi_idx: list[int] = []
            colon_idx: list[int] = []
            for idx_1based, tok in enumerate(kod, 1):
                if tok == virgul_id:
                    comma_idx.append(idx_1based)
                elif tok == noktali_id:
                    semi_idx.append(idx_1based)
                elif tok == iki_nokta_id:
                    colon_idx.append(idx_1based)

            son_harf = bitis if bitis > 0 else _son_harf(kod, semboller)
            pay_birim = 1 if bitis > 0 else 2

            if j < len(parcalar) - 1:
                silence_after_ms = PARCA_MS
            else:
                silence_after_ms = int(CUMLE_MS * (PARAGRAF_KAT if paragraf_sonu else 1.0))

            chunks_out.append(
                {
                    "text": p,
                    "okunus": okunus,
                    "tokens": tokens,
                    "egri": egri,
                    "commaIdx": comma_idx,
                    "semiIdx": semi_idx,
                    "colonIdx": colon_idx,
                    "sonHarf": son_harf,
                    "payBirim": pay_birim,
                    "silenceAfterMs": silence_after_ms,
                }
            )

    return json.dumps(
        {
            "ok": True,
            "chunkCount": len(chunks_out),
            "chunks": chunks_out,
        },
        ensure_ascii=False,
    )
