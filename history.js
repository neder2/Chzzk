const STORAGE_KEY = "betterChzzkLiveWatchHistory";
const API_BASE = "https://api.chzzk.naver.com/service/v1/channels";
const VIDEO_DETAIL_API_BASE = "https://api.chzzk.naver.com/service/v2/videos";
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MIN_WATCH_SECONDS = 60;
const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const VIDEO_PAGE_SIZE = 30;
const REPLAY_LOOKUP_MAX_PAGES = 80;
const FETCH_TIMEOUT_MS = 8000;
const START_EXACT_TOLERANCE_MS = 20 * 60 * 1000;
const START_LOOSE_TOLERANCE_MS = 3 * 60 * 60 * 1000;
const TARGET_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const TITLE_HISTORY_MAX = 20;
const MAX_REPLAY_LOOKUP_CACHE_ENTRIES = 80;

const storage = globalThis.chrome?.storage?.local;

const noticeEl = document.getElementById("notice");
const totalWatchTimeEl = document.getElementById("totalWatchTime");
const totalLiveCountEl = document.getElementById("totalLiveCount");
const monthWatchTimeEl = document.getElementById("monthWatchTime");
const calendarTitleEl = document.getElementById("calendarTitle");
const weekdaysEl = document.getElementById("weekdays");
const calendarDaysEl = document.getElementById("calendarDays");
const calendarFootEl = document.getElementById("calendarFoot");
const listDescriptionEl = document.getElementById("listDescription");
const historyListEl = document.getElementById("historyList");
const historySearchEl = document.getElementById("historySearch");
const prevMonthButton = document.getElementById("prevMonth");
const calendarRefreshButton = document.getElementById("calendarRefresh");
const nextMonthButton = document.getElementById("nextMonth");
const refreshButton = document.getElementById("refresh");
const clearHistoryButton = document.getElementById("clearHistory");
const selectVisibleHistoryEl = document.getElementById("selectVisibleHistory");
const selectionStatusEl = document.getElementById("selectionStatus");
const deleteSelectedHistoryButton = document.getElementById("deleteSelectedHistory");
const messageEl = document.getElementById("message");

let entries = [];
let selectedYear = 0;
let selectedMonth = 0;
let selectedDateKey = "";
let hideMessageTimer = 0;
let suppressNextStorageChange = false;
const selectedEntryIds = new Set();
const expandedEntryIds = new Set();
const replayLookupCache = new Map();
const resolvingReplayEntryIds = new Set();

function compactSpaces(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function pickString(...values) {
    for (const value of values) {
        const text = compactSpaces(value);
        if (text) return text;
    }
    return "";
}

function cleanTitle(value) {
    return compactSpaces(value)
        .replace(/\s*[-|]\s*CHZZK.*$/i, "")
        .replace(/\s*[-|]\s*치지직.*$/i, "")
        .trim();
}

function trimMapToSize(map, maxSize) {
    while (map.size > maxSize) {
        const oldestKey = map.keys().next().value;
        if (oldestKey === undefined) break;
        map.delete(oldestKey);
    }
}

function touchMapEntry(map, key, value, maxSize) {
    map.delete(key);
    map.set(key, value);
    trimMapToSize(map, maxSize);
    return value;
}

function normalizeTitleHistory(value) {
    const rows = Array.isArray(value) ? value : [];
    const byTitle = new Map();

    for (const row of rows) {
        let title = "";
        let firstSeenAt = 0;
        let lastSeenAt = 0;

        if (typeof row === "string") {
            title = cleanTitle(row);
        } else if (row && typeof row === "object") {
            title = cleanTitle(pickString(row.title, row.name, row.value));
            firstSeenAt = Number(row.firstSeenAt) || Number(row.seenAt) || Number(row.createdAt) || 0;
            lastSeenAt = Number(row.lastSeenAt) || Number(row.updatedAt) || firstSeenAt;
        }

        if (!title || title === "제목 없는 라이브") continue;
        if (!firstSeenAt) firstSeenAt = lastSeenAt || Date.now();
        if (!lastSeenAt) lastSeenAt = firstSeenAt;

        const existing = byTitle.get(title);
        if (existing) {
            existing.firstSeenAt = Math.min(existing.firstSeenAt, firstSeenAt);
            existing.lastSeenAt = Math.max(existing.lastSeenAt, lastSeenAt);
        } else {
            byTitle.set(title, { title, firstSeenAt, lastSeenAt });
        }
    }

    return Array.from(byTitle.values())
        .sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.lastSeenAt - b.lastSeenAt)
        .slice(-TITLE_HISTORY_MAX);
}

function addTitleHistory(target, title, firstSeenAt = Date.now(), lastSeenAt = firstSeenAt) {
    if (!target) return;

    const clean = cleanTitle(title);
    if (!clean || clean === "제목 없는 라이브") return;

    const first = Number(firstSeenAt) || Date.now();
    const last = Number(lastSeenAt) || first;
    const history = normalizeTitleHistory(target.titleHistory);
    const existing = history.find((row) => row.title === clean);

    if (existing) {
        existing.firstSeenAt = Math.min(existing.firstSeenAt, first);
        existing.lastSeenAt = Math.max(existing.lastSeenAt, last);
    } else {
        history.push({ title: clean, firstSeenAt: first, lastSeenAt: last });
    }

    target.titleHistory = history
        .sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.lastSeenAt - b.lastSeenAt)
        .slice(-TITLE_HISTORY_MAX);
}

function getEntryTitleRows(entry) {
    const target = { titleHistory: normalizeTitleHistory(entry?.titleHistory) };
    addTitleHistory(target, entry?.title, entry?.firstWatchedAt || entry?.lastWatchedAt);
    return target.titleHistory || [];
}

function getEntryTitles(entry) {
    return getEntryTitleRows(entry).map((row) => row.title);
}

function getEntryTitleNorms(entry) {
    return getEntryTitles(entry).map(normalizeForMatch).filter(Boolean);
}

function getReplayVideoNo(entry) {
    return pickString(entry?.replayVideoNo, entry?.videoNo);
}

function getReplayUrl(entry) {
    const videoNo = getReplayVideoNo(entry);
    return videoNo ? `https://chzzk.naver.com/video/${encodeURIComponent(videoNo)}` : "";
}

function normalizeForMatch(value) {
    return compactSpaces(value).toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function getKstParts(ms = Date.now()) {
    const date = new Date(Number(ms) + KST_OFFSET_MS);
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
    };
}

function formatDateKey(parts) {
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function formatMonthKey(year, month) {
    return `${year}-${String(month).padStart(2, "0")}`;
}

function formatDateLabel(dateKey) {
    const parts = String(dateKey).split("-").map(Number);
    if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) return dateKey;
    return `${parts[0]}.${String(parts[1]).padStart(2, "0")}.${String(parts[2]).padStart(2, "0")}`;
}

function formatKstDateTime(ms) {
    const parts = getKstParts(ms);
    const date = new Date(Number(ms) + KST_OFFSET_MS);
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");
    return `${parts.year}.${String(parts.month).padStart(2, "0")}.${String(parts.day).padStart(2, "0")} ${hours}:${minutes}`;
}

function parseChzzkDate(value) {
    if (!value) return null;
    if (typeof value === "number") {
        const ms = value > 100000000000 ? value : value * 1000;
        const date = new Date(ms);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    const raw = String(value).trim();
    if (!raw) return null;
    const isoLike = raw.includes("T") ? raw : raw.replace(" ", "T");
    const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(isoLike) ? isoLike : `${isoLike}+09:00`;
    const date = new Date(withZone);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatDuration(seconds) {
    const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    const totalMinutes = Math.round(totalSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours <= 0 && totalMinutes <= 0) return `${totalSeconds}초`;
    if (hours <= 0) return `${totalMinutes}분`;
    if (minutes <= 0) return `${hours}시간`;
    return `${hours}시간 ${minutes}분`;
}

function formatCalendarDuration(seconds) {
    const totalMinutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
    if (totalMinutes < 60) return `${totalMinutes}m`;

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours}h+` : `${hours}h`;
}

function normalizeDailySeconds(value) {
    return Object.fromEntries(
        Object.entries(value && typeof value === "object" ? value : {})
            .map(([key, seconds]) => [key, Math.max(0, Number(seconds) || 0)])
            .filter(([, seconds]) => seconds > 0)
    );
}

function normalizeSessionDetails(row, fallbackEntry) {
    const rawSessions = Array.isArray(row.sessionDetails) ? row.sessionDetails : [];
    const hasRawSessions = Array.isArray(row.sessionDetails);
    const sessions = rawSessions
        .filter((session) => session && typeof session === "object")
        .map((session) => {
            const enteredAt = Number(session.enteredAt) || Number(session.startedAt) || 0;
            const leftAt = Number(session.leftAt) || Number(session.endedAt) || Number(session.lastWatchedAt) || 0;
            const watchedSeconds = Math.max(0, Number(session.watchedSeconds) || 0);
            return {
                id: pickString(session.id) || `${enteredAt}:${leftAt}`,
                title: pickString(session.title),
                enteredAt,
                leftAt,
                watchedSeconds,
                dailySeconds: normalizeDailySeconds(session.dailySeconds),
                closed: session.closed === true,
                legacy: false,
            };
        })
        .filter((session) => session.id && session.enteredAt > 0 && session.watchedSeconds >= MIN_WATCH_SECONDS);

    if (sessions.length) {
        return sessions.sort((a, b) => b.enteredAt - a.enteredAt);
    }

    if (hasRawSessions || !fallbackEntry || fallbackEntry.watchedSeconds < MIN_WATCH_SECONDS) return [];
    return [{
        id: `legacy:${fallbackEntry.id}`,
        title: fallbackEntry.title || "",
        enteredAt: fallbackEntry.firstWatchedAt || fallbackEntry.lastWatchedAt,
        leftAt: fallbackEntry.lastWatchedAt || fallbackEntry.firstWatchedAt,
        watchedSeconds: fallbackEntry.watchedSeconds,
        dailySeconds: { ...fallbackEntry.dailySeconds },
        closed: true,
        legacy: true,
    }];
}

function sumSessionSeconds(sessionDetails) {
    return (sessionDetails || []).reduce((sum, session) => sum + Math.max(0, Number(session.watchedSeconds) || 0), 0);
}

function buildDailySecondsFromSessions(sessionDetails) {
    const dailySeconds = {};
    for (const session of sessionDetails || []) {
        const dailyEntries = Object.entries(session.dailySeconds || {});
        if (dailyEntries.length) {
            for (const [dateKey, seconds] of dailyEntries) {
                const value = Math.max(0, Number(seconds) || 0);
                if (value <= 0) continue;
                dailySeconds[dateKey] = (Number(dailySeconds[dateKey]) || 0) + value;
            }
            continue;
        }

        if (session.enteredAt > 0 && session.watchedSeconds > 0) {
            const dateKey = formatDateKey(getKstParts(session.enteredAt));
            dailySeconds[dateKey] = (Number(dailySeconds[dateKey]) || 0) + session.watchedSeconds;
        }
    }
    return dailySeconds;
}

function getSessionFirstWatchedAt(sessionDetails) {
    const values = (sessionDetails || []).map((session) => Number(session.enteredAt) || 0).filter((value) => value > 0);
    return values.length ? Math.min(...values) : 0;
}

function getSessionLastWatchedAt(sessionDetails) {
    const values = (sessionDetails || [])
        .map((session) => Number(session.leftAt) || Number(session.enteredAt) || 0)
        .filter((value) => value > 0);
    return values.length ? Math.max(...values) : 0;
}

function normalizeHistory(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const rawEntries = Array.isArray(source.entries)
        ? source.entries
        : source.entries && typeof source.entries === "object"
            ? Object.values(source.entries)
            : [];

    return rawEntries
        .filter((row) => row && typeof row === "object")
        .map((row) => {
            const id = pickString(row.id);
            const entry = {
                id,
                channelId: pickString(row.channelId),
                liveId: pickString(row.liveId),
                replayVideoNo: pickString(row.replayVideoNo, row.videoNo, row.videoId),
                title: pickString(row.title) || "제목 없는 라이브",
                titleHistory: normalizeTitleHistory(row.titleHistory),
                channelName: pickString(row.channelName) || "알 수 없는 채널",
                liveOpenDate: pickString(row.liveOpenDate),
                liveUrl: pickString(row.liveUrl),
                firstWatchedAt: Number(row.firstWatchedAt) || 0,
                lastWatchedAt: Number(row.lastWatchedAt) || 0,
                watchedSeconds: Math.max(0, Number(row.watchedSeconds) || 0),
                sessions: Math.max(1, Math.round(Number(row.sessions) || 1)),
                dailySeconds: normalizeDailySeconds(row.dailySeconds),
            };
            entry.sessionDetails = normalizeSessionDetails(row, entry);
            entry.watchedSeconds = sumSessionSeconds(entry.sessionDetails);
            entry.dailySeconds = buildDailySecondsFromSessions(entry.sessionDetails);
            entry.firstWatchedAt = getSessionFirstWatchedAt(entry.sessionDetails) || entry.firstWatchedAt;
            entry.lastWatchedAt = getSessionLastWatchedAt(entry.sessionDetails) || entry.lastWatchedAt;
            entry.sessions = entry.sessionDetails.length;
            for (const session of entry.sessionDetails) {
                addTitleHistory(entry, session.title, session.enteredAt, session.leftAt || session.enteredAt);
            }
            addTitleHistory(entry, entry.title, entry.firstWatchedAt || entry.lastWatchedAt);
            return entry;
        })
        .filter((entry) => entry.id && entry.sessionDetails.length > 0)
        .sort((a, b) => b.lastWatchedAt - a.lastWatchedAt);
}

function storageGet(key) {
    return new Promise((resolve, reject) => {
        if (!storage) {
            resolve({});
            return;
        }
        storage.get(key, (data) => {
            const error = globalThis.chrome?.runtime?.lastError;
            if (error) reject(error);
            else resolve(data || {});
        });
    });
}

function storageRemove(key) {
    return new Promise((resolve, reject) => {
        if (!storage) {
            resolve();
            return;
        }
        storage.remove(key, () => {
            const error = globalThis.chrome?.runtime?.lastError;
            if (error) reject(error);
            else resolve();
        });
    });
}

function storageSet(value) {
    return new Promise((resolve, reject) => {
        if (!storage) {
            resolve();
            return;
        }
        storage.set(value, () => {
            const error = globalThis.chrome?.runtime?.lastError;
            if (error) reject(error);
            else resolve();
        });
    });
}

function fetchJsonWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    return fetch(url, { ...options, signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }).finally(() => {
        clearTimeout(timer);
    });
}

function getRawEntryId(row, fallback = "") {
    return pickString(row?.id) || pickString(fallback);
}

function updateRawHistoryEntry(raw, entryId, updater) {
    const source = raw && typeof raw === "object" ? { ...raw } : {};
    const rawEntries = source.entries;

    if (Array.isArray(rawEntries)) {
        source.entries = rawEntries.map((row) => {
            if (getRawEntryId(row) !== entryId) return row;
            const next = { ...(row && typeof row === "object" ? row : {}) };
            updater(next);
            return next;
        });
    } else if (rawEntries && typeof rawEntries === "object") {
        source.entries = { ...rawEntries };
        for (const [key, row] of Object.entries(source.entries)) {
            if (getRawEntryId(row, key) !== entryId) continue;
            const next = { ...(row && typeof row === "object" ? row : {}) };
            updater(next);
            source.entries[key] = next;
        }
    }

    source.version = Number(source.version) || 1;
    source.updatedAt = Date.now();
    return source;
}

function removeEntryIdsFromRawHistory(raw, ids) {
    const source = raw && typeof raw === "object" ? { ...raw } : {};
    const rawEntries = source.entries;

    if (Array.isArray(rawEntries)) {
        source.entries = rawEntries.filter((row) => !ids.has(getRawEntryId(row)));
    } else if (rawEntries && typeof rawEntries === "object") {
        source.entries = Object.fromEntries(
            Object.entries(rawEntries).filter(([key, row]) => !ids.has(getRawEntryId(row, key)))
        );
    } else {
        source.entries = {};
    }

    source.version = Number(source.version) || 1;
    source.updatedAt = Date.now();
    return source;
}

function pickArray(obj) {
    if (!obj || typeof obj !== "object") return null;
    if (Array.isArray(obj)) return obj;
    for (const key of ["data", "videos", "list", "items", "content"]) {
        if (Array.isArray(obj[key])) return obj[key];
    }
    for (const value of Object.values(obj)) {
        if (Array.isArray(value) && value.length && typeof value[0] === "object") return value;
    }
    return null;
}

function extractReplayVideos(json) {
    const content = json?.content ?? json;
    const rows = pickArray(content);
    if (!rows) return [];

    return rows.map((row) => {
        const videoNo = row.videoNo ?? row.videoId ?? row.id;
        if (!videoNo) return null;

        const startText = row.liveOpenDate || row.openDate || row.broadcastOpenDate || "";
        const endText = row.publishDateAt || row.publishDate || row.createdDate || "";
        return {
            videoNo: String(videoNo),
            liveId: pickString(row.liveId, row.liveNo, row.live?.liveId, row.live?.liveNo),
            type: pickString(row.videoType, row.type),
            title: pickString(row.videoTitle, row.title, row.liveTitle),
            titleNorm: normalizeForMatch(pickString(row.videoTitle, row.title, row.liveTitle)),
            duration: Number(row.duration),
            startedAt: parseChzzkDate(startText),
            endedAt: parseChzzkDate(endText),
            publishDate: parseChzzkDate(endText),
        };
    }).filter(Boolean);
}

function replayOnly(video) {
    return !video.type || video.type.toUpperCase() === "REPLAY";
}

function getVideoStartMs(video) {
    const startMs = video?.startedAt?.getTime?.();
    return Number.isFinite(startMs) ? startMs : null;
}

function getVideoEndMs(video) {
    const endMs = video?.endedAt?.getTime?.();
    if (Number.isFinite(endMs)) return endMs;

    const startMs = getVideoStartMs(video);
    if (startMs !== null && Number.isFinite(video.duration) && video.duration > 0) {
        return startMs + video.duration * 1000;
    }

    const publishMs = video?.publishDate?.getTime?.();
    return Number.isFinite(publishMs) ? publishMs : null;
}

function getEntryTargetMs(entry) {
    const openMs = parseChzzkDate(entry?.liveOpenDate)?.getTime();
    if (Number.isFinite(openMs)) return openMs;

    const first = Number(entry?.firstWatchedAt) || 0;
    if (first > 0) return first;

    const last = Number(entry?.lastWatchedAt) || 0;
    return last > 0 ? last : 0;
}

async function fetchVideoPage(channelId, page) {
    const params = new URLSearchParams({
        sortType: "LATEST",
        pagingType: "PAGE",
        page: String(page),
        size: String(VIDEO_PAGE_SIZE),
    });
    const url = `${API_BASE}/${encodeURIComponent(channelId)}/videos?${params.toString()}`;
    return fetchJsonWithTimeout(url, {
        credentials: "include",
        headers: { Accept: "application/json" },
    });
}

async function fetchVideoDetail(videoNo) {
    const url = `${VIDEO_DETAIL_API_BASE}/${encodeURIComponent(videoNo)}`;
    const json = await fetchJsonWithTimeout(url, {
        credentials: "include",
        headers: { Accept: "application/json" },
    });
    return json?.content || null;
}

function mergeVideoDetail(video, detail) {
    if (!video || !detail) return video;

    video.liveId = video.liveId || pickString(detail.liveId, detail.liveNo, detail.live?.liveId, detail.live?.liveNo);
    video.title = pickString(video.title, detail.videoTitle, detail.title, detail.liveTitle);
    video.titleNorm = normalizeForMatch(video.title);

    const duration = Number(detail.duration);
    if (Number.isFinite(duration) && duration > 0) video.duration = duration;

    const startText = detail.liveOpenDate || detail.openDate || detail.broadcastOpenDate || "";
    const endText = detail.publishDateAt || detail.publishDate || detail.createdDate || "";
    const startedAt = parseChzzkDate(startText);
    const endedAt = parseChzzkDate(endText);
    if (startedAt) video.startedAt = startedAt;
    if (endedAt) {
        video.endedAt = endedAt;
        video.publishDate = video.publishDate || endedAt;
    }

    return video;
}

function videoCouldMatchEntry(entry, video) {
    if (!video || !replayOnly(video)) return false;
    if (entry.liveId && video.liveId && entry.liveId === video.liveId) return true;

    const targetMs = getEntryTargetMs(entry);
    const startMs = getVideoStartMs(video);
    const endMs = getVideoEndMs(video);
    if (targetMs > 0 && startMs !== null && Math.abs(startMs - targetMs) <= TARGET_WINDOW_MS) return true;
    if (targetMs > 0 && startMs !== null && endMs !== null && targetMs >= startMs - START_LOOSE_TOLERANCE_MS && targetMs <= endMs + START_LOOSE_TOLERANCE_MS) return true;
    if (targetMs > 0 && startMs === null && endMs !== null && endMs >= targetMs && endMs <= targetMs + TARGET_WINDOW_MS) return true;

    return getEntryTitleNorms(entry).some((entryTitle) => (
        video.titleNorm && (video.titleNorm.includes(entryTitle) || entryTitle.includes(video.titleNorm))
    ));
}

function scoreReplayCandidate(entry, video) {
    let score = 0;

    if (entry.liveId && video.liveId && entry.liveId === video.liveId) score += 1000;

    const targetMs = getEntryTargetMs(entry);
    const startMs = getVideoStartMs(video);
    const endMs = getVideoEndMs(video);
    if (targetMs > 0 && startMs !== null) {
        const diff = Math.abs(startMs - targetMs);
        if (diff <= START_EXACT_TOLERANCE_MS) score += 420;
        else if (diff <= START_LOOSE_TOLERANCE_MS) score += 220;
        else if (diff <= TARGET_WINDOW_MS) score += 80;
    }
    if (targetMs > 0 && startMs !== null && endMs !== null && targetMs >= startMs && targetMs <= endMs + START_LOOSE_TOLERANCE_MS) {
        score += 120;
    }
    if (targetMs > 0 && startMs === null && endMs !== null && endMs >= targetMs && endMs <= targetMs + TARGET_WINDOW_MS) {
        score += 80;
    }

    let titleScore = 0;
    for (const entryTitle of getEntryTitleNorms(entry)) {
        if (!entryTitle || !video.titleNorm) continue;
        if (entryTitle === video.titleNorm) titleScore = Math.max(titleScore, 180);
        else if (video.titleNorm.includes(entryTitle) || entryTitle.includes(video.titleNorm)) {
            titleScore = Math.max(titleScore, 90);
        }
    }
    score += titleScore;

    if (replayOnly(video)) score += 20;
    return score;
}

function shouldStopReplayLookup(entry, videos, page) {
    if (page <= 0) return false;

    const targetMs = getEntryTargetMs(entry);
    if (targetMs <= 0 || !videos.length) return false;

    const oldestComparable = videos
        .map((video) => getVideoEndMs(video) ?? getVideoStartMs(video))
        .filter((ms) => Number.isFinite(ms))
        .sort((a, b) => a - b)[0];

    return Number.isFinite(oldestComparable) && oldestComparable < targetMs - TARGET_WINDOW_MS;
}

async function resolveReplayVideoNo(entry) {
    const cachedVideoNo = getReplayVideoNo(entry);
    if (cachedVideoNo) return cachedVideoNo;
    if (!entry?.channelId) return "";

    const cacheKey = `${entry.id}:${entry.channelId}:${entry.liveId}:${entry.liveOpenDate}:${getEntryTitles(entry).join("|")}`;
    if (replayLookupCache.has(cacheKey)) {
        const cached = replayLookupCache.get(cacheKey);
        touchMapEntry(replayLookupCache, cacheKey, cached, MAX_REPLAY_LOOKUP_CACHE_ENTRIES);
        return cached;
    }

    const promise = (async () => {
        let best = null;

        for (let page = 0; page < REPLAY_LOOKUP_MAX_PAGES; page++) {
            const json = await fetchVideoPage(entry.channelId, page);
            const videos = extractReplayVideos(json).filter(replayOnly);
            if (!videos.length && page === 0) break;

            const candidates = videos.filter((video) => videoCouldMatchEntry(entry, video));
            for (const video of candidates) {
                try {
                    mergeVideoDetail(video, await fetchVideoDetail(video.videoNo));
                } catch (_) {
                    // The list data is still useful if detail lookup is unavailable.
                }

                const score = scoreReplayCandidate(entry, video);
                if (!best || score > best.score) best = { video, score };
                if (score >= 1000) return video.videoNo;
            }

            if (best?.score >= 420 && shouldStopReplayLookup(entry, videos, page)) break;
            if (shouldStopReplayLookup(entry, videos, page)) break;
            if (videos.length < VIDEO_PAGE_SIZE) break;
        }

        return best && best.score >= 220 ? best.video.videoNo : "";
    })();

    const guardedPromise = promise.catch((error) => {
        replayLookupCache.delete(cacheKey);
        throw error;
    });
    touchMapEntry(replayLookupCache, cacheKey, guardedPromise, MAX_REPLAY_LOOKUP_CACHE_ENTRIES);
    return guardedPromise;
}

function getLatestMonthFromEntries(rows) {
    const latest = rows.find((entry) => entry.lastWatchedAt > 0);
    return latest ? getKstParts(latest.lastWatchedAt) : getKstParts();
}

function ensureSelectedMonth({ resetToLatest = false } = {}) {
    if (selectedYear && selectedMonth && !resetToLatest) return;
    const latest = getLatestMonthFromEntries(entries);
    selectedYear = latest.year;
    selectedMonth = latest.month;
}

function getMonthDateKeys(year, month) {
    const monthKey = formatMonthKey(year, month);
    return (entry) => Object.keys(entry.dailySeconds || {}).filter((key) => key.startsWith(monthKey));
}

function getEntrySecondsForMonth(entry, year, month) {
    return getMonthDateKeys(year, month)(entry)
        .reduce((sum, key) => sum + (Number(entry.dailySeconds[key]) || 0), 0);
}

function getEntrySecondsForDate(entry, dateKey) {
    return Math.max(0, Number(entry.dailySeconds?.[dateKey]) || 0);
}

function getSessionSecondsForDate(session, dateKey) {
    const seconds = Math.max(0, Number(session.dailySeconds?.[dateKey]) || 0);
    if (seconds > 0) return seconds;
    if (Object.keys(session.dailySeconds || {}).length) return 0;
    return formatDateKey(getKstParts(session.enteredAt)) === dateKey ? session.watchedSeconds : 0;
}

function getSessionSecondsForMonth(session, year, month) {
    const monthKey = formatMonthKey(year, month);
    const dailyEntries = Object.entries(session.dailySeconds || {});
    if (dailyEntries.length) {
        return dailyEntries
            .filter(([key]) => key.startsWith(monthKey))
            .reduce((sum, [, seconds]) => sum + Math.max(0, Number(seconds) || 0), 0);
    }
    const parts = getKstParts(session.enteredAt);
    return parts.year === year && parts.month === month ? session.watchedSeconds : 0;
}

function getEntrySessionsForScope(entry) {
    return (entry.sessionDetails || [])
        .map((session) => {
            const seconds = selectedDateKey
                ? getSessionSecondsForDate(session, selectedDateKey)
                : getSessionSecondsForMonth(session, selectedYear, selectedMonth);
            return { ...session, scopeSeconds: seconds };
        })
        .filter((session) => session.scopeSeconds > 0)
        .sort((a, b) => b.enteredAt - a.enteredAt);
}

function getMonthEntries() {
    return entries.filter((entry) => getEntrySecondsForMonth(entry, selectedYear, selectedMonth) > 0);
}

function getDayEntries(dateKey) {
    return entries
        .map((entry) => ({ entry, seconds: getEntrySecondsForDate(entry, dateKey) }))
        .filter((row) => row.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds || b.entry.lastWatchedAt - a.entry.lastWatchedAt);
}

function getDayTotals(year, month) {
    const totals = {};
    for (const entry of entries) {
        for (const [dateKey, seconds] of Object.entries(entry.dailySeconds || {})) {
            if (!dateKey.startsWith(formatMonthKey(year, month))) continue;
            totals[dateKey] = (totals[dateKey] || 0) + Math.max(0, Number(seconds) || 0);
        }
    }
    return totals;
}

function getCalendarLevel(seconds) {
    if (seconds >= 5 * 60 * 60) return "3";
    if (seconds >= 2 * 60 * 60) return "2";
    return "1";
}

function shiftSelectedMonth(delta) {
    const index = selectedYear * 12 + (selectedMonth - 1) + delta;
    selectedYear = Math.floor(index / 12);
    selectedMonth = (index % 12) + 1;
    selectedDateKey = "";
    renderAll();
}

function isFutureMonth(year, month) {
    const now = getKstParts();
    return year > now.year || (year === now.year && month > now.month);
}

function appendText(parent, className, text) {
    const el = document.createElement("span");
    el.className = className;
    el.textContent = text;
    parent.appendChild(el);
    return el;
}

function renderWeekdays() {
    if (weekdaysEl.children.length) return;
    const fragment = document.createDocumentFragment();
    for (const label of WEEKDAY_LABELS) {
        const item = document.createElement("span");
        item.className = "history-weekday";
        item.textContent = label;
        fragment.appendChild(item);
    }
    weekdaysEl.appendChild(fragment);
}

function renderCalendar() {
    renderWeekdays();

    const monthKey = formatMonthKey(selectedYear, selectedMonth);
    const totals = getDayTotals(selectedYear, selectedMonth);
    const firstWeekday = new Date(Date.UTC(selectedYear, selectedMonth - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(selectedYear, selectedMonth, 0)).getUTCDate();
    const today = getKstParts();
    const fragment = document.createDocumentFragment();

    calendarTitleEl.textContent = `${selectedYear}.${String(selectedMonth).padStart(2, "0")}`;
    nextMonthButton.disabled = isFutureMonth(selectedYear, selectedMonth + 1);

    for (let i = 0; i < firstWeekday; i++) {
        const empty = document.createElement("span");
        empty.className = "history-day";
        empty.setAttribute("aria-hidden", "true");
        fragment.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${monthKey}-${String(day).padStart(2, "0")}`;
        const seconds = Math.round(totals[dateKey] || 0);
        const dayEntries = getDayEntries(dateKey);
        const item = document.createElement("button");
        item.type = "button";
        item.className = "history-day";
        item.dataset.date = dateKey;
        item.setAttribute("aria-label", `${formatDateLabel(dateKey)} ${seconds > 0 ? formatDuration(seconds) : "시청 기록 없음"}`);

        if (today.year === selectedYear && today.month === selectedMonth && today.day === day) item.dataset.today = "1";
        if (selectedDateKey === dateKey) item.dataset.selected = "1";

        appendText(item, "history-day-number", String(day));
        if (seconds > 0) {
            item.dataset.watched = "1";
            item.dataset.level = getCalendarLevel(seconds);
            appendText(item, "history-day-time", formatCalendarDuration(seconds));
            item.title = [
                `${formatDateLabel(dateKey)} · ${formatDuration(seconds)}`,
                ...dayEntries.slice(0, 5).map((row) => `${row.entry.channelName} · ${formatDuration(row.seconds)}`),
            ].join("\n");
        }

        item.addEventListener("click", () => {
            selectedDateKey = selectedDateKey === dateKey ? "" : dateKey;
            renderAll();
        });
        fragment.appendChild(item);
    }

    calendarDaysEl.replaceChildren(fragment);

    const monthSeconds = getMonthEntries()
        .reduce((sum, entry) => sum + getEntrySecondsForMonth(entry, selectedYear, selectedMonth), 0);
    const selectedText = selectedDateKey ? `${formatDateLabel(selectedDateKey)} 선택됨 · 다시 누르면 해제됩니다.` : "날짜를 선택하면 해당 날짜에 본 라이브만 표시합니다.";
    calendarFootEl.textContent = `${selectedText} 이번 달 총 ${formatDuration(monthSeconds)}.`;
}

function getVisibleRows() {
    const query = compactSpaces(historySearchEl.value).toLowerCase();
    const rows = (selectedDateKey ? entries : getMonthEntries())
        .map((entry) => {
            const sessionsForScope = getEntrySessionsForScope(entry);
            const seconds = sessionsForScope.reduce((sum, session) => sum + session.scopeSeconds, 0);
            return { entry, seconds, sessionsForScope };
        })
        .filter((row) => row.seconds > 0);

    return rows
        .filter((row) => {
            if (!query) return true;
            const haystack = `${getEntryTitles(row.entry).join(" ")} ${row.entry.channelName}`.toLowerCase();
            return haystack.includes(query);
        })
        .sort((a, b) => b.seconds - a.seconds || b.entry.lastWatchedAt - a.entry.lastWatchedAt);
}

function pruneSelectedEntryIds() {
    const existingIds = new Set(entries.map((entry) => entry.id));
    for (const id of selectedEntryIds) {
        if (!existingIds.has(id)) selectedEntryIds.delete(id);
    }
    for (const id of expandedEntryIds) {
        if (!existingIds.has(id)) expandedEntryIds.delete(id);
    }
}

function getVisibleEntryIds(rows = getVisibleRows()) {
    return rows.map((row) => row.entry.id).filter(Boolean);
}

function renderSelectionControls(rows = getVisibleRows()) {
    pruneSelectedEntryIds();

    const visibleIds = getVisibleEntryIds(rows);
    const visibleSelectedCount = visibleIds.filter((id) => selectedEntryIds.has(id)).length;
    const selectedCount = selectedEntryIds.size;

    selectVisibleHistoryEl.disabled = visibleIds.length === 0;
    selectVisibleHistoryEl.checked = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
    selectVisibleHistoryEl.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleIds.length;

    selectionStatusEl.textContent = selectedCount > 0
        ? `선택 ${selectedCount}개`
        : "선택 0개";
    deleteSelectedHistoryButton.disabled = selectedCount === 0;
    clearHistoryButton.disabled = entries.length === 0;
}

function setEntrySelected(id, selected) {
    if (!id) return;
    if (selected) selectedEntryIds.add(id);
    else selectedEntryIds.delete(id);
    renderList();
}

function setVisibleEntriesSelected(selected) {
    const visibleIds = getVisibleEntryIds();
    for (const id of visibleIds) {
        if (selected) selectedEntryIds.add(id);
        else selectedEntryIds.delete(id);
    }
    renderList();
}

function toggleEntryExpanded(id) {
    if (!id) return;
    if (expandedEntryIds.has(id)) expandedEntryIds.delete(id);
    else expandedEntryIds.add(id);
    renderList();
}

async function persistReplayVideoNo(entry, videoNo) {
    if (!storage || !entry?.id || !videoNo) return;

    const data = await storageGet(STORAGE_KEY);
    const nextHistory = updateRawHistoryEntry(data[STORAGE_KEY], entry.id, (row) => {
        row.replayVideoNo = videoNo;
    });
    await storageSet({ [STORAGE_KEY]: nextHistory });

    entry.replayVideoNo = videoNo;
    entries = normalizeHistory(nextHistory);
    pruneSelectedEntryIds();
}

function openUrlInNewTab(url, pendingWindow = null) {
    if (!url) return;
    if (pendingWindow && !pendingWindow.closed) {
        pendingWindow.location.href = url;
        return;
    }
    window.open(url, "_blank", "noopener");
}

async function handleTitleClick(event, entry) {
    const replayUrl = getReplayUrl(entry);
    if (replayUrl) return;
    if (!entry?.channelId) return;

    event.preventDefault();

    let pendingWindow = null;
    try {
        pendingWindow = window.open("", "_blank");
        if (pendingWindow) {
            pendingWindow.opener = null;
            pendingWindow.document.title = "다시보기 찾는 중";
            pendingWindow.document.body.textContent = "다시보기를 찾는 중입니다...";
        }
    } catch (_) {
        pendingWindow = null;
    }

    resolvingReplayEntryIds.add(entry.id);
    renderList();
    showMessage("해당 방송의 다시보기를 찾는 중입니다.");

    try {
        const videoNo = await resolveReplayVideoNo(entry);
        if (!videoNo) {
            if (pendingWindow && !pendingWindow.closed) pendingWindow.close();
            showMessage("해당 방송의 다시보기를 찾지 못했습니다.", "error");
            return;
        }

        await persistReplayVideoNo(entry, videoNo);
        openUrlInNewTab(`https://chzzk.naver.com/video/${encodeURIComponent(videoNo)}`, pendingWindow);
        showMessage("다시보기 링크를 찾았습니다.");
    } catch (_) {
        if (pendingWindow && !pendingWindow.closed) pendingWindow.close();
        showMessage("다시보기를 찾지 못했습니다.", "error");
    } finally {
        resolvingReplayEntryIds.delete(entry.id);
        renderList();
    }
}

function getEntryDateLabel(entry) {
    if (selectedDateKey) return formatDateLabel(selectedDateKey);

    const keys = getMonthDateKeys(selectedYear, selectedMonth)(entry).sort();
    if (!keys.length) return `${selectedYear}.${String(selectedMonth).padStart(2, "0")}`;
    if (keys.length === 1) return formatDateLabel(keys[0]);
    return `${formatDateLabel(keys[0])} - ${formatDateLabel(keys[keys.length - 1])}`;
}

function formatSessionLeftText(session) {
    if (!session.leftAt) return "알 수 없음";
    return session.closed ? formatKstDateTime(session.leftAt) : `${formatKstDateTime(session.leftAt)} 기준`;
}

function appendSessionCell(parent, label, value) {
    const cell = document.createElement("span");
    cell.className = "history-session-cell";

    const labelEl = document.createElement("span");
    labelEl.textContent = label;

    const valueEl = document.createElement("strong");
    valueEl.textContent = value;

    cell.append(labelEl, valueEl);
    parent.appendChild(cell);
}

function formatTitleSeenRange(row) {
    const first = Number(row.firstSeenAt) || 0;
    const last = Number(row.lastSeenAt) || 0;
    if (first > 0 && last > 0 && Math.abs(last - first) >= 60000) {
        return `${formatKstDateTime(first)} - ${formatKstDateTime(last)}`;
    }
    if (first > 0) return formatKstDateTime(first);
    if (last > 0) return formatKstDateTime(last);
    return "기록 시각 없음";
}

function getTitleHistorySummary(entry) {
    const rows = getEntryTitleRows(entry);
    if (rows.length <= 1) return "";

    const preview = rows.slice(0, 2).map((row) => row.title).join(" / ");
    const suffix = rows.length > 2 ? ` 외 ${rows.length - 2}개` : "";
    return `방송 제목 ${rows.length}개 기록됨: ${preview}${suffix}`;
}

function buildTitleHistoryList(entry) {
    const rows = getEntryTitleRows(entry);
    if (rows.length <= 1) return null;

    const list = document.createElement("div");
    list.className = "history-title-list";

    const heading = document.createElement("strong");
    heading.className = "history-title-list-heading";
    heading.textContent = "방송 제목 이력";
    list.appendChild(heading);

    for (const row of rows) {
        const item = document.createElement("div");
        item.className = "history-title-row";

        const time = document.createElement("span");
        time.textContent = formatTitleSeenRange(row);

        const title = document.createElement("strong");
        title.textContent = row.title;

        item.append(time, title);
        list.appendChild(item);
    }

    return list;
}

function buildSessionList(row) {
    const list = document.createElement("div");
    list.className = "history-session-list";

    for (const session of row.sessionsForScope) {
        const item = document.createElement("div");
        item.className = "history-session-item";
        if (session.legacy) item.dataset.legacy = "1";

        const titleText = pickString(session.title, row.entry?.title);
        if (titleText) appendSessionCell(item, "방제", titleText);
        appendSessionCell(item, session.legacy ? "이전 기록" : "입장", formatKstDateTime(session.enteredAt));
        appendSessionCell(item, "퇴장", session.legacy ? "세부 시간 없음" : formatSessionLeftText(session));
        appendSessionCell(item, "시청", formatDuration(session.scopeSeconds));

        list.appendChild(item);
    }

    return list;
}

function renderList() {
    const rows = getVisibleRows();
    const fragment = document.createDocumentFragment();
    const scopeText = selectedDateKey
        ? `${formatDateLabel(selectedDateKey)} 시청 기록`
        : `${selectedYear}.${String(selectedMonth).padStart(2, "0")} 시청 기록`;
    listDescriptionEl.textContent = scopeText;
    renderSelectionControls(rows);

    if (!rows.length) {
        const empty = document.createElement("div");
        empty.className = "history-empty";
        empty.textContent = entries.length ? "조건에 맞는 시청 기록이 없습니다." : "아직 저장된 시청 기록이 없습니다.";
        fragment.appendChild(empty);
        historyListEl.replaceChildren(fragment);
        return;
    }

    for (const row of rows) {
        const entry = row.entry;
        const expanded = expandedEntryIds.has(entry.id);
        const item = document.createElement("div");
        item.className = "history-item";
        item.dataset.selected = selectedEntryIds.has(entry.id) ? "1" : "0";
        item.dataset.expanded = expanded ? "1" : "0";

        const selectLabel = document.createElement("label");
        selectLabel.className = "history-item-select";
        selectLabel.setAttribute("aria-label", `${entry.title} 선택`);
        const selectInput = document.createElement("input");
        selectInput.type = "checkbox";
        selectInput.checked = selectedEntryIds.has(entry.id);
        selectInput.addEventListener("change", () => setEntrySelected(entry.id, selectInput.checked));
        selectLabel.appendChild(selectInput);

        const body = document.createElement("span");
        body.className = "history-item-main";
        const replayUrl = getReplayUrl(entry);
        const fallbackUrl = replayUrl || (entry.channelId ? "#" : entry.liveUrl);
        const title = document.createElement(fallbackUrl ? "a" : "strong");
        if (fallbackUrl) {
            title.className = "history-item-title-link";
            title.href = fallbackUrl;
            title.target = "_blank";
            title.rel = "noopener";
            title.title = replayUrl ? "다시보기 열기" : entry.channelId ? "다시보기 찾기" : "방송국 열기";
            if (entry.channelId) title.addEventListener("click", (event) => handleTitleClick(event, entry));
            if (resolvingReplayEntryIds.has(entry.id)) title.dataset.loading = "1";
        }
        title.textContent = entry.title;
        const meta = document.createElement("small");
        meta.textContent = `${entry.channelName} · ${getEntryDateLabel(entry)} · ${row.sessionsForScope.length}회 입장`;
        body.append(title, meta);
        const titleHistorySummary = getTitleHistorySummary(entry);
        if (titleHistorySummary) {
            const titleHistory = document.createElement("small");
            titleHistory.className = "history-title-history";
            titleHistory.textContent = titleHistorySummary;
            titleHistory.title = getEntryTitleRows(entry)
                .map((row) => `${formatTitleSeenRange(row)} · ${row.title}`)
                .join("\n");
            body.appendChild(titleHistory);
        }

        const time = document.createElement("span");
        time.className = "history-item-time";
        time.textContent = formatDuration(row.seconds);

        const actions = document.createElement("div");
        actions.className = "history-item-actions";

        const expandButton = document.createElement("button");
        expandButton.className = "history-entry-detail";
        expandButton.type = "button";
        expandButton.textContent = expanded ? "접기" : "세부";
        expandButton.setAttribute("aria-expanded", expanded ? "true" : "false");
        expandButton.setAttribute("aria-label", `${entry.title} 입장 기록 ${expanded ? "접기" : "보기"}`);
        expandButton.addEventListener("click", () => toggleEntryExpanded(entry.id));

        const deleteButton = document.createElement("button");
        deleteButton.className = "history-entry-delete";
        deleteButton.type = "button";
        deleteButton.textContent = "삭제";
        deleteButton.setAttribute("aria-label", `${entry.title} 기록 삭제`);
        deleteButton.addEventListener("click", () => deleteSingleEntry(entry));
        actions.append(time, expandButton, deleteButton);

        item.append(selectLabel, body, actions);
        if (expanded) {
            const titleHistoryList = buildTitleHistoryList(entry);
            if (titleHistoryList) item.appendChild(titleHistoryList);
            item.appendChild(buildSessionList(row));
        }
        fragment.appendChild(item);
    }

    historyListEl.replaceChildren(fragment);
}

function renderSummary() {
    const totalSeconds = entries.reduce((sum, entry) => sum + entry.watchedSeconds, 0);
    const monthSeconds = getMonthEntries()
        .reduce((sum, entry) => sum + getEntrySecondsForMonth(entry, selectedYear, selectedMonth), 0);

    totalWatchTimeEl.textContent = formatDuration(totalSeconds);
    totalLiveCountEl.textContent = `${entries.length}개`;
    monthWatchTimeEl.textContent = formatDuration(monthSeconds);

    if (storage) {
        noticeEl.dataset.state = "saved";
        noticeEl.textContent = `로컬 기록 · ${entries.length}개`;
    }
}

function renderAll() {
    ensureSelectedMonth();
    renderSummary();
    renderCalendar();
    renderList();
}

function showMessage(text, type = "success") {
    clearTimeout(hideMessageTimer);
    messageEl.textContent = text;
    messageEl.dataset.type = type;
    messageEl.classList.remove("hidden");
    messageEl.classList.add("is-visible");

    hideMessageTimer = setTimeout(() => {
        messageEl.classList.remove("is-visible");
        messageEl.classList.add("hidden");
    }, 1800);
}

async function loadHistory({ resetToLatest = false, silent = false } = {}) {
    if (!storage) {
        noticeEl.dataset.state = "dirty";
        noticeEl.textContent = "저장소 사용 불가";
        entries = [];
        renderAll();
        return false;
    }

    if (!silent) {
        noticeEl.dataset.state = "loading";
        noticeEl.textContent = "불러오는 중";
    }

    try {
        const data = await storageGet(STORAGE_KEY);
        entries = normalizeHistory(data[STORAGE_KEY]);
        pruneSelectedEntryIds();
        if (resetToLatest) {
            selectedYear = 0;
            selectedMonth = 0;
            selectedDateKey = "";
            selectedEntryIds.clear();
            expandedEntryIds.clear();
        }
        ensureSelectedMonth({ resetToLatest });
        renderAll();
        return true;
    } catch (_) {
        noticeEl.dataset.state = "dirty";
        noticeEl.textContent = "불러오기 실패";
        showMessage("시청 기록을 불러오지 못했습니다.", "error");
        return false;
    }
}

async function refreshHistory() {
    if (await loadHistory({ silent: false })) {
        showMessage("시청 기록을 새로고침했습니다.");
    }
}

async function clearHistory() {
    if (!confirm("이 브라우저에 저장된 시청 기록을 모두 삭제할까요?")) return;

    try {
        suppressNextStorageChange = true;
        await storageRemove(STORAGE_KEY);
        entries = [];
        selectedDateKey = "";
        selectedEntryIds.clear();
        expandedEntryIds.clear();
        ensureSelectedMonth({ resetToLatest: true });
        renderAll();
        showMessage("시청 기록을 삭제했습니다.");
    } catch (_) {
        suppressNextStorageChange = false;
        showMessage("시청 기록을 삭제하지 못했습니다.", "error");
    }
}

async function deleteEntriesByIds(ids, successMessage) {
    if (!storage) {
        showMessage("저장소를 사용할 수 없습니다.", "error");
        return false;
    }

    const targets = new Set(Array.from(ids || []).filter(Boolean));
    if (!targets.size) return false;

    try {
        const data = await storageGet(STORAGE_KEY);
        const nextHistory = removeEntryIdsFromRawHistory(data[STORAGE_KEY], targets);
        suppressNextStorageChange = true;
        await storageSet({ [STORAGE_KEY]: nextHistory });
        entries = normalizeHistory(nextHistory);
        for (const id of targets) {
            selectedEntryIds.delete(id);
            expandedEntryIds.delete(id);
        }
        pruneSelectedEntryIds();
        renderAll();
        showMessage(successMessage || "선택한 시청 기록을 삭제했습니다.");
        return true;
    } catch (_) {
        suppressNextStorageChange = false;
        showMessage("시청 기록을 삭제하지 못했습니다.", "error");
        return false;
    }
}

async function deleteSelectedEntries() {
    const count = selectedEntryIds.size;
    if (count <= 0) return;
    if (!confirm(`선택한 시청 기록 ${count}개를 삭제할까요?`)) return;

    await deleteEntriesByIds(selectedEntryIds, `선택한 시청 기록 ${count}개를 삭제했습니다.`);
}

async function deleteSingleEntry(entry) {
    if (!entry?.id) return;
    if (!confirm(`"${entry.title}" 시청 기록을 삭제할까요?`)) return;

    await deleteEntriesByIds([entry.id], "시청 기록 1개를 삭제했습니다.");
}

prevMonthButton.addEventListener("click", () => shiftSelectedMonth(-1));
calendarRefreshButton.addEventListener("click", refreshHistory);
nextMonthButton.addEventListener("click", () => {
    if (!nextMonthButton.disabled) shiftSelectedMonth(1);
});
refreshButton.addEventListener("click", refreshHistory);
clearHistoryButton.addEventListener("click", clearHistory);
historySearchEl.addEventListener("input", renderList);
selectVisibleHistoryEl.addEventListener("change", () => setVisibleEntriesSelected(selectVisibleHistoryEl.checked));
deleteSelectedHistoryButton.addEventListener("click", deleteSelectedEntries);

if (globalThis.chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local" || !changes[STORAGE_KEY]) return;
        if (suppressNextStorageChange) {
            suppressNextStorageChange = false;
            return;
        }
        loadHistory({ silent: true });
    });
}

loadHistory({ resetToLatest: true });
