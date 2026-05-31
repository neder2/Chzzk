(() => {
    const AD_POPUP_SELECTOR = ".popup_container__Aqx-3";
    const AD_DIMMED_SELECTOR = ".popup_dimmed__zs78t";
    const AD_SUPPRESS_ATTR = "data-betterchzzk-suppress-adblock-popup";
    const AD_STYLE_ID = "betterchzzk-adblock-popup-style";
    const READY_EVENT = "betterchzzk:adblock-popup:ready";
    const READY_ATTR = "data-betterchzzk-adblock-popup-ready";
    const SCROLL_UNLOCK_DELAYS_MS = [0, 80, 250, 800];
    const {
        bindFeatureOptions,
        createThrottledDomSync,
        mutationMatchesSelector,
        normalizeCompact,
        onReady,
        startPageChangeDetection,
    } = BetterChzzk.utils;

    let lastUrl = location.href;
    let pageChangeTimer = null;
    let scrollUnlockScheduled = false;
    let featureOptions = BetterChzzkSettings.normalizeOptions();
    const scheduleDomSync = createThrottledDomSync(removeAdsPopup);

    function isEnabled() {
        return featureOptions.adblockPopupEnabled;
    }

    function publishReady() {
        document.documentElement.setAttribute(READY_ATTR, JSON.stringify({
            href: location.href,
            at: Date.now(),
        }));
        window.dispatchEvent(new Event(READY_EVENT));
    }

    function injectAdblockPopupStyleOnce() {
        BetterChzzk.utils.injectStyleOnce(AD_STYLE_ID, `
${AD_DIMMED_SELECTOR}[${AD_SUPPRESS_ATTR}="1"],
${AD_POPUP_SELECTOR}[${AD_SUPPRESS_ATTR}="1"]{
  display:none !important;
  pointer-events:none !important;
  visibility:hidden !important;
}
`);
    }

    function isAdblockPopupLike(el) {
        if (!(el instanceof HTMLElement)) return false;

        const t = normalizeCompact(el.textContent || "");
        return (
            t.includes("adblock") ||
            t.includes("adblocker") ||
            t.includes("\uAD11\uACE0\uCC28\uB2E8") ||
            t.includes("\uD655\uC7A5\uD504\uB85C\uADF8\uB7A8") ||
            (t.includes("\uD655\uC7A5") && t.includes("\uAE30\uB2A5") && t.includes("\uC885\uB8CC"))
        );
    }

    function getPopupDimmed(popup) {
        return popup?.closest?.(AD_DIMMED_SELECTOR) || null;
    }

    function isSuppressed(el) {
        return el?.getAttribute?.(AD_SUPPRESS_ATTR) === "1";
    }

    function isRendered(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function hasSuppressedAdblockPopup() {
        return Boolean(document.querySelector(`${AD_POPUP_SELECTOR}[${AD_SUPPRESS_ATTR}="1"], ${AD_DIMMED_SELECTOR}[${AD_SUPPRESS_ATTR}="1"]`));
    }

    function hasActiveUnsuppressedPopup() {
        for (const dimmed of document.querySelectorAll(AD_DIMMED_SELECTOR)) {
            if (isSuppressed(dimmed)) continue;
            if (isRendered(dimmed)) return true;
        }

        for (const popup of document.querySelectorAll(AD_POPUP_SELECTOR)) {
            if (isSuppressed(popup) || isSuppressed(getPopupDimmed(popup))) continue;
            if (isRendered(popup)) return true;
        }

        return false;
    }

    function unlockBodyScrollIfOnlySuppressedPopups() {
        if (!document.body || !hasSuppressedAdblockPopup() || hasActiveUnsuppressedPopup()) return;

        const style = document.body.style;
        const hadScrollLock = style.overflow === "hidden" || style.overflowY === "hidden";
        if (!hadScrollLock) return;

        if (style.overflow === "hidden") style.removeProperty("overflow");
        if (style.overflowY === "hidden") style.removeProperty("overflow-y");
        style.removeProperty("padding-right");

        if (!document.body.getAttribute("style")?.trim()) {
            document.body.removeAttribute("style");
        }
    }

    function scheduleScrollUnlock() {
        if (scrollUnlockScheduled) return;
        scrollUnlockScheduled = true;

        for (const delay of SCROLL_UNLOCK_DELAYS_MS) {
            setTimeout(unlockBodyScrollIfOnlySuppressedPopups, delay);
        }

        setTimeout(() => {
            scrollUnlockScheduled = false;
        }, Math.max(...SCROLL_UNLOCK_DELAYS_MS) + 50);
    }

    function syncDimmedSuppression() {
        for (const dimmed of document.querySelectorAll(AD_DIMMED_SELECTOR)) {
            const popups = Array.from(dimmed.querySelectorAll(AD_POPUP_SELECTOR));
            const shouldSuppress = popups.length > 0 && popups.every(isSuppressed);
            if (shouldSuppress) dimmed.setAttribute(AD_SUPPRESS_ATTR, "1");
            else dimmed.removeAttribute(AD_SUPPRESS_ATTR);
        }
    }

    function removeAdsPopup() {
        if (!isEnabled()) {
            restoreAdsPopups();
            return;
        }

        const popups = document.querySelectorAll(AD_POPUP_SELECTOR);
        if (!popups.length) {
            unlockBodyScrollIfOnlySuppressedPopups();
            return;
        }

        injectAdblockPopupStyleOnce();
        let suppressedCount = 0;

        for (const popup of popups) {
            const isAdblock = isAdblockPopupLike(popup);

            if (isAdblock) {
                popup.setAttribute(AD_SUPPRESS_ATTR, "1");
                suppressedCount += 1;
            } else {
                popup.removeAttribute(AD_SUPPRESS_ATTR);
            }
        }

        syncDimmedSuppression();
        if (suppressedCount > 0) scheduleScrollUnlock();
    }

    function runPopupPass() {
        if (isEnabled()) removeAdsPopup();
        else restoreAdsPopups();
        publishReady();
    }

    function restoreAdsPopups() {
        document.querySelectorAll(`${AD_POPUP_SELECTOR}[${AD_SUPPRESS_ATTR}="1"]`).forEach((popup) => {
            popup.removeAttribute(AD_SUPPRESS_ATTR);
        });
        document.querySelectorAll(`${AD_DIMMED_SELECTOR}[${AD_SUPPRESS_ATTR}="1"]`).forEach((dimmed) => {
            dimmed.removeAttribute(AD_SUPPRESS_ATTR);
        });
    }

    function mutationCouldAffectPopup(mutation) {
        if (mutation.type === "attributes" && mutation.target === document.body && mutation.attributeName === "style") {
            return hasSuppressedAdblockPopup();
        }

        return mutationMatchesSelector(mutation, `${AD_POPUP_SELECTOR}, ${AD_DIMMED_SELECTOR}`);
    }

    function handlePageChange() {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        if (!isEnabled()) {
            restoreAdsPopups();
            publishReady();
            return;
        }

        if (pageChangeTimer) clearTimeout(pageChangeTimer);
        pageChangeTimer = setTimeout(() => {
            pageChangeTimer = null;
            runPopupPass();
        }, 500);
    }

    function startDomObserver() {
        const observer = new MutationObserver((mutations) => {
            handlePageChange();
            if (mutations.some(mutationCouldAffectPopup)) scheduleDomSync();
        });

        const config = {
            attributes: true,
            attributeFilter: ["class", "style"],
            childList: true,
            subtree: true,
        };

        if (document.body) {
            observer.observe(document.body, config);
            return;
        }

        const bodyObserver = new MutationObserver(() => {
            if (!document.body) return;
            bodyObserver.disconnect();
            observer.observe(document.body, config);
            scheduleDomSync();
        });

        bodyObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    bindFeatureOptions((options) => {
        featureOptions = options;
        runPopupPass();
    });

    onReady(() => {
        runPopupPass();
        startPageChangeDetection(handlePageChange);
        startDomObserver();
    });
})();
