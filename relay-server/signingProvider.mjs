import { URL } from 'node:url';

const SIGNING_QUERY_PARAMS = ['X-Bogus', 'X-Gnarly', 'msToken', '_signature', 'verifyFp'];
const DEFAULT_SIGN_TIMEOUT_MS = 15_000;

/**
 * Validates a server-side configured external signer URL from process.env.
 * Rejects non-HTTP(S) schemes and embedded URL credentials.
 * Never call this with untrusted client request input.
 */
export function validateExternalSignerUrl(rawUrl, label = 'SIGN_SERVER_URL') {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${label} geçerli bir URL değil.`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} yalnızca http:// veya https:// protokolünü destekler.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} URL içinde gömülü kimlik bilgisi içeremez.`);
  }
  if (!parsed.hostname) {
    throw new Error(`${label} geçerli bir ana bilgisayar adı içermelidir.`);
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${normalizedPath}${parsed.search}`;
}

export function stripSignatureQueryParams(rawUrl) {
  const input = typeof rawUrl === 'string' ? rawUrl : String(rawUrl || '');
  try {
    const parsed = new URL(input);
    for (const key of SIGNING_QUERY_PARAMS) {
      parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    let clean = input;
    for (const key of ['X-Bogus', 'X-Gnarly', 'msToken']) {
      clean = clean.replace(new RegExp(`([&?])${key}=[^&]*`, 'g'), '$1');
      clean = clean.replace(/[&?]$/, '');
    }
    return clean;
  }
}

export function extractSignatureTokensFromUrl(rawUrl) {
  const tokens = {};
  try {
    const parsed = new URL(String(rawUrl || ''));
    for (const key of SIGNING_QUERY_PARAMS) {
      const val = parsed.searchParams.get(key);
      if (val && val.trim()) {
        tokens[key] = val.trim();
      }
    }
  } catch {
    // ignore malformed URL; caller validates URL separately
  }
  return tokens;
}

const ALLOWED_SIGNER_PROVIDERS = new Set([
  'auto',
  'custom_full',
  'custom_ws',
  'custom_http',
  'tiktok_signer',
  'euler',
  'none',
  'disabled',
]);

function parseBooleanEnv(val) {
  const norm = String(val || '').trim().toLowerCase();
  return norm === 'true' || norm === '1' || norm === 'yes';
}

export function resolveSignerConfiguration(env = process.env) {
  const rawProvider = String(env.TIKTOK_SIGNER_PROVIDER || 'auto').trim().toLowerCase();
  if (rawProvider && !ALLOWED_SIGNER_PROVIDERS.has(rawProvider)) {
    throw new Error(
      `Geçersiz TIKTOK_SIGNER_PROVIDER değeri: "${rawProvider}". Desteklenen değerler: auto, custom_full, custom_ws, custom_http, tiktok_signer, euler, none.`
    );
  }
  const requestedProvider = rawProvider || 'auto';

  const disableEuler =
    parseBooleanEnv(env.DISABLE_EULER) ||
    requestedProvider === 'none' ||
    requestedProvider === 'disabled';
  const signApiKey = String(env.SIGN_API_KEY || '').trim();
  const allowEulerBusinessSign =
    !disableEuler &&
    parseBooleanEnv(env.ALLOW_EULER_BUSINESS_SIGN) &&
    Boolean(signApiKey);

  const legacySignServerUrl = validateExternalSignerUrl(env.SIGN_SERVER_URL, 'SIGN_SERVER_URL');
  const explicitWsSignUrl = validateExternalSignerUrl(env.WS_SIGN_SERVER_URL, 'WS_SIGN_SERVER_URL');
  const explicitHttpSignUrl = validateExternalSignerUrl(
    env.HTTP_SIGN_SERVER_URL,
    'HTTP_SIGN_SERVER_URL'
  );

  // When TIKTOK_SIGNER_PROVIDER=tiktok_signer and only SIGN_SERVER_URL is set,
  // treat SIGN_SERVER_URL (or `<origin>/sign` if root path) as the HTTP signer URL rather than a WS proxy.
  let wsSignUrl = explicitWsSignUrl;
  let httpSignUrl = explicitHttpSignUrl;

  if (requestedProvider === 'tiktok_signer' || requestedProvider === 'custom_http') {
    if (!httpSignUrl && legacySignServerUrl) {
      const parsedLegacy = new URL(legacySignServerUrl);
      httpSignUrl =
        parsedLegacy.pathname === '' || parsedLegacy.pathname === '/'
          ? `${parsedLegacy.origin}/sign`
          : legacySignServerUrl;
    }
  } else {
    wsSignUrl = explicitWsSignUrl || legacySignServerUrl;
    if (!httpSignUrl && legacySignServerUrl) {
      const parsedLegacy = new URL(legacySignServerUrl);
      if (
        (parsedLegacy.pathname === '' || parsedLegacy.pathname === '/') &&
        parseBooleanEnv(env.SIGN_SERVER_HTTP_ENABLED)
      ) {
        httpSignUrl = `${parsedLegacy.origin}/sign`;
      }
    }
  }

  const httpMethodPref = String(env.SIGN_SERVER_HTTP_METHOD || 'POST').trim().toUpperCase();
  const signerHttpMethod = httpMethodPref === 'GET' ? 'GET' : 'POST';
  const signerToken = String(env.SIGN_SERVER_TOKEN || '').trim() || null;
  const timeoutMs = Math.max(
    2000,
    Math.min(30_000, Number(env.SIGN_SERVER_TIMEOUT_MS || DEFAULT_SIGN_TIMEOUT_MS) || DEFAULT_SIGN_TIMEOUT_MS)
  );

  let activeSignerProvider = 'euler';
  let signerMode = 'euler_free_ws_direct_gifts';

  if (requestedProvider === 'none' || requestedProvider === 'disabled') {
    activeSignerProvider = 'none';
    signerMode = 'custom_required_disabled';
    wsSignUrl = null;
    httpSignUrl = null;
  } else if (requestedProvider === 'euler') {
    if (disableEuler) {
      activeSignerProvider = 'none';
      signerMode = 'custom_required_disabled';
    } else {
      activeSignerProvider = 'euler';
      signerMode = allowEulerBusinessSign ? 'euler_business_opt_in' : 'euler_free_ws_direct_gifts';
    }
  } else if (requestedProvider === 'tiktok_signer') {
    activeSignerProvider = 'tiktok_signer';
    signerMode = wsSignUrl ? 'tiktok_signer_with_ws' : 'tiktok_signer_http';
  } else if (requestedProvider === 'custom_full' || (requestedProvider === 'auto' && wsSignUrl && httpSignUrl)) {
    activeSignerProvider = 'custom_full';
    signerMode = 'custom_full';
  } else if (requestedProvider === 'custom_ws' || (requestedProvider === 'auto' && wsSignUrl)) {
    activeSignerProvider = 'custom_ws';
    signerMode = 'custom_ws_direct_gifts';
  } else if (requestedProvider === 'custom_http' || (requestedProvider === 'auto' && httpSignUrl)) {
    activeSignerProvider = 'custom_http';
    signerMode = disableEuler ? 'custom_http_no_euler' : 'custom_http_euler_free_ws';
  } else if (disableEuler) {
    activeSignerProvider = 'none';
    signerMode = 'custom_required_disabled';
  }

  // Strictly block silent Euler fallbacks whenever Euler is disabled OR an explicit non-Euler provider is selected
  const eulerFallbackDisabled = Boolean(
    disableEuler ||
      wsSignUrl ||
      requestedProvider === 'custom_full' ||
      requestedProvider === 'custom_ws' ||
      requestedProvider === 'custom_http' ||
      requestedProvider === 'tiktok_signer'
  );
  const eulerBusinessEndpointBlocked = !allowEulerBusinessSign;

  return {
    requestedProvider,
    activeSignerProvider,
    signerMode,
    wsSignUrl,
    httpSignUrl,
    signerHttpMethod,
    hasCustomWsSigner: Boolean(wsSignUrl),
    hasCustomHttpSigner: Boolean(httpSignUrl),
    hasSignServerUrl: Boolean(wsSignUrl || httpSignUrl),
    hasSignApiKey: Boolean(signApiKey),
    disableEuler,
    eulerFallbackDisabled,
    eulerBusinessEndpointBlocked,
    allowEulerBusinessSign,
    signerToken,
    timeoutMs,
  };
}

function buildSignerHeaders(baseAccept, signerToken) {
  const headers = { Accept: baseAccept };
  if (signerToken) {
    headers.Authorization = `Bearer ${signerToken}`;
    headers['x-api-key'] = signerToken;
  }
  return headers;
}

function parseRetryAfterHeader(resp) {
  const raw = resp?.headers?.get?.('retry-after');
  if (!raw) return null;
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) return Math.ceil(num);
  const ts = Date.parse(raw);
  if (Number.isFinite(ts) && ts > Date.now()) {
    return Math.max(1, Math.ceil((ts - Date.now()) / 1000));
  }
  return null;
}

export async function requestCustomSignedWebSocket({
  wsSignUrl,
  signerToken,
  timeoutMs = DEFAULT_SIGN_TIMEOUT_MS,
  deserializeMessage,
  fetchImpl = fetch,
  roomId,
  cursor,
  useMobile,
  userAgent,
  country,
}) {
  if (!wsSignUrl) {
    throw new Error('WS imzalama sunucusu yapılandırılmadı (WS_SIGN_SERVER_URL / SIGN_SERVER_URL).');
  }
  if (typeof deserializeMessage !== 'function') {
    throw new Error('tiktok-live-connector deserializeMessage işlevi bulunamadı.');
  }

  const targetUrl = new URL(wsSignUrl);
  targetUrl.searchParams.set('roomId', String(roomId || ''));
  if (cursor) targetUrl.searchParams.set('cursor', String(cursor));
  targetUrl.searchParams.set('useMobile', useMobile ? 'true' : 'false');
  if (country) targetUrl.searchParams.set('country', String(country));
  if (userAgent) targetUrl.searchParams.set('userAgent', String(userAgent));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp;
  let rawBuffer;
  try {
    resp = await fetchImpl(targetUrl.toString(), {
      method: 'GET',
      headers: buildSignerHeaders('application/x-protobuf, application/json', signerToken),
      signal: controller.signal,
    });
    const arr = await resp.arrayBuffer();
    rawBuffer = Buffer.from(arr);
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const snippet = rawBuffer.toString('utf8', 0, 240).trim();
    const retryAfterSec = parseRetryAfterHeader(resp);
    if (resp.status === 429) {
      throw new Error(
        `[Rate Limited] [fetchSignedWebSocketFromProvider] Harici WS imzalama sunucusu HTTP 429 döndürdü${retryAfterSec ? ` (retryAfterSec=${retryAfterSec})` : ''}${snippet ? `: ${snippet}` : '.'}`
      );
    }
    throw new Error(
      `[fetchSignedWebSocketFromProvider] Harici WS imzalama sunucusu HTTP ${resp.status} döndürdü${snippet ? `: ${snippet}` : '.'}`
    );
  }

  if (!rawBuffer || rawBuffer.length === 0) {
    throw new Error(
      '[Empty Payload] [fetchSignedWebSocketFromProvider] Harici WS imzalama sunucusu boş yanıt döndürdü.'
    );
  }

  const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
  const firstNonSpace = rawBuffer.toString('utf8', 0, 32).trimStart();
  const looksLikeHtml = firstNonSpace.startsWith('<');
  if (looksLikeHtml || contentType.includes('text/html')) {
    throw new Error(
      '[fetchSignedWebSocketFromProvider] Harici WS imzalama sunucusu protobuf yerine HTML döndürdü.'
    );
  }

  const looksLikeJson = contentType.includes('application/json') || firstNonSpace.startsWith('{');
  let protoBuffer;
  let cookieHeader =
    resp.headers.get('x-set-tt-cookie') || resp.headers.get('set-cookie') || undefined;
  let resolvedRoomId = resp.headers.get('x-room-id') || (roomId ? String(roomId) : undefined);

  if (looksLikeJson) {
    let parsed;
    try {
      parsed = JSON.parse(rawBuffer.toString('utf8'));
    } catch {
      throw new Error(
        '[fetchSignedWebSocketFromProvider] Harici WS imzalama sunucusu geçersiz JSON döndürdü.'
      );
    }
    if (parsed?.ok === false || parsed?.error) {
      throw new Error(
        `[fetchSignedWebSocketFromProvider] Harici WS imzalama sunucusu hata döndürdü: ${parsed.error || parsed.message || 'Unknown error'}`
      );
    }

    const b64 =
      parsed?.signedWebSocketBase64 ||
      parsed?.fetchResultBase64 ||
      parsed?.protobufBase64 ||
      (typeof parsed?.data === 'string' ? parsed.data : '');

    if (!b64 || typeof b64 !== 'string' || !b64.trim()) {
      throw new Error(
        '[Empty Payload] [fetchSignedWebSocketFromProvider] Harici WS imzalama sunucusu JSON yanıtında geçerli protobuf base64 döndürmedi (JSON doğrudan protobuf olarak çözülemez).'
      );
    }

    const cleanedB64 = b64.trim().replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(cleanedB64)) {
      throw new Error(
        '[fetchSignedWebSocketFromProvider] Harici WS imzalama sunucusundan gelen base64 verisi geçersiz.'
      );
    }
    protoBuffer = Buffer.from(cleanedB64, 'base64');
    if (!protoBuffer || protoBuffer.length === 0) {
      throw new Error(
        '[Empty Payload] [fetchSignedWebSocketFromProvider] Çözülen protobuf verisi boş.'
      );
    }

    if (parsed?.cookieHeader && typeof parsed.cookieHeader === 'string') {
      cookieHeader = parsed.cookieHeader.trim();
    } else if (parsed?.xSetTtCookie && typeof parsed.xSetTtCookie === 'string') {
      cookieHeader = parsed.xSetTtCookie.trim();
    }
    if (parsed?.roomId) {
      resolvedRoomId = String(parsed.roomId);
    }
  } else {
    protoBuffer = rawBuffer;
  }

  let fetchResult;
  try {
    fetchResult = deserializeMessage('ProtoMessageFetchResult', protoBuffer);
  } catch (err) {
    throw new Error(
      `[fetchSignedWebSocketFromProvider] ProtoMessageFetchResult çözülemedi: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!fetchResult || typeof fetchResult.cursor !== 'string' || !fetchResult.cursor.trim()) {
    throw new Error(
      '[Empty Payload] [fetchSignedWebSocketFromProvider] ProtoMessageFetchResult geçerli cursor içermiyor.'
    );
  }

  if (
    typeof fetchResult.pushServer !== 'string' ||
    !/^wss?:\/\//i.test(fetchResult.pushServer.trim())
  ) {
    throw new Error(
      '[Empty Payload] [fetchSignedWebSocketFromProvider] ProtoMessageFetchResult geçerli WebSocket pushServer adresi içermiyor.'
    );
  }

  if (!cookieHeader || !String(cookieHeader).trim()) {
    throw new Error(
      '[Empty Cookies] [fetchSignedWebSocketFromProvider] Harici WS imzalama sunucusundan TikTok oturum çerezi (x-set-tt-cookie / cookieHeader) alınamadı.'
    );
  }

  return {
    fetchResult,
    fetchResultCookieHeader: String(cookieHeader).trim(),
    fetchResultRoomId: resolvedRoomId ? String(resolvedRoomId) : undefined,
  };
}

function collectTokenFields(resObj) {
  if (!resObj || typeof resObj !== 'object') return {};
  const candidateMap = {
    ...(resObj.tokens && typeof resObj.tokens === 'object' ? resObj.tokens : {}),
  };
  const keyAliases = [
    ['X-Bogus', ['X-Bogus', 'xBogus', 'x_bogus', 'xbogus']],
    ['X-Gnarly', ['X-Gnarly', 'xGnarly', 'x_gnarly', 'xgnarly']],
    ['msToken', ['msToken', 'ms_token', 'mstoken']],
    ['_signature', ['_signature', 'signature']],
    ['verifyFp', ['verifyFp', 'verify_fp']],
  ];
  for (const [canonical, aliases] of keyAliases) {
    if (candidateMap[canonical]) continue;
    for (const alias of aliases) {
      const val = resObj[alias];
      if (val !== undefined && val !== null && String(val).trim()) {
        candidateMap[canonical] = String(val).trim();
        break;
      }
    }
  }
  return candidateMap;
}

export async function requestCustomWebcastSignature({
  httpSignUrl,
  signerToken,
  signerHttpMethod = 'POST',
  timeoutMs = DEFAULT_SIGN_TIMEOUT_MS,
  fetchImpl = fetch,
  url,
  method = 'GET',
  userAgent,
  webClient,
}) {
  if (!httpSignUrl) {
    throw new Error(
      '[fetchWebcastSignatureFromProvider] Harici HTTP imzalama servisi (HTTP_SIGN_SERVER_URL) yapılandırılmadı; EulerStream Business /webcast/sign_url isteği engellendi.'
    );
  }

  const cleanUrl = stripSignatureQueryParams(url);
  const resolvedInputUa = String(userAgent || webClient?.clientHeaders?.['User-Agent'] || '');

  const invokeHttpSigner = async (reqMethod) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      if (reqMethod === 'GET') {
        const target = new URL(httpSignUrl);
        target.searchParams.set('url', cleanUrl);
        target.searchParams.set('method', String(method || 'GET').toUpperCase());
        if (resolvedInputUa) target.searchParams.set('userAgent', resolvedInputUa);
        const r = await fetchImpl(target.toString(), {
          method: 'GET',
          headers: buildSignerHeaders('application/json', signerToken),
          signal: controller.signal,
        });
        const t = await r.text();
        return { resp: r, text: t };
      }
      const r = await fetchImpl(httpSignUrl, {
        method: 'POST',
        headers: {
          ...buildSignerHeaders('application/json', signerToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: cleanUrl,
          method: String(method || 'GET').toUpperCase(),
          userAgent: resolvedInputUa,
        }),
        signal: controller.signal,
      });
      const t = await r.text();
      return { resp: r, text: t };
    } finally {
      clearTimeout(timer);
    }
  };

  let { resp, text } = await invokeHttpSigner(signerHttpMethod);
  // Some nglmercer/tiktok-signer deployments expose GET /sign?url=... instead of POST /sign
  if (resp.status === 405 && signerHttpMethod === 'POST') {
    ({ resp, text } = await invokeHttpSigner('GET'));
  }

  if (!resp.ok) {
    const retryAfterSec = parseRetryAfterHeader(resp);
    if (resp.status === 429) {
      throw new Error(
        `[Rate Limited] [fetchWebcastSignatureFromProvider] Harici HTTP imzalama sunucusu HTTP 429 döndürdü${retryAfterSec ? ` (retryAfterSec=${retryAfterSec})` : ''}${text ? `: ${text.slice(0, 200)}` : '.'}`
      );
    }
    throw new Error(
      `[fetchWebcastSignatureFromProvider] Harici HTTP imzalama sunucusu HTTP ${resp.status} döndürdü${text ? `: ${text.slice(0, 200)}` : '.'}`
    );
  }

  if (!text || !text.trim()) {
    throw new Error(
      '[Empty Payload] [fetchWebcastSignatureFromProvider] Harici HTTP imzalama sunucusu boş yanıt döndürdü.'
    );
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      '[fetchWebcastSignatureFromProvider] Harici HTTP imzalama sunucusu geçerli JSON döndürmedi.'
    );
  }

  if (json?.ok === false || json?.error) {
    throw new Error(
      `[fetchWebcastSignatureFromProvider] HTTP imzalama hatası: ${json.error || json.message || 'Unknown error'}`
    );
  }

  const resObj =
    json?.response && typeof json.response === 'object'
      ? json.response
      : json?.data && typeof json.data === 'object'
      ? json.data
      : json;

  const explicitTokens = collectTokenFields(resObj);
  let signedUrl = String(
    resObj?.signedUrl || resObj?.signed_url || resObj?.url || ''
  ).trim();

  // Support token-only responses (e.g. nglmercer/tiktok-signer returning { X-Bogus, X-Gnarly, msToken, navigator })
  if (!signedUrl && Object.keys(explicitTokens).length > 0) {
    try {
      const rebuilt = new URL(cleanUrl);
      for (const [k, v] of Object.entries(explicitTokens)) {
        if (v) rebuilt.searchParams.set(k, v);
      }
      signedUrl = rebuilt.toString();
    } catch {
      signedUrl = '';
    }
  }

  if (!signedUrl) {
    throw new Error(
      '[Empty Payload] [fetchWebcastSignatureFromProvider] Harici HTTP imzalama yanıtında signedUrl eksik.'
    );
  }

  let parsedSigned;
  try {
    parsedSigned = new URL(signedUrl);
  } catch {
    throw new Error(
      '[fetchWebcastSignatureFromProvider] Harici HTTP imzalama yanıtındaki signedUrl geçerli bir URL değil.'
    );
  }
  if (parsedSigned.protocol !== 'http:' && parsedSigned.protocol !== 'https:') {
    throw new Error(
      '[fetchWebcastSignatureFromProvider] signedUrl yalnızca http:// veya https:// olabilir.'
    );
  }

  const extractedTokens = extractSignatureTokensFromUrl(signedUrl);
  const mergedTokens = {};
  for (const [k, v] of Object.entries({ ...extractedTokens, ...explicitTokens })) {
    if (v !== undefined && v !== null && String(v).trim()) {
      mergedTokens[k] = String(v).trim();
    }
  }

  if (Object.keys(mergedTokens).length < 1) {
    throw new Error(
      '[Empty Payload] [fetchWebcastSignatureFromProvider] İmzalı URL içinde hiçbir TikTok imza tokenı (X-Bogus / X-Gnarly / msToken) üretilmedi.'
    );
  }

  const resolvedUa = String(
    resObj?.userAgent ||
      resObj?.user_agent ||
      resObj?.navigator?.user_agent ||
      resObj?.navigator?.userAgent ||
      userAgent ||
      webClient?.clientHeaders?.['User-Agent'] ||
      ''
  ).trim();

  if (resObj?.cookies && webClient?.cookieJar?.processSetCookieHeader) {
    try {
      if (typeof resObj.cookies === 'string') {
        await webClient.cookieJar.processSetCookieHeader(resObj.cookies);
      } else if (Array.isArray(resObj.cookies)) {
        const cookieStrings = resObj.cookies
          .map((item) => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object' && item.name && item.value !== undefined) {
              return `${item.name}=${item.value}`;
            }
            return '';
          })
          .filter(Boolean);
        if (cookieStrings.length > 0) {
          await webClient.cookieJar.processSetCookieHeader(cookieStrings);
        }
      }
    } catch {
      // ignore malformed optional cookie forwarding
    }
  }

  return {
    code: typeof json?.code === 'number' ? json.code : 200,
    message: typeof json?.message === 'string' ? json.message : 'ok',
    response: {
      signedUrl,
      userAgent: resolvedUa || undefined,
      browserName: resObj?.browserName,
      browserVersion: resObj?.browserVersion,
      tokens: mergedTokens,
      requestHeaders:
        resObj?.requestHeaders && typeof resObj.requestHeaders === 'object'
          ? resObj.requestHeaders
          : undefined,
      cookies: Array.isArray(resObj?.cookies) ? resObj.cookies : undefined,
    },
  };
}

let cachedOriginalConnectorState = null;

/**
 * Configures tiktok-live-connector RouteConfig & Euler fallback guards cleanly:
 * - Never calls Euler's Business-only /webcast/sign_url unless ALLOW_EULER_BUSINESS_SIGN=true + SIGN_API_KEY
 * - Never silently falls back to Euler when a custom signer or DISABLE_EULER=true is selected
 * - Routes RouteConfig.fetchWebcastSignatureFromProvider to HTTP_SIGN_SERVER_URL (or tiktok-signer) when configured
 * - Routes RouteConfig.fetchSignedWebSocketFromProvider to WS_SIGN_SERVER_URL / SIGN_SERVER_URL, or HTTP-signed im/fetch when custom HTTP signer is active without a WS proxy
 * - Routes RouteConfig.fetchRoomGifts directly to TikTok gift/list/ without Euler Business when no HTTP signer exists
 */
export function configureTikTokConnectorRoutes(mod, env = process.env, deps = {}) {
  const config = resolveSignerConfiguration(env);
  const fetchImpl = deps.fetchImpl || fetch;

  if (!mod || !mod.RouteConfig) {
    return config;
  }

  if (!cachedOriginalConnectorState) {
    cachedOriginalConnectorState = {
      fetchSignedWebSocketFromProvider: mod.RouteConfig.fetchSignedWebSocketFromProvider,
      fetchWebcastSignatureFromProvider: mod.RouteConfig.fetchWebcastSignatureFromProvider,
      fetchRoomGifts: mod.RouteConfig.fetchRoomGifts,
      skipRoomIdEuler: mod.RoomIdRouteConfig?.skipFetchRoomIdFromEulerRoute ?? false,
      skipIsLiveEuler: mod.IsLiveRouteConfig?.skipFetchRoomIdFromEulerRoute ?? false,
    };
  }

  // 1. Room ID / IsLive Euler fallback guards
  if (mod.RoomIdRouteConfig) {
    mod.RoomIdRouteConfig.skipFetchRoomIdFromEulerRoute = config.eulerFallbackDisabled
      ? true
      : cachedOriginalConnectorState.skipRoomIdEuler;
  }
  if (mod.IsLiveRouteConfig) {
    mod.IsLiveRouteConfig.skipFetchRoomIdFromEulerRoute = config.eulerFallbackDisabled
      ? true
      : cachedOriginalConnectorState.skipIsLiveEuler;
  }

  // 2. HTTP URL Signing Route (`RouteConfig.fetchWebcastSignatureFromProvider`)
  if (config.httpSignUrl) {
    mod.RouteConfig.fetchWebcastSignatureFromProvider = async ({
      url,
      method,
      userAgent,
      webClient,
    }) =>
      requestCustomWebcastSignature({
        httpSignUrl: config.httpSignUrl,
        signerToken: config.signerToken,
        signerHttpMethod: config.signerHttpMethod,
        timeoutMs: config.timeoutMs,
        fetchImpl,
        url,
        method,
        userAgent,
        webClient,
      });
  } else if (config.allowEulerBusinessSign && !config.eulerFallbackDisabled) {
    mod.RouteConfig.fetchWebcastSignatureFromProvider =
      cachedOriginalConnectorState.fetchWebcastSignatureFromProvider;
  } else {
    // Prevent accidental hits to Euler's Business-plan `/webcast/sign_url`
    mod.RouteConfig.fetchWebcastSignatureFromProvider = async () => {
      throw new Error(
        '[Empty Payload] [fetchWebcastSignatureFromProvider] Harici HTTP imzalama sunucusu (HTTP_SIGN_SERVER_URL) yapılandırılmadığı için EulerStream Business (/webcast/sign_url) isteği devre dışı bırakıldı.'
      );
    };
  }

  // 3. WebSocket Initial Fetch/Sign Route (`RouteConfig.fetchSignedWebSocketFromProvider`)
  if (config.wsSignUrl) {
    mod.RouteConfig.fetchSignedWebSocketFromProvider = async ({
      roomId,
      cursor,
      useMobile,
      country,
      webClient,
    }) =>
      requestCustomSignedWebSocket({
        wsSignUrl: config.wsSignUrl,
        signerToken: config.signerToken,
        timeoutMs: config.timeoutMs,
        deserializeMessage: mod.deserializeMessage,
        fetchImpl,
        roomId,
        cursor,
        useMobile,
        country,
        userAgent: webClient?.clientHeaders?.['User-Agent'],
      });
  } else if (
    config.httpSignUrl &&
    (config.eulerFallbackDisabled ||
      config.activeSignerProvider === 'tiktok_signer' ||
      config.activeSignerProvider === 'custom_http')
  ) {
    // Direct HTTP-signed TikTok webcast/im/fetch/ handshake (zero Euler dependency)
    mod.RouteConfig.fetchSignedWebSocketFromProvider = async ({
      roomId,
      cursor,
      webClient,
    }) => {
      if (!webClient || typeof webClient.request !== 'function') {
        throw new Error(
          '[fetchSignedWebSocketFromProvider] HTTP imzalayıcı modu için webClient bulunamadı.'
        );
      }
      const webcastHost = webClient?._webcastWebConfig?.TIKTOK_HOST_WEBCAST || 'webcast.tiktok.com';
      const resp = await webClient.request({
        host: webcastHost,
        path: 'webcast/im/fetch/',
        searchParams: {
          ...webClient.clientParams,
          room_id: String(roomId || webClient.roomId || ''),
          cursor: String(cursor || ''),
          fetch_rule: '1',
          last_rtt: '0',
          resp_content_type: 'protobuf',
        },
        signRequest: true,
        responseType: 'buffer',
      });
      const bodyBuf = Buffer.isBuffer(resp?.body)
        ? resp.body
        : Buffer.from(resp?.body || '');
      if (!bodyBuf.length) {
        throw new Error(
          '[Empty Payload] [fetchSignedWebSocketFromProvider] TikTok webcast/im/fetch/ boş protobuf döndürdü.'
        );
      }
      const fetchResult = mod.deserializeMessage('ProtoMessageFetchResult', bodyBuf);
      if (!fetchResult?.cursor || !/^wss?:\/\//i.test(String(fetchResult?.pushServer || ''))) {
        throw new Error(
          '[Empty Payload] [fetchSignedWebSocketFromProvider] TikTok webcast/im/fetch/ geçerli cursor/pushServer döndürmedi.'
        );
      }
      const rawSetCookie = resp?.headers?.['set-cookie'];
      const headerCookie = Array.isArray(rawSetCookie)
        ? rawSetCookie.join('; ')
        : typeof rawSetCookie === 'string'
        ? rawSetCookie
        : '';
      const jarCookie = (await webClient.cookieJar?.getCookieString?.()) || '';
      const cookieHeader = headerCookie || jarCookie;
      if (!cookieHeader.trim()) {
        throw new Error(
          '[Empty Cookies] [fetchSignedWebSocketFromProvider] İmzalı webcast/im/fetch/ yanıtında TikTok oturum çerezi bulunamadı.'
        );
      }
      return {
        fetchResult,
        fetchResultCookieHeader: cookieHeader.trim(),
        fetchResultRoomId: roomId ? String(roomId) : undefined,
      };
    };
  } else if (config.eulerFallbackDisabled) {
    mod.RouteConfig.fetchSignedWebSocketFromProvider = async () => {
      throw new Error(
        '[fetchSignedWebSocketFromProvider] EulerStream devre dışı iken harici imzalama sunucusu (WS_SIGN_SERVER_URL, HTTP_SIGN_SERVER_URL veya SIGN_SERVER_URL) yapılandırılmadı.'
      );
    };
  } else {
    mod.RouteConfig.fetchSignedWebSocketFromProvider =
      cachedOriginalConnectorState.fetchSignedWebSocketFromProvider;
  }

  // 4. Room Gifts Route (`RouteConfig.fetchRoomGifts`)
  mod.RouteConfig.fetchRoomGifts = async ({ webClient, roomId = webClient?.roomId }) => {
    if (!roomId) {
      throw new Error('[fetchRoomGiftsRoute] Missing roomId.');
    }
    const useSigned = Boolean(
      config.httpSignUrl || (config.allowEulerBusinessSign && !config.eulerFallbackDisabled)
    );
    try {
      const res = await webClient.getJsonObjectFromWebcastApi(
        'gift/list/',
        {
          ...webClient.clientParams,
          room_id: roomId,
        },
        useSigned
      );
      if (res && Array.isArray(res?.data?.gifts)) {
        return res.data.gifts;
      }
      if (!useSigned) {
        return [];
      }
      throw new Error(`Unexpected gift/list/ response status_code=${res?.status_code}`);
    } catch (err) {
      if (useSigned) {
        throw err;
      }
      console.warn(
        `[NUR-I DUA Relay] gift/list/ kataloğu alınamadı (canlı yayın bağlantısı devam ediyor): ${err instanceof Error ? err.message : String(err)}`
      );
      return [];
    }
  };

  return config;
}

