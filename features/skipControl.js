(() => {
    const SKIP_PILL_ID = "betterchzzk-skip-pill";
    const SKIP_STYLE_ID = "betterchzzk-skip-style";
    const VOD_TIME_SELECTOR = "div.pzp-vod-time, div.pzp-pc__vod-time, div.pzp-pc-vod-time";
    const LIVE_TIME_SELECTOR = "div.pzp-live-time, div.pzp-pc__live-time, div.pzp-pc-live-time";
    const TIME_SELECTOR = `${VOD_TIME_SELECTOR}, ${LIVE_TIME_SELECTOR}`;
    const LIVE_LEFT_BUTTONS_SELECTOR = [
        "div.pzp-pc__bottom-buttons--left",
        "div.pzp-pc-bottom-buttons--left",
        "div[class*='pzp'][class*='bottom-buttons'][class*='left']",
    ].join(", ");
    const BUTTON_SELECTOR = "button, [role='button']";
    const LIVE_EDGE_PATCHED_ATTR = "data-bctm-text-patched";
    const LIVE_EDGE_BUTTON_TERMS = ["\uC2E4\uC2DC\uAC04", "\uB77C\uC774\uBE0C", "live"];
    const LIVE_ROUTE_RE = /^\/live(?:\/|$)/;
    const PLAYBACK_ROUTE_RE = /^\/(?:live|video)(?:\/|$)/;
    const RELEVANT_DOM_SELECTOR = `video, ${TIME_SELECTOR}, ${LIVE_LEFT_BUTTONS_SELECTOR}, [${LIVE_EDGE_PATCHED_ATTR}], #${SKIP_PILL_ID}`;
    const SKIP_VISIBILITY_RESYNC_DELAY_MS = 240;
    const CONTROL_AREA_BEFORE_VIDEO_BOTTOM = 150;
    const CONTROL_AREA_AFTER_VIDEO_BOTTOM = 110;
    const CONTROL_AREA_MAX_HEIGHT = 96;
    const LIVE_EDGE_INTENT_GRACE_MS = 1200;
    const PAUSED_CONTROL_INTENT_GRACE_MS = 1200;
    const LIVE_RESUME_RESTORE_WINDOW_MS = 8000;
    const LIVE_RESUME_RESTORE_RETRY_MS = 180;
    const LIVE_RESUME_RESTORE_MAX_ATTEMPTS = 45;
    const LIVE_RESUME_ALLOWED_DRIFT_SECONDS = 1.5;
    const LIVE_PAUSE_CACHE_SYNC_INTERVAL_MS = 1000;
    const { DEFAULT_SKIP_SECONDS, normalizeSkipSeconds, normalizeOptions } = BetterChzzkSettings;
    const {
        bindFeatureOptions,
        createThrottledDomSync,
        isVisible,
        mutationMatchesSelector,
        normalizeCompact,
        onReady,
        pickLargestVisible,
        startPageChangeDetection,
    } = BetterChzzk.utils;

    let featureOptions = normalizeOptions();
    let skipSeconds = featureOptions.skipSeconds;
    let persistTimer = null;
    let skipSyncRafId = null;
    let delayedSkipSyncTimer = null;
    let skipPillEl = null;
    let skipValueEl = null;
    let skipPillAnchorEl = null;
    let lastUrl = location.href;
    let pageChangeTimer = null;
    let attachedVideo = null;
    let pauseSnapshot = null;
    let pauseCacheSyncTimer = null;
    let resumeRestoreState = null;
    let resumeRestoreTimer = null;
    let lastLiveEdgeIntentAt = 0;
    let lastPausedControlIntentAt = 0;
    let domObserver = null;
    let domObserverMode = "";
    let bodyObserver = null;
    let removePageChangeDetection = null;
    let startupSyncTimer = 0;
    let runtimeInstalled = false;
    let skipPillHandlersInstalled = false;
    let keyboardHandlerInstalled = false;
    let liveResumeHandlersInstalled = false;
    const scheduleDomSync = createThrottledDomSync(() => {
        ensureLiveResumeGuardAttached();
        ensureSkipPillInjected();
        scheduleSkipPillSync({ delayed: true });
    });

    function isSkipEnabled() {
        return featureOptions.skipControlEnabled;
    }

    function isKeyboardEnabled() {
        return isSkipEnabled() && isPlaybackRoute() && featureOptions.skipKeyboardEnabled;
    }

    function isPillEnabled() {
        if (!isSkipEnabled() || !isPlaybackRoute() || !featureOptions.skipPillEnabled) return false;
        return !isLiveRoute() || featureOptions.skipLivePillEnabled;
    }

    function isLiveResumeGuardEnabled() {
        return isSkipEnabled() && featureOptions.skipLivePauseResumeEnabled;
    }

    function isLiveRoute() {
        return LIVE_ROUTE_RE.test(location.pathname);
    }

    function isPlaybackRoute() {
        return PLAYBACK_ROUTE_RE.test(location.pathname);
    }

    function compact(value) {
        if (typeof normalizeCompact === "function") return normalizeCompact(value);
        return String(value || "").toLowerCase().replace(/\s+/g, "");
    }

    function containsAnyTerm(value, terms) {
        const text = compact(value);
        return terms.some((term) => text.includes(compact(term)));
    }

    function getCandidateText(el) {
        return [
            el?.getAttribute?.("aria-label"),
            el?.getAttribute?.("title"),
            el?.textContent,
        ].join(" ");
    }

    function getWheelStep(event) {
        if (event.altKey) return featureOptions.skipWheelAltStep;
        if (event.shiftKey) return featureOptions.skipWheelShiftStep;
        return featureOptions.skipWheelStep;
    }

    function persistSkipSecondsDebounced() {
        if (persistTimer) clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
            persistTimer = null;
            chrome.storage.sync.set({ skipSeconds });
        }, 250);
    }

    function isEditableTarget(target) {
        if (!target) return false;
        if (target.isContentEditable) return true;
        if (typeof target.closest === "function") {
            return !!target.closest("input, textarea, select, [contenteditable='true']");
        }
        return false;
    }

    function getMainVideoElement() {
        const videos = document.querySelectorAll("video");
        return pickLargestVisible(videos) || videos[0] || null;
    }

    function getVisibleArea(el) {
        if (!(el instanceof HTMLElement) || !el.isConnected) return 0;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return 0;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return 0;
        return rect.width * rect.height;
    }

    function getEffectiveControlState(el) {
        let node = el;
        let opacity = 1;
        let depth = 0;

        while (node instanceof HTMLElement && depth < 10) {
            const style = getComputedStyle(node);
            if (
                node.hidden ||
                node.getAttribute("aria-hidden") === "true" ||
                style.display === "none" ||
                style.visibility === "hidden" ||
                style.visibility === "collapse"
            ) {
                return { opacity: "0", visibility: "hidden", pointerEvents: "none" };
            }

            const nodeOpacity = Number(style.opacity);
            if (Number.isFinite(nodeOpacity)) opacity *= nodeOpacity;

            if (node === document.body || node === document.documentElement) break;
            node = node.parentElement;
            depth += 1;
        }

        if (opacity <= 0.05) {
            return { opacity: "0", visibility: "", pointerEvents: "none" };
        }

        return { opacity: "", visibility: "", pointerEvents: "" };
    }

    function syncStandalonePillVisibility(pill, anchorEl) {
        if (!(pill instanceof HTMLElement) || !(anchorEl instanceof HTMLElement)) return;
        const state = getEffectiveControlState(anchorEl);
        pill.style.opacity = state.opacity;
        pill.style.visibility = state.visibility;
        pill.style.pointerEvents = state.pointerEvents;
    }

    function getSeekableRange(video) {
        if (!(video instanceof HTMLVideoElement) || !video.seekable?.length) return null;
        try {
            const lastIndex = video.seekable.length - 1;
            const start = video.seekable.start(lastIndex);
            const end = video.seekable.end(lastIndex);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
            return { start, end };
        } catch {
            return null;
        }
    }

    function getSeekBounds(video) {
        const seekableRange = getSeekableRange(video);
        if (seekableRange && (isLiveRoute() || !Number.isFinite(video.duration))) {
            return { min: seekableRange.start, max: seekableRange.end };
        }

        const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
        return { min: 0, max: duration };
    }

    function clampSeekTime(video, time) {
        const value = Number(time);
        if (!Number.isFinite(value)) return NaN;

        const bounds = getSeekBounds(video);
        return Math.min(Math.max(value, bounds.min), bounds.max);
    }

    function looksLikeLiveEdgeButton(button) {
        if (!(button instanceof HTMLElement)) return false;
        return button.hasAttribute(LIVE_EDGE_PATCHED_ATTR) || containsAnyTerm(getCandidateText(button), LIVE_EDGE_BUTTON_TERMS);
    }

    function isInLikelyVideoControlArea(el, video) {
        if (!(el instanceof HTMLElement) || !(video instanceof HTMLVideoElement)) return false;
        if (!isVisible?.(video)) return false;

        const elRect = el.getBoundingClientRect();
        const videoRect = video.getBoundingClientRect();
        if (elRect.width <= 0 || elRect.height <= 0) return false;

        const centerX = elRect.left + elRect.width / 2;
        const centerY = elRect.top + elRect.height / 2;
        const horizontallyInsideVideo = centerX >= videoRect.left - 36 && centerX <= videoRect.right + 36;
        const nearVideoBottom =
            centerY >= videoRect.bottom - CONTROL_AREA_BEFORE_VIDEO_BOTTOM &&
            centerY <= videoRect.bottom + CONTROL_AREA_AFTER_VIDEO_BOTTOM;

        return horizontallyInsideVideo && nearVideoBottom && elRect.height <= CONTROL_AREA_MAX_HEIGHT;
    }

    function findPillAnchorElement() {
        if (isLiveRoute()) return findLivePillAnchorElement();
        return findVodPillAnchorElement() || findVodTimeElement() || findTimeElement();
    }

    function isRecentLiveEdgeIntent() {
        return performance.now() - lastLiveEdgeIntentAt <= LIVE_EDGE_INTENT_GRACE_MS;
    }

    function isRecentPausedControlIntent() {
        return performance.now() - lastPausedControlIntentAt <= PAUSED_CONTROL_INTENT_GRACE_MS;
    }

    function getLiveRouteKey() {
        return isLiveRoute() ? location.pathname : "";
    }

    function isPauseSnapshotForCurrentRoute() {
        return Boolean(pauseSnapshot?.routeKey && pauseSnapshot.routeKey === getLiveRouteKey());
    }

    function canUseLiveResumeGuard(video) {
        return (
            isLiveResumeGuardEnabled() &&
            isLiveRoute() &&
            video instanceof HTMLVideoElement &&
            video.isConnected &&
            Boolean(getSeekableRange(video))
        );
    }

    function rememberPausedPosition(video, { preserveCachedTime = false } = {}) {
        if (!canUseLiveResumeGuard(video) || isRecentLiveEdgeIntent()) {
            if (pauseSnapshot?.video === video) pauseSnapshot = null;
            return;
        }

        const seekableRange = getSeekableRange(video);
        if (!seekableRange) return;

        const routeKey = getLiveRouteKey();
        const existingTime =
            preserveCachedTime && isPauseSnapshotForCurrentRoute()
                ? pauseSnapshot.time
                : video.currentTime;
        const time = clampSeekTime(video, existingTime);
        if (!Number.isFinite(time)) return;

        pauseSnapshot = {
            video,
            routeKey,
            time,
            seekableStart: seekableRange.start,
            seekableEnd: seekableRange.end,
            storedAt: pauseSnapshot?.routeKey === routeKey ? pauseSnapshot.storedAt : performance.now(),
            refreshedAt: performance.now(),
        };
    }

    function refreshPauseCacheSnapshot(video = attachedVideo) {
        if (!(video instanceof HTMLVideoElement) || !video.paused || !isLiveResumeGuardEnabled() || !isLiveRoute()) {
            stopPauseCacheSync();
            return;
        }

        if (!canUseLiveResumeGuard(video) || isRecentLiveEdgeIntent()) return;

        if (!isPauseSnapshotForCurrentRoute()) {
            rememberPausedPosition(video);
            return;
        }

        rememberPausedPosition(video, { preserveCachedTime: true });
    }

    function startPauseCacheSync(video = attachedVideo) {
        if (!(video instanceof HTMLVideoElement) || pauseCacheSyncTimer) return;
        pauseCacheSyncTimer = setInterval(() => {
            refreshPauseCacheSnapshot(attachedVideo);
        }, LIVE_PAUSE_CACHE_SYNC_INTERVAL_MS);
    }

    function stopPauseCacheSync() {
        if (!pauseCacheSyncTimer) return;
        clearInterval(pauseCacheSyncTimer);
        pauseCacheSyncTimer = null;
    }

    function cancelResumeRestore({ clearSnapshot = false } = {}) {
        if (resumeRestoreTimer) {
            clearTimeout(resumeRestoreTimer);
            resumeRestoreTimer = null;
        }
        resumeRestoreState = null;
        if (clearSnapshot) pauseSnapshot = null;
    }

    function getResumeExpectedTime(state) {
        const elapsedSeconds = Math.max(0, (performance.now() - state.startedAt) / 1000);
        return clampSeekTime(state.video, state.target + elapsedSeconds);
    }

    function runResumeRestoreAttempt() {
        const state = resumeRestoreState;
        if (!state) return;

        resumeRestoreTimer = null;
        if (
            state.video !== attachedVideo ||
            !canUseLiveResumeGuard(state.video) ||
            isRecentLiveEdgeIntent() ||
            performance.now() > state.untilAt
        ) {
            cancelResumeRestore({ clearSnapshot: true });
            return;
        }

        const expectedTime = getResumeExpectedTime(state);
        const currentTime = state.video.currentTime;
        if (Number.isFinite(expectedTime) && Number.isFinite(currentTime)) {
            const jumpedAhead = currentTime > expectedTime + LIVE_RESUME_ALLOWED_DRIFT_SECONDS;
            if (jumpedAhead) {
                try {
                    state.video.currentTime = expectedTime;
                } catch {
                    cancelResumeRestore({ clearSnapshot: true });
                    return;
                }
            }
        }

        state.attempts += 1;
        if (state.attempts >= LIVE_RESUME_RESTORE_MAX_ATTEMPTS) {
            cancelResumeRestore({ clearSnapshot: true });
            return;
        }

        resumeRestoreTimer = setTimeout(runResumeRestoreAttempt, LIVE_RESUME_RESTORE_RETRY_MS);
    }

    function startResumeRestore(video) {
        if (!isPauseSnapshotForCurrentRoute()) return;
        if (!canUseLiveResumeGuard(video) || isRecentLiveEdgeIntent()) {
            cancelResumeRestore({ clearSnapshot: true });
            return;
        }

        const target = clampSeekTime(video, pauseSnapshot.time);
        if (!Number.isFinite(target)) return;
        pauseSnapshot.video = video;
        pauseSnapshot.time = target;

        resumeRestoreState = {
            video,
            target,
            startedAt: performance.now(),
            untilAt: performance.now() + LIVE_RESUME_RESTORE_WINDOW_MS,
            attempts: 0,
        };

        runResumeRestoreAttempt();
    }

    function onVideoPause(event) {
        cancelResumeRestore();
        rememberPausedPosition(event.currentTarget);
        startPauseCacheSync(event.currentTarget);
    }

    function onVideoPlay(event) {
        stopPauseCacheSync();
        startResumeRestore(event.currentTarget);
    }

    function onVideoProgress(event) {
        refreshPauseCacheSnapshot(event.currentTarget);
    }

    function onVideoSeeked(event) {
        const video = event.currentTarget;
        if (
            !video?.paused ||
            resumeRestoreState?.video === video ||
            isRecentLiveEdgeIntent() ||
            isRecentPausedControlIntent()
        ) {
            return;
        }
        rememberPausedPosition(video);
        startPauseCacheSync(video);
    }

    function detachLiveResumeGuard({ clearSnapshot = true } = {}) {
        if (!attachedVideo) {
            stopPauseCacheSync();
            cancelResumeRestore({ clearSnapshot });
            return;
        }
        attachedVideo.removeEventListener("pause", onVideoPause, true);
        attachedVideo.removeEventListener("play", onVideoPlay, true);
        attachedVideo.removeEventListener("playing", onVideoPlay, true);
        attachedVideo.removeEventListener("seeked", onVideoSeeked, true);
        attachedVideo.removeEventListener("progress", onVideoProgress, true);
        attachedVideo.removeEventListener("durationchange", onVideoProgress, true);
        attachedVideo.removeEventListener("loadedmetadata", onVideoProgress, true);
        attachedVideo = null;
        stopPauseCacheSync();
        cancelResumeRestore({ clearSnapshot });
    }

    function attachLiveResumeGuard(video) {
        if (attachedVideo === video) {
            if (video instanceof HTMLVideoElement && video.paused) {
                refreshPauseCacheSnapshot(video);
                startPauseCacheSync(video);
            }
            return;
        }
        const keepSnapshot = isPauseSnapshotForCurrentRoute();
        detachLiveResumeGuard({ clearSnapshot: !keepSnapshot });
        if (!(video instanceof HTMLVideoElement)) return;

        attachedVideo = video;
        attachedVideo.addEventListener("pause", onVideoPause, true);
        attachedVideo.addEventListener("play", onVideoPlay, true);
        attachedVideo.addEventListener("playing", onVideoPlay, true);
        attachedVideo.addEventListener("seeked", onVideoSeeked, true);
        attachedVideo.addEventListener("progress", onVideoProgress, true);
        attachedVideo.addEventListener("durationchange", onVideoProgress, true);
        attachedVideo.addEventListener("loadedmetadata", onVideoProgress, true);

        if (video.paused) {
            refreshPauseCacheSnapshot(video);
            startPauseCacheSync(video);
        } else if (isPauseSnapshotForCurrentRoute()) {
            startResumeRestore(video);
        }
    }

    function ensureLiveResumeGuardAttached() {
        if (!isLiveResumeGuardEnabled() || !isLiveRoute()) {
            detachLiveResumeGuard();
            return;
        }
        attachLiveResumeGuard(getMainVideoElement());
    }

    function onKeyDownSeek(event) {
        if (!isKeyboardEnabled()) return;
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        if (isEditableTarget(event.target)) return;

        const video = getMainVideoElement();
        if (!video) return;

        const step = normalizeSkipSeconds(skipSeconds);
        const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
        let next = current + (event.key === "ArrowRight" ? step : -step);

        const bounds = getSeekBounds(video);
        next = Math.min(Math.max(next, bounds.min), bounds.max);

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        video.currentTime = next;
        if (video.paused) rememberPausedPosition(video);
    }

    function injectSkipStyleOnce() {
        BetterChzzk.utils.injectStyleOnce(SKIP_STYLE_ID, `
#${SKIP_PILL_ID}{
  display:inline-flex;
  align-items:center;
  gap:1px;
  margin-left:14px;
  height:24px;
  min-width:0;
  padding:0 7px;
  border-radius:9999px;
  border:1px solid transparent;
  background-color:transparent !important;
  appearance:none;
  -webkit-appearance:none;
  color:rgba(255,255,255,0.9);
  font-family:inherit;
  font-size:14px;
  font-weight:700;
  line-height:20px;
  letter-spacing:0;
  font-variant-numeric:tabular-nums;
  white-space:nowrap;
  cursor:pointer;
  user-select:none;
  pointer-events:auto;
  flex:0 0 auto;
  align-self:center;
  transition:opacity 120ms ease, background-color 120ms ease, border-color 120ms ease;
  position:relative;
  z-index:2;
  box-sizing:border-box;
}
#${SKIP_PILL_ID}[data-bc-placement="live-inline"],
#${SKIP_PILL_ID}[data-bc-placement="vod-inline"]{
  margin-left:0;
  margin-right:0;
  order:9999;
  width:auto;
}
#${SKIP_PILL_ID}:hover{
  background-color:rgba(255,255,255,0.14) !important;
  border-color:rgba(255,255,255,0.22);
  opacity:1;
}
#${SKIP_PILL_ID}:active{
  opacity:0.78;
  background-color:rgba(255,255,255,0.18) !important;
}
#${SKIP_PILL_ID}:focus-visible{
  outline:none;
  box-shadow: 0 0 0 2px rgba(255,255,255,0.22);
}
#${SKIP_PILL_ID} .bc-value,
#${SKIP_PILL_ID} .bc-unit{
  display:inline-flex;
  align-items:center;
  height:100%;
  line-height:20px;
}
#${SKIP_PILL_ID} .bc-unit{
  opacity:1;
  font-weight:700;
  margin-left:0;
}
#${SKIP_PILL_ID} .bc-value{
  min-width:0;
  text-align:left;
}
`);
    }

    function findTimeElement() {
        return pickLargestVisible(document.querySelectorAll(TIME_SELECTOR));
    }

    function findVodTimeElement() {
        return pickLargestVisible(document.querySelectorAll(VOD_TIME_SELECTOR));
    }

    function findLeftButtonsContainer() {
        const video = getMainVideoElement();
        const candidates = [];
        for (const el of document.querySelectorAll(LIVE_LEFT_BUTTONS_SELECTOR)) {
            if (!(el instanceof HTMLElement) || getVisibleArea(el) <= 0) continue;
            if (video instanceof HTMLVideoElement && !isInLikelyVideoControlArea(el, video)) continue;

            const rect = el.getBoundingClientRect();
            candidates.push({ el, width: rect.width, left: rect.left });
        }

        if (!candidates.length) return null;
        candidates.sort((a, b) => a.left - b.left || a.width - b.width);
        return candidates[0].el;
    }

    function findLivePillAnchorElement() {
        return findLeftButtonsContainer();
    }

    function findVodPillAnchorElement() {
        return findLeftButtonsContainer();
    }

    function getSkipPillElement() {
        if (skipPillEl && skipPillEl.isConnected) return skipPillEl;
        skipPillEl = document.getElementById(SKIP_PILL_ID);
        if (!skipPillEl) skipValueEl = null;
        return skipPillEl;
    }

    function showSkipPill(pill) {
        if (!pill) return;

        pill.style.display = "";
        if (["live-inline", "vod-inline"].includes(pill.getAttribute("data-bc-placement"))) return;

        const anchorEl = findAnchorElementForPill(pill);
        if (anchorEl) {
            syncStandalonePillVisibility(pill, anchorEl);
            return;
        }

        pill.style.pointerEvents = "";
        pill.style.opacity = "";
        pill.style.visibility = "";
    }

    function resetPillPlacementStyles(pill) {
        pill.removeAttribute("data-bc-placement");
        pill.style.left = "";
        pill.style.top = "";
        pill.style.right = "";
        pill.style.bottom = "";
        pill.style.transform = "";
        pill.style.transition = "";
        pill.className = "";
    }

    function findLiveButtonBoxReference(container) {
        if (!(container instanceof HTMLElement)) return null;

        const children = Array.from(container.children || []).filter((child) => {
            return child instanceof HTMLElement && child.id !== SKIP_PILL_ID;
        });

        const visibleChildren = children.filter((child) => getVisibleArea(child) > 0);
        const candidates = visibleChildren.length ? visibleChildren : children;
        if (!candidates.length) return null;

        candidates.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
        return candidates[0];
    }

    function syncLivePillButtonBoxClass(pill, container) {
        if (!(pill instanceof HTMLElement) || !(container instanceof HTMLElement)) return;

        const reference = findLiveButtonBoxReference(container);
        pill.className = reference?.className || "";
        pill.style.order = "9999";
        pill.style.marginLeft = "8px";

        if (!reference) return;
        pill.style.opacity = reference.style.opacity || "";
        pill.style.visibility = reference.style.visibility || "";
        pill.style.pointerEvents = reference.style.pointerEvents || "";
        pill.style.transition = reference.style.transition || "";
    }

    function mountLivePillInLeftButtons(pill, container) {
        if (!pill || !(container instanceof HTMLElement)) return false;

        syncLivePillButtonBoxClass(pill, container);
        if (pill.parentElement !== container) {
            if (pill.parentElement) pill.remove();
            container.appendChild(pill);
        } else if (pill.nextElementSibling) {
            container.appendChild(pill);
        }

        return true;
    }

    function updateSkipPill() {
        const pill = getSkipPillElement();
        if (!pill) return;

        if (!skipValueEl || !skipValueEl.isConnected || !pill.contains(skipValueEl)) {
            skipValueEl = pill.querySelector(".bc-value");
        }

        if (skipValueEl) {
            const nextText = String(skipSeconds);
            if (skipValueEl.textContent !== nextText) skipValueEl.textContent = nextText;
        }

        pill.title = `Wheel: +/- ${featureOptions.skipWheelStep}s (Shift: ${featureOptions.skipWheelShiftStep}s, Alt: ${featureOptions.skipWheelAltStep}s)\nClick: reset to default`;
    }

    function setSkipSeconds(next, { persist = true } = {}) {
        const normalized = normalizeSkipSeconds(next);
        if (normalized === skipSeconds) return;

        skipSeconds = normalized;
        updateSkipPill();

        if (persist) persistSkipSecondsDebounced();
    }

    function createSkipPill() {
        injectSkipStyleOnce();

        const pill = document.createElement("button");
        pill.id = SKIP_PILL_ID;
        pill.type = "button";
        pill.setAttribute("aria-label", "Skip seconds control");

        pill.innerHTML = `
<span class="bc-value">${skipSeconds}</span><span class="bc-unit">s</span>
`;

        skipPillEl = pill;
        skipValueEl = pill.querySelector(".bc-value");
        return pill;
    }

    function handleSkipPillClick(event) {
        const pill = getSkipPillElement();
        if (!pill || !pill.contains(event.target)) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        setSkipSeconds(DEFAULT_SKIP_SECONDS);
    }

    function handleSkipPillWheel(event) {
        const pill = getSkipPillElement();
        if (!pill || !pill.contains(event.target)) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const direction = event.deltaY < 0 ? 1 : -1;
        const step = getWheelStep(event);
        setSkipSeconds(skipSeconds + direction * step);
    }

    function installSkipPillGlobalHandlers() {
        if (skipPillHandlersInstalled) return;
        skipPillHandlersInstalled = true;
        window.addEventListener("click", handleSkipPillClick, true);
        window.addEventListener("wheel", handleSkipPillWheel, { capture: true, passive: false });
    }

    function uninstallSkipPillGlobalHandlers() {
        if (!skipPillHandlersInstalled) return;
        skipPillHandlersInstalled = false;
        window.removeEventListener("click", handleSkipPillClick, true);
        window.removeEventListener("wheel", handleSkipPillWheel, true);
    }

    function syncPillTypography(pill, anchorEl) {
        if (!pill || !anchorEl) return;
        const style = getComputedStyle(anchorEl);
        pill.style.fontFamily = style.fontFamily;
        pill.style.fontSize = style.fontSize;
    }

    function mountPillNearAnchor(pill, anchorEl) {
        if (!pill || !anchorEl?.parentElement) return false;
        syncPillTypography(pill, anchorEl);
        skipPillAnchorEl = anchorEl;

        resetPillPlacementStyles(pill);
        if (anchorEl.matches?.(LIVE_LEFT_BUTTONS_SELECTOR)) {
            pill.setAttribute("data-bc-placement", isLiveRoute() ? "live-inline" : "vod-inline");
            return mountLivePillInLeftButtons(pill, anchorEl);
        }

        if (isLiveRoute()) {
            return false;
        }

        if (pill.parentElement === anchorEl.parentElement && pill.previousElementSibling === anchorEl) return true;
        if (pill.parentElement) pill.remove();
        anchorEl.insertAdjacentElement("afterend", pill);
        return true;
    }

    function findAnchorElementForPill(pill) {
        if (skipPillAnchorEl?.isConnected && getVisibleArea(skipPillAnchorEl) > 0) return skipPillAnchorEl;

        const previous = pill?.previousElementSibling;
        if (previous?.matches?.(TIME_SELECTOR)) return previous;
        if (looksLikeLiveEdgeButton(previous)) return previous;
        if (pill?.parentElement?.matches?.(LIVE_LEFT_BUTTONS_SELECTOR)) return pill.parentElement;
        return findPillAnchorElement();
    }

    function syncExistingSkipPill() {
        const pill = getSkipPillElement();
        if (!pill) {
            ensureSkipPillInjected();
            return;
        }

        const anchorEl = findAnchorElementForPill(pill);
        if (!anchorEl) {
            pill.remove();
            skipPillEl = null;
            skipValueEl = null;
            skipPillAnchorEl = null;
            return;
        }

        if (!mountPillNearAnchor(pill, anchorEl)) {
            pill.remove();
            skipPillEl = null;
            skipValueEl = null;
            skipPillAnchorEl = null;
            return;
        }

        showSkipPill(pill);
    }

    function runSkipPillSync() {
        skipSyncRafId = null;
        syncExistingSkipPill();
    }

    function scheduleSkipPillSync({ delayed = false } = {}) {
        if (skipSyncRafId === null) {
            skipSyncRafId = requestAnimationFrame(runSkipPillSync);
        }

        if (!delayed) return;

        if (delayedSkipSyncTimer) clearTimeout(delayedSkipSyncTimer);
        delayedSkipSyncTimer = setTimeout(() => {
            delayedSkipSyncTimer = null;
            scheduleSkipPillSync();
        }, SKIP_VISIBILITY_RESYNC_DELAY_MS);
    }

    function ensureSkipPillInjected() {
        if (!isPillEnabled()) {
            removeSkipPill();
            return;
        }

        const anchorEl = findPillAnchorElement();
        const existing = getSkipPillElement();

        if (!anchorEl) {
            if (existing) {
                existing.remove();
                skipPillEl = null;
                skipValueEl = null;
                skipPillAnchorEl = null;
            }
            return;
        }

        injectSkipStyleOnce();
        installSkipPillGlobalHandlers();

        const pill = existing || createSkipPill();

        if (!mountPillNearAnchor(pill, anchorEl)) return;

        updateSkipPill();
        showSkipPill(pill);
    }

    function removeSkipPill() {
        const pill = getSkipPillElement();
        if (pill) pill.remove();
        skipPillEl = null;
        skipValueEl = null;
        skipPillAnchorEl = null;
    }

    function handlePageChange() {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        skipPillAnchorEl = null;
        cancelResumeRestore({ clearSnapshot: true });
        if (pageChangeTimer) {
            clearTimeout(pageChangeTimer);
            pageChangeTimer = null;
        }

        if (!isPlaybackRoute()) {
            removeSkipPill();
            detachLiveResumeGuard();
            refreshDomObserverConfig();
            return;
        }
        refreshDomObserverConfig();

        pageChangeTimer = setTimeout(() => {
            pageChangeTimer = null;
            ensureLiveResumeGuardAttached();
            ensureSkipPillInjected();
            scheduleSkipPillSync({ delayed: true });
        }, 500);
    }

    function mutationCouldAffectExtension(mutation) {
        if (
            mutation.type === "attributes" &&
            mutation.target instanceof HTMLElement &&
            mutation.target.closest(LIVE_LEFT_BUTTONS_SELECTOR)
        ) {
            return true;
        }
        if (mutationMatchesSelector(mutation, BUTTON_SELECTOR)) return true;
        return mutationMatchesSelector(mutation, RELEVANT_DOM_SELECTOR);
    }

    function startDomObserver() {
        if (domObserver) return;
        domObserver = new MutationObserver((mutations) => {
            handlePageChange();
            if (!isSkipEnabled() || !isPlaybackRoute()) return;
            if (mutations.some(mutationCouldAffectExtension)) scheduleDomSync();
        });

        if (document.body) {
            refreshDomObserverConfig();
            return;
        }

        bodyObserver = new MutationObserver(() => {
            if (!document.body) return;
            bodyObserver.disconnect();
            bodyObserver = null;
            refreshDomObserverConfig();
            scheduleDomSync();
        });

        bodyObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    function getDomObserverConfig(mode) {
        if (mode !== "playback") {
            return {
                childList: true,
                subtree: true,
            };
        }

        return {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [
                "class",
                "style",
                "hidden",
                "aria-hidden",
                "aria-label",
                "title",
                "disabled",
                "aria-disabled",
                LIVE_EDGE_PATCHED_ATTR,
            ],
        };
    }

    function refreshDomObserverConfig() {
        if (!domObserver || !document.body) return;
        const nextMode = isSkipEnabled() && isPlaybackRoute() ? "playback" : "idle";
        if (domObserverMode === nextMode) return;

        domObserver.disconnect();
        domObserver.observe(document.body, getDomObserverConfig(nextMode));
        domObserverMode = nextMode;
    }

    function stopDomObserver() {
        if (domObserver) {
            domObserver.disconnect();
            domObserver = null;
        }
        if (bodyObserver) {
            bodyObserver.disconnect();
            bodyObserver = null;
        }
        domObserverMode = "";
    }

    function installKeyboardHandler() {
        if (keyboardHandlerInstalled) return;
        keyboardHandlerInstalled = true;
        window.addEventListener("keydown", onKeyDownSeek, true);
    }

    function uninstallKeyboardHandler() {
        if (!keyboardHandlerInstalled) return;
        keyboardHandlerInstalled = false;
        window.removeEventListener("keydown", onKeyDownSeek, true);
    }

    function handleLiveControlIntent(event) {
        if (!isLiveRoute()) return;
        const button = event.target?.closest?.(BUTTON_SELECTOR);
        if (!(button instanceof HTMLElement)) return;

        const now = performance.now();
        if (looksLikeLiveEdgeButton(button)) {
            lastLiveEdgeIntentAt = now;
            cancelResumeRestore({ clearSnapshot: true });
            return;
        }

        if (
            button.id !== SKIP_PILL_ID &&
            attachedVideo?.paused &&
            canUseLiveResumeGuard(attachedVideo) &&
            isInLikelyVideoControlArea(button, attachedVideo)
        ) {
            lastPausedControlIntentAt = now;
        }
    }

    function installLiveResumeGlobalHandlers() {
        if (liveResumeHandlersInstalled) return;
        liveResumeHandlersInstalled = true;
        window.addEventListener("pointerdown", handleLiveControlIntent, true);
        window.addEventListener("click", handleLiveControlIntent, true);
    }

    function uninstallLiveResumeGlobalHandlers() {
        if (!liveResumeHandlersInstalled) return;
        liveResumeHandlersInstalled = false;
        window.removeEventListener("pointerdown", handleLiveControlIntent, true);
        window.removeEventListener("click", handleLiveControlIntent, true);
    }

    function clearRuntimeTimers() {
        if (pageChangeTimer) {
            clearTimeout(pageChangeTimer);
            pageChangeTimer = null;
        }
        if (delayedSkipSyncTimer) {
            clearTimeout(delayedSkipSyncTimer);
            delayedSkipSyncTimer = null;
        }
        if (skipSyncRafId !== null) {
            cancelAnimationFrame(skipSyncRafId);
            skipSyncRafId = null;
        }
        if (startupSyncTimer) {
            clearTimeout(startupSyncTimer);
            startupSyncTimer = 0;
        }
    }

    function installRuntime() {
        if (runtimeInstalled) return;
        runtimeInstalled = true;
        installKeyboardHandler();
        installLiveResumeGlobalHandlers();
        if (!removePageChangeDetection) {
            removePageChangeDetection = startPageChangeDetection(handlePageChange);
        }
        startDomObserver();
        ensureLiveResumeGuardAttached();
        if (isPillEnabled()) {
            ensureSkipPillInjected();
            scheduleSkipPillSync({ delayed: true });
        }
        startupSyncTimer = setTimeout(() => {
            startupSyncTimer = 0;
            if (isPillEnabled()) ensureSkipPillInjected();
        }, 800);
    }

    function teardownRuntime() {
        runtimeInstalled = false;
        clearRuntimeTimers();
        uninstallSkipPillGlobalHandlers();
        uninstallKeyboardHandler();
        uninstallLiveResumeGlobalHandlers();
        if (removePageChangeDetection) {
            removePageChangeDetection();
            removePageChangeDetection = null;
        }
        stopDomObserver();
        removeSkipPill();
        detachLiveResumeGuard();
    }

    function applyOptions(options) {
        featureOptions = options;
        skipSeconds = normalizeSkipSeconds(options.skipSeconds);
        if (!isSkipEnabled()) {
            teardownRuntime();
            return;
        }
        installRuntime();
        ensureLiveResumeGuardAttached();
        refreshDomObserverConfig();
        if (!isPlaybackRoute()) {
            removeSkipPill();
            return;
        }
        if (isPillEnabled()) {
            ensureSkipPillInjected();
            updateSkipPill();
            scheduleSkipPillSync({ delayed: true });
        } else {
            removeSkipPill();
        }
    }

    bindFeatureOptions(applyOptions);

    onReady(() => {
        if (isSkipEnabled()) installRuntime();
    });
})();
