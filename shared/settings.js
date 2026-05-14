(() => {
    const DEFAULT_QUALITY = "1080p";
    const DEFAULT_SKIP_SECONDS = 5;
    const SKIP_MIN = 1;
    const SKIP_MAX = 600;
    const MONTHLY_CALENDAR_MIN_PAGES = 1;
    const MONTHLY_CALENDAR_MAX_PAGES = 300;
    const FILTER_PRESET_MIN = 1;
    const FILTER_PRESET_MAX = 10000000;

    const DEFAULT_OPTIONS = Object.freeze({
        autoQualityEnabled: true,
        skipControlEnabled: true,
        skipKeyboardEnabled: true,
        skipPillEnabled: true,
        skipLivePillEnabled: true,
        skipLivePauseResumeEnabled: true,
        skipSeconds: DEFAULT_SKIP_SECONDS,
        skipWheelStep: 1,
        skipWheelShiftStep: 5,
        skipWheelAltStep: 10,
        vodBroadcastClockEnabled: true,
        timeMachineLagLabelEnabled: true,
        adblockPopupEnabled: true,
        monthlyBroadcastTimeEnabled: true,
        monthlyBroadcastTimeWindowDays: 30,
        monthlyBroadcastTimeMaxPages: 12,
        monthlyBroadcastTimeCalendarEnabled: true,
        monthlyBroadcastTimeMaxCalendarPages: 60,
        liveWatchHistoryEnabled: true,
        videoSearchEnabled: true,
        videoSearchCommentEnabled: true,
        videoSearchMaxPages: 80,
        videoSearchRenderBatchSize: 80,
        videoSearchCommentDelayMs: 1000,
        videoSearchCommentMaxVideos: 60,
        videoSearchCommentMaxPagesPerVideo: 1,
        categoryToolsEnabled: true,
        categoryToolsMaxMetadataPages: 12,
        categoryToolsHideGlobalTagSearch: true,
        categoryToolsFollowerBadgesEnabled: true,
        categoryToolsLiveElapsedEnabled: true,
        categoryToolsFollowerFilterPreset1: 1000,
        categoryToolsFollowerFilterPreset2: 5000,
        categoryToolsFollowerFilterPreset3: 10000,
        categoryToolsFollowerFilterPreset4: 30000,
        categoryToolsFollowerFilterPreset5: 50000,
        categoryToolsFollowerFilterPreset6: 100000,
        categoryToolsViewFilterPreset1: 100,
        categoryToolsViewFilterPreset2: 500,
        categoryToolsViewFilterPreset3: 1000,
        categoryToolsViewFilterPreset4: 3000,
        categoryToolsViewFilterPreset5: 5000,
        categoryToolsViewFilterPreset6: 10000,
        categoryToolsFollowerFetchMaxPerPass: 6,
        categoryToolsFollowerFetchConcurrency: 2,
        categoryToolsFollowerFetchDelayMs: 700,
    });

    const OPTION_KEYS = Object.freeze(Object.keys(DEFAULT_OPTIONS));
    let cachedOptions = normalizeOptions();
    let optionsLoaded = false;
    let optionsLoading = false;
    let optionsCallbacks = [];
    let optionsChangeListenerInstalled = false;
    const optionListeners = new Set();

    function normalizeInteger(value, fallback, min, max) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(Math.max(Math.round(parsed), min), max);
    }

    function normalizeBoolean(value, fallback = true) {
        if (typeof value === "boolean") return value;
        if (value === "true") return true;
        if (value === "false") return false;
        return fallback;
    }

    function normalizeSkipSeconds(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SKIP_SECONDS;
        return Math.min(Math.max(Math.round(parsed), SKIP_MIN), SKIP_MAX);
    }

    function normalizeOptions(value = {}) {
        const raw = value && typeof value === "object" ? value : {};
        const out = { ...DEFAULT_OPTIONS };

        out.autoQualityEnabled = normalizeBoolean(raw.autoQualityEnabled, DEFAULT_OPTIONS.autoQualityEnabled);
        out.skipControlEnabled = normalizeBoolean(raw.skipControlEnabled, DEFAULT_OPTIONS.skipControlEnabled);
        out.skipKeyboardEnabled = normalizeBoolean(raw.skipKeyboardEnabled, DEFAULT_OPTIONS.skipKeyboardEnabled);
        out.skipPillEnabled = normalizeBoolean(raw.skipPillEnabled, DEFAULT_OPTIONS.skipPillEnabled);
        out.skipLivePillEnabled = normalizeBoolean(
            raw.skipLivePillEnabled,
            DEFAULT_OPTIONS.skipLivePillEnabled
        );
        out.skipLivePauseResumeEnabled = normalizeBoolean(
            raw.skipLivePauseResumeEnabled,
            DEFAULT_OPTIONS.skipLivePauseResumeEnabled
        );
        out.skipSeconds = normalizeSkipSeconds(raw.skipSeconds);
        out.skipWheelStep = normalizeInteger(raw.skipWheelStep, DEFAULT_OPTIONS.skipWheelStep, 1, 60);
        out.skipWheelShiftStep = normalizeInteger(raw.skipWheelShiftStep, DEFAULT_OPTIONS.skipWheelShiftStep, 1, 300);
        out.skipWheelAltStep = normalizeInteger(raw.skipWheelAltStep, DEFAULT_OPTIONS.skipWheelAltStep, 1, 600);
        out.vodBroadcastClockEnabled = normalizeBoolean(
            raw.vodBroadcastClockEnabled,
            DEFAULT_OPTIONS.vodBroadcastClockEnabled
        );
        out.timeMachineLagLabelEnabled = normalizeBoolean(
            raw.timeMachineLagLabelEnabled,
            DEFAULT_OPTIONS.timeMachineLagLabelEnabled
        );

        out.adblockPopupEnabled = normalizeBoolean(raw.adblockPopupEnabled, DEFAULT_OPTIONS.adblockPopupEnabled);

        out.monthlyBroadcastTimeEnabled = normalizeBoolean(
            raw.monthlyBroadcastTimeEnabled,
            DEFAULT_OPTIONS.monthlyBroadcastTimeEnabled
        );
        out.monthlyBroadcastTimeWindowDays = normalizeInteger(
            raw.monthlyBroadcastTimeWindowDays,
            DEFAULT_OPTIONS.monthlyBroadcastTimeWindowDays,
            1,
            365
        );
        out.monthlyBroadcastTimeMaxPages = normalizeInteger(
            raw.monthlyBroadcastTimeMaxPages,
            DEFAULT_OPTIONS.monthlyBroadcastTimeMaxPages,
            1,
            200
        );
        out.monthlyBroadcastTimeCalendarEnabled = normalizeBoolean(
            raw.monthlyBroadcastTimeCalendarEnabled,
            DEFAULT_OPTIONS.monthlyBroadcastTimeCalendarEnabled
        );
        out.monthlyBroadcastTimeMaxCalendarPages = normalizeInteger(
            raw.monthlyBroadcastTimeMaxCalendarPages,
            DEFAULT_OPTIONS.monthlyBroadcastTimeMaxCalendarPages,
            MONTHLY_CALENDAR_MIN_PAGES,
            MONTHLY_CALENDAR_MAX_PAGES
        );
        out.liveWatchHistoryEnabled = normalizeBoolean(
            raw.liveWatchHistoryEnabled,
            DEFAULT_OPTIONS.liveWatchHistoryEnabled
        );

        out.videoSearchEnabled = normalizeBoolean(raw.videoSearchEnabled, DEFAULT_OPTIONS.videoSearchEnabled);
        out.videoSearchCommentEnabled = normalizeBoolean(
            raw.videoSearchCommentEnabled,
            DEFAULT_OPTIONS.videoSearchCommentEnabled
        );
        out.videoSearchMaxPages = normalizeInteger(raw.videoSearchMaxPages, DEFAULT_OPTIONS.videoSearchMaxPages, 1, 200);
        out.videoSearchRenderBatchSize = normalizeInteger(
            raw.videoSearchRenderBatchSize,
            DEFAULT_OPTIONS.videoSearchRenderBatchSize,
            10,
            300
        );
        out.videoSearchCommentDelayMs = normalizeInteger(
            raw.videoSearchCommentDelayMs,
            DEFAULT_OPTIONS.videoSearchCommentDelayMs,
            0,
            5000
        );
        out.videoSearchCommentMaxVideos = normalizeInteger(
            raw.videoSearchCommentMaxVideos,
            DEFAULT_OPTIONS.videoSearchCommentMaxVideos,
            1,
            200
        );
        out.videoSearchCommentMaxPagesPerVideo = normalizeInteger(
            raw.videoSearchCommentMaxPagesPerVideo,
            DEFAULT_OPTIONS.videoSearchCommentMaxPagesPerVideo,
            1,
            3
        );

        out.categoryToolsEnabled = normalizeBoolean(raw.categoryToolsEnabled, DEFAULT_OPTIONS.categoryToolsEnabled);
        out.categoryToolsMaxMetadataPages = normalizeInteger(
            raw.categoryToolsMaxMetadataPages,
            DEFAULT_OPTIONS.categoryToolsMaxMetadataPages,
            1,
            50
        );
        out.categoryToolsHideGlobalTagSearch = normalizeBoolean(
            raw.categoryToolsHideGlobalTagSearch,
            DEFAULT_OPTIONS.categoryToolsHideGlobalTagSearch
        );
        out.categoryToolsFollowerBadgesEnabled = normalizeBoolean(
            raw.categoryToolsFollowerBadgesEnabled,
            DEFAULT_OPTIONS.categoryToolsFollowerBadgesEnabled
        );
        out.categoryToolsLiveElapsedEnabled = normalizeBoolean(
            raw.categoryToolsLiveElapsedEnabled,
            DEFAULT_OPTIONS.categoryToolsLiveElapsedEnabled
        );
        out.categoryToolsFollowerFilterPreset1 = normalizeInteger(
            raw.categoryToolsFollowerFilterPreset1,
            DEFAULT_OPTIONS.categoryToolsFollowerFilterPreset1,
            FILTER_PRESET_MIN,
            FILTER_PRESET_MAX
        );
        out.categoryToolsFollowerFilterPreset2 = normalizeInteger(
            raw.categoryToolsFollowerFilterPreset2,
            DEFAULT_OPTIONS.categoryToolsFollowerFilterPreset2,
            FILTER_PRESET_MIN,
            FILTER_PRESET_MAX
        );
        out.categoryToolsFollowerFilterPreset3 = normalizeInteger(
            raw.categoryToolsFollowerFilterPreset3,
            DEFAULT_OPTIONS.categoryToolsFollowerFilterPreset3,
            FILTER_PRESET_MIN,
            FILTER_PRESET_MAX
        );
        out.categoryToolsFollowerFilterPreset4 = normalizeInteger(
            raw.categoryToolsFollowerFilterPreset4,
            DEFAULT_OPTIONS.categoryToolsFollowerFilterPreset4,
            FILTER_PRESET_MIN,
            FILTER_PRESET_MAX
        );
        out.categoryToolsFollowerFilterPreset5 = normalizeInteger(
            raw.categoryToolsFollowerFilterPreset5,
            DEFAULT_OPTIONS.categoryToolsFollowerFilterPreset5,
            FILTER_PRESET_MIN,
            FILTER_PRESET_MAX
        );
        out.categoryToolsFollowerFilterPreset6 = normalizeInteger(
            raw.categoryToolsFollowerFilterPreset6,
            DEFAULT_OPTIONS.categoryToolsFollowerFilterPreset6,
            FILTER_PRESET_MIN,
            FILTER_PRESET_MAX
        );
        out.categoryToolsViewFilterPreset1 = normalizeInteger(
            raw.categoryToolsViewFilterPreset1,
            DEFAULT_OPTIONS.categoryToolsViewFilterPreset1,
            FILTER_PRESET_MIN,
            FILTER_PRESET_MAX
        );
        out.categoryToolsViewFilterPreset2 = normalizeInteger(
            raw.categoryToolsViewFilterPreset2,
            DEFAULT_OPTIONS.categoryToolsViewFilterPreset2,
            FILTER_PRESET_MIN,
            FILTER_PRESET_MAX
        );
        out.categoryToolsViewFilterPreset3 = normalizeInteger(
            raw.categoryToolsViewFilterPreset3,
            DEFAULT_OPTIONS.categoryToolsViewFilterPreset3,
            FILTER_PRESET_MIN,
            FILTER_PRESET_MAX
        );
        out.categoryToolsViewFilterPreset4 = normalizeInteger(
            raw.categoryToolsViewFilterPreset4,
            DEFAULT_OPTIONS.categoryToolsViewFilterPreset4,
            FILTER_PRESET_MIN,
            FILTER_PRESET_MAX
        );
        out.categoryToolsViewFilterPreset5 = normalizeInteger(
            raw.categoryToolsViewFilterPreset5,
            DEFAULT_OPTIONS.categoryToolsViewFilterPreset5,
            FILTER_PRESET_MIN,
            FILTER_PRESET_MAX
        );
        out.categoryToolsViewFilterPreset6 = normalizeInteger(
            raw.categoryToolsViewFilterPreset6,
            DEFAULT_OPTIONS.categoryToolsViewFilterPreset6,
            FILTER_PRESET_MIN,
            FILTER_PRESET_MAX
        );
        out.categoryToolsFollowerFetchMaxPerPass = normalizeInteger(
            raw.categoryToolsFollowerFetchMaxPerPass,
            DEFAULT_OPTIONS.categoryToolsFollowerFetchMaxPerPass,
            1,
            50
        );
        out.categoryToolsFollowerFetchConcurrency = normalizeInteger(
            raw.categoryToolsFollowerFetchConcurrency,
            DEFAULT_OPTIONS.categoryToolsFollowerFetchConcurrency,
            1,
            10
        );
        out.categoryToolsFollowerFetchDelayMs = normalizeInteger(
            raw.categoryToolsFollowerFetchDelayMs,
            DEFAULT_OPTIONS.categoryToolsFollowerFetchDelayMs,
            0,
            5000
        );

        return out;
    }

    function flushOptionCallbacks(options) {
        const callbacks = optionsCallbacks;
        optionsCallbacks = [];
        for (const queued of callbacks) queued(options);
    }

    function installOptionsChangeListener() {
        if (optionsChangeListenerInstalled || !globalThis.chrome?.storage?.onChanged) return;
        optionsChangeListenerInstalled = true;

        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== "sync") return;
            const changedKeys = OPTION_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(changes, key));
            if (!changedKeys.length) return;

            const nextRaw = { ...cachedOptions };
            for (const key of changedKeys) nextRaw[key] = changes[key]?.newValue;
            cachedOptions = normalizeOptions(nextRaw);
            optionsLoaded = true;

            for (const listener of Array.from(optionListeners)) listener(cachedOptions);
        });
    }

    function getOptions(callback) {
        if (!globalThis.chrome?.storage?.sync) {
            callback(cachedOptions);
            return;
        }

        installOptionsChangeListener();

        if (optionsLoaded) {
            callback(cachedOptions);
            return;
        }

        optionsCallbacks.push(callback);
        if (optionsLoading) return;
        optionsLoading = true;

        chrome.storage.sync.get(OPTION_KEYS, (data) => {
            optionsLoading = false;
            cachedOptions = normalizeOptions(data);
            optionsLoaded = true;
            flushOptionCallbacks(cachedOptions);
        });
    }

    function addOptionsChangeListener(callback) {
        if (!globalThis.chrome?.storage?.onChanged) return () => {};
        installOptionsChangeListener();
        optionListeners.add(callback);
        return () => optionListeners.delete(callback);
    }

    globalThis.BetterChzzkSettings = {
        DEFAULT_QUALITY,
        DEFAULT_SKIP_SECONDS,
        SKIP_MIN,
        SKIP_MAX,
        MONTHLY_CALENDAR_MIN_PAGES,
        MONTHLY_CALENDAR_MAX_PAGES,
        DEFAULT_OPTIONS,
        OPTION_KEYS,
        normalizeSkipSeconds,
        normalizeOptions,
        getOptions,
        addOptionsChangeListener,
    };
})();
