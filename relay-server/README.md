# NUR-I DUA — Harici TikTok LIVE Relay Sunucusu (`@fcproplayer7`)

Android Capacitor uygulaması ve web tarayıcısı doğrudan `tiktok-live-connector` (Node.js WebSocket/Protobuf katmanı) çalıştıramaz.
Bu klasör, Render üzerinde **`NUR-I DUA`** Web Service olarak `process.env.PORT` ve `0.0.0.0` üzerinde çalıştırılabilen bağımsız, sıfır-kimlik-bilgili (şifre/çerez istemeyen) Node.js ESM relay sunucusudur.

## Özellikler

- `process.env.PORT` (varsayılan `8080`) ve `0.0.0.0` üzerinde dinler (`NUR-I DUA` Render Web Service ile uyumludur).
- Yalnızca herkese açık yayıncı kullanıcı adı (`@fcproplayer7`) ile bağlanır; TikTok şifresi, çerezi veya gizli oturum bilgisi istemez ve saklamaz.
- `giftType === 1 && !repeatEnd` seri hediye paketlerini seri bitene kadar bekletir; seri tamamlandığında doğru toplam miktarla **tek bir** `gift` SSE olayı yayınlar.
- `X-Accel-Buffering: no` ve CORS açık olduğu için hem Android Capacitor uygulamasına hem masaüstü tarayıcıya kesintisiz SSE aktarır.
- **Bağlantı Koruma ve Kota Koruması**:
  - Kullanıcı adı başına eşzamanlı `/connect` kilidi (`connectPromise` mutex) ile aynı anda birden fazla el sıkışma açılmasını engeller.
  - HTTP `429` / `SignatureRateLimitError` (`rate_limit_account_day`) durumunda otomatik `cooldownUntilMs` / `Retry-After` uygular (`/reconnect` bu bekleme süresini bilinçli olarak sıfırlar).
  - Kopan/başarısız bağlantılarda tüm dinleyicileri (`removeAllListeners`) ve soketleri temizleyip yalnızca aktif bağlantının olaylarını işler.

## Uç Noktalar

- `GET /` ve `GET /health` — Sunucu sağlık kontrolü (`200 OK`, `activeSignerProvider`, `signerMode`, `sessionsSummary`, `simulationEnabled` — kesinlikle gizli anahtar/URL içermez)
- `GET /status?username=fcproplayer7` — Anlık oturum durumu (`state`, `roomId`, `viewerCount`, `followerCount`, `lastEvent`, `lastErrorCategory`, `retryAfterSec`, `cooldownUntil`, `activeSignerProvider`)
- `POST /connect` — `{ "username": "fcproplayer7" }` ile canlı yayına bağlanır (kota beklemesi aktifse `429` + `Retry-After` döner)
- `POST /reconnect` — `{ "username": "fcproplayer7" }` ile mevcut oturumu ve bekleme süresini sıfırlayıp yeniden bağlanır
- `POST /disconnect` — Aktif yayından ayrılır
- `GET /events?username=fcproplayer7` — `status`, `gift`, `follow` ve `recovery_gap` olaylarını SSE olarak yayınlar

## Modüler İmzalama Sağlayıcısı (`TIKTOK_SIGNER_PROVIDER`)

`tiktok-live-connector@2.5.0` içinde `enableExtendedGiftInfo: true` varsayılan olarak EulerStream Business plan gerektiren `/webcast/sign_url` (`fetchWebcastSignatureFromEulerRoute`) ucunu çağırır ve ücretsiz Euler günlük imzalama kotası dolduğunda `rate_limit_account_day` hatası verir.
`signingProvider.mjs` Euler Business ucunu varsayılan olarak engeller ve aşağıdaki modüler sağlayıcıları destekler:

- `TIKTOK_SIGNER_PROVIDER=auto` *(varsayılan)* — Tanımlı `WS_SIGN_SERVER_URL` / `HTTP_SIGN_SERVER_URL` / `SIGN_SERVER_URL` değişkenlerine göre otomatik seçim yapar.
- `TIKTOK_SIGNER_PROVIDER=tiktok_signer` — Açık kaynaklı `nglmercer/tiktok-signer` HTTP JSON servisine bağlanır (`POST /sign` veya `405` dönmesi hâlinde otomatik `GET /sign?url=...` fallback; `X-Bogus`, `X-Gnarly`, `msToken` ve `navigator.user_agent` çıkarır). WebSocket el sıkışması da `webcast/im/fetch/` üzerinden doğrudan bu HTTP imzalayıcıyla yapılır; Euler'e **sessiz geri dönüş yapılmaz**.
- `TIKTOK_SIGNER_PROVIDER=custom_http` — Özel HTTP URL imzalayıcıyla (`HTTP_SIGN_SERVER_URL`) hem `gift/list/` hem `webcast/im/fetch/` isteklerini Euler'siz imzalar.
- `TIKTOK_SIGNER_PROVIDER=custom_ws` — Özel WebSocket protobuf imzalayıcı (`WS_SIGN_SERVER_URL`) kullanır (`Euler` fallback kapalıdır).
- `TIKTOK_SIGNER_PROVIDER=custom_full` — Hem `WS_SIGN_SERVER_URL` hem `HTTP_SIGN_SERVER_URL` uçlarını kullanır (`Euler` fallback kapalıdır).
- `TIKTOK_SIGNER_PROVIDER=euler` — Yalnızca ücretsiz EulerStream WebSocket rotasını kullanır (günlük Euler kotasına tabidir).
- `TIKTOK_SIGNER_PROVIDER=none` *(veya `DISABLE_EULER=true`)* — EulerStream'i tamamen kapatır.

> **Önemli (`nglmercer/tiktok-signer` Notu):** `nglmercer/tiktok-signer` ayrı bir Rust mikroservisidir ve kendi başına derlenip çalıştırılması için Rust (`rustc` / `cargo`) araç zinciri gerektirir. `relay-server/` ise yalnızca **Node.js `>=20.0.0`** gerektirir ve harici olarak ayağa kaldırdığınız `tiktok-signer` URL'sine HTTP üzerinden bağlanır.

## Gereksinimler ve Ortam Değişkenleri

- **Node.js `>=20.0.0`** (`tiktok-live-connector@2.5.0` için zorunludur)
- Örnek değişken şablonu için `relay-server/.env.example` dosyasına bakın (`TIKTOK_USERNAME`, `SIMULATION_ENABLED`, `TIKTOK_SIGNER_PROVIDER`, `HTTP_SIGN_SERVER_URL`, `WS_SIGN_SERVER_URL`, `SIGN_SERVER_URL`, `SIGN_SERVER_TOKEN`, `SIGN_SERVER_HTTP_METHOD`, `DISABLE_EULER`, `ALLOW_EULER_BUSINESS_SIGN`, `SIGN_API_KEY`).

## Yerel Çalıştırma

```bash
cd relay-server
npm install
npm start
```

## Render Üzerinde Yayınlama (`NUR-I DUA`)

1. `relay-server/` klasörünü (içindeki `package.json`, `server.mjs`, `signingProvider.mjs`, `.env.example`, `.gitignore`, `README.md` dosyalarıyla; `node_modules/` hariç) GitHub deponuza aktarın.
2. Render'da mevcut **`NUR-I DUA`** Web Service'i kullanın veya **New > Web Service** ile adı **`NUR-I DUA`** olan servisi GitHub deponuzdan oluşturun.
3. **Root Directory:** `relay-server`
4. **Runtime:** `Node` (Node 20+)
5. **Build Command:** `npm install`
6. **Start Command:** `npm start`
7. Ortam değişkenleri: `TIKTOK_USERNAME=fcproplayer7`, `SIMULATION_ENABLED=false`, `TIKTOK_SIGNER_PROVIDER=...` ve varsa harici imzalayıcı URL'niz (`HTTP_SIGN_SERVER_URL` / `WS_SIGN_SERVER_URL`).
8. **Health Check Path:** `/health`
9. Oluşan servis adresinizi NUR-I DUA uygulamasındaki **TikTok Connection > External Node.js Relay Base URL** alanına girip **Relay Sağlık Testi** ve `@fcproplayer7` ile bağlanın.
