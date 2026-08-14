/**
 * features/gridBypassPage.js — 라이브 재생 메타데이터의 P2P 전용 경로를 직접 HLS 경로로 우회한다.
 *
 * 실행 컨텍스트: MAIN world(페이지) — 치지직 앱 번들보다 먼저 document_start에 로드된다.
 * 동작 위치: /live/* 라우트에서 JSON.parse로 해석되는 공식 livePlaybackJson 구조.
 * 하는 일: 직접 HLS master(path)가 확인된 HLS/LLHLS media와 encodingTrack에서 p2pPath 계열 필드를
 *   제거하고 meta.p2p를 false로 맞춰, 같은 응답의 직접 HLS variant를 일반 트랙으로 사용하게 한다.
 *   네트워크를 새로 요청하거나 재생 URL을 만들지 않는다. 2026-08-13 live-detail 실측에서 확인한
 *   livecloud.pstatic.net, nvelop-livecloud.pstatic.net, ex-nlive-streaming.navercdn.com HTTPS master만 처리한다.
 * 옵션 키: 없음 — 활성화 여부(gridBypassEnabled)는 isolated world의 gridBypass.js가 STATE_ATTR로 전달한다.
 * DOM 마커: document.documentElement의 data-betterchzzk-grid-bypass-state/ready 속성.
 */
(() => {
    "use strict";

    const INSTALL_FLAG = "__betterChzzkGridBypassPageInstalled";
    const WRAP_FLAG = "__betterChzzkGridBypassParseWrapped";
    const NATIVE_PARSE_FLAG = "__betterChzzkGridBypassNativeParse";
    const STATE_ATTR = "data-betterchzzk-grid-bypass-state";
    const READY_ATTR = "data-betterchzzk-grid-bypass-page-ready";
    const LIVE_ROUTE_RE = /^\/live(?:\/|$)/;
    const DIRECT_HLS_HOSTS = new Set([
        "livecloud.pstatic.net",
        "nvelop-livecloud.pstatic.net",
        "ex-nlive-streaming.navercdn.com",
    ]);
    const SUPPORTED_MEDIA_IDS = new Set(["HLS", "LLHLS"]);
    const P2P_FIELDS = ["p2pPath", "p2pPathUrlEncoding"];
    const documentRoot = document.documentElement;
    const nativeParse = JSON.parse;

    if (window[INSTALL_FLAG] || typeof nativeParse !== "function" || nativeParse[WRAP_FLAG]) return;

    function isEnabled() {
        if (!LIVE_ROUTE_RE.test(location.pathname)) return false;
        return documentRoot?.getAttribute(STATE_ATTR) === "1";
    }

    function hasTrustedDirectHlsPath(media) {
        if (media?.protocol !== "HLS" || !SUPPORTED_MEDIA_IDS.has(media?.mediaId)) return false;
        if (typeof media.path !== "string" || !media.path) return false;

        try {
            const url = new URL(media.path, location.href);
            return url.protocol === "https:" && DIRECT_HLS_HOSTS.has(url.hostname) && url.pathname.endsWith(".m3u8");
        } catch (_) {
            return false;
        }
    }

    function omitP2PFields(record) {
        if (!record || typeof record !== "object" || Array.isArray(record)) return record;
        if (!P2P_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(record, field))) return record;

        const next = { ...record };
        for (const field of P2P_FIELDS) delete next[field];
        return next;
    }

    function rewriteMedia(media) {
        if (!hasTrustedDirectHlsPath(media)) return media;

        let next = omitP2PFields(media);
        if (!Array.isArray(media.encodingTrack)) return next;

        const encodingTrack = media.encodingTrack.map(omitP2PFields);
        if (encodingTrack.every((track, index) => track === media.encodingTrack[index])) return next;
        if (next === media) next = { ...media };
        return { ...next, encodingTrack };
    }

    function rewritePlaybackJson(value) {
        if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.media)) return value;

        const media = value.media.map(rewriteMedia);
        if (media.every((entry, index) => entry === value.media[index])) return value;

        const meta =
            value.meta && typeof value.meta === "object" && !Array.isArray(value.meta) && value.meta.p2p === true
                ? { ...value.meta, p2p: false }
                : value.meta;
        return meta === value.meta ? { ...value, media } : { ...value, meta, media };
    }

    const wrappedParse = function (...args) {
        const value = nativeParse.apply(this, args);
        if (!isEnabled() || (args.length > 1 && typeof args[1] === "function")) return value;
        return rewritePlaybackJson(value);
    };

    try {
        Object.defineProperty(wrappedParse, WRAP_FLAG, { value: true });
        Object.defineProperty(wrappedParse, NATIVE_PARSE_FLAG, { value: nativeParse });
        JSON.parse = wrappedParse;
        Object.defineProperty(window, INSTALL_FLAG, { value: true });
        documentRoot?.setAttribute(READY_ATTR, "1");
    } catch (_) {
        documentRoot?.setAttribute(READY_ATTR, "unsupported");
    }
})();
