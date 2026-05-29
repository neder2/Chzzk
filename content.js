(() => {
    const root = window.BetterChzzk = window.BetterChzzk || {};

    function onReady(fn) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", fn, { once: true });
            return;
        }
        fn();
    }

    function normSpace(value) {
        return String(value || "").replace(/\s+/g, " ").trim();
    }

    function normalizeCompact(value) {
        return String(value || "").toLowerCase().replace(/\s+/g, "");
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function isVisible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden";
    }

    function pickLargestVisible(nodes) {
        let best = null;
        let bestArea = -1;
        for (const el of nodes || []) {
            if (!isVisible(el)) continue;
            const rect = el.getBoundingClientRect();
            const area = Math.max(0, rect.width) * Math.max(0, rect.height);
            if (area > bestArea) {
                best = el;
                bestArea = area;
            }
        }
        return best || null;
    }

    function getMainVideoElement() {
        const videos = document.querySelectorAll("video");
        return pickLargestVisible(videos) || videos[0] || null;
    }

    function elementMatchesOrContains(node, selector) {
        if (!(node instanceof Element)) return false;
        return node.matches(selector) || Boolean(node.querySelector(selector));
    }

    function mutationMatchesSelector(mutation, selector) {
        if (mutation.type === "attributes") {
            return elementMatchesOrContains(mutation.target, selector);
        }
        if (mutation.type !== "childList") return false;
        for (const node of mutation.addedNodes || []) {
            if (elementMatchesOrContains(node, selector)) return true;
        }
        for (const node of mutation.removedNodes || []) {
            if (elementMatchesOrContains(node, selector)) return true;
        }
        return false;
    }

    function createThrottledDomSync(run, throttleMs = 160) {
        let scheduled = false;
        let timer = 0;
        let lastRunAt = 0;
        return function scheduleDomSync() {
            if (scheduled) return;

            const elapsed = performance.now() - lastRunAt;
            const delay = Math.max(0, throttleMs - elapsed);
            scheduled = true;

            const queue = () => {
                timer = 0;
                requestAnimationFrame(() => {
                    scheduled = false;
                    lastRunAt = performance.now();
                    run();
                });
            };

            if (delay > 0) {
                timer = window.setTimeout(queue, delay);
                return;
            }

            queue();
        };
    }

    // Feature runtimes stay installed while enabled; route-specific handlers decide mount/unmount/no-op.
    function startPageChangeDetection(handlePageChange) {
        window.addEventListener("popstate", handlePageChange, true);
        window.addEventListener("hashchange", handlePageChange, true);
        return () => {
            window.removeEventListener("popstate", handlePageChange, true);
            window.removeEventListener("hashchange", handlePageChange, true);
        };
    }

    function injectStyleOnce(id, cssText) {
        if (document.getElementById(id)) return null;
        const style = document.createElement("style");
        style.id = id;
        style.textContent = cssText;
        document.documentElement.appendChild(style);
        return style;
    }

    function isLastPage(json, rows, pageSize) {
        const content = json?.content ?? json;
        if (!content) return true;
        if (typeof content.totalPages === "number" && typeof content.page?.number === "number") {
            return content.page.number >= content.totalPages - 1;
        }
        if (typeof content.last === "boolean") return content.last;
        return rows.length < pageSize;
    }

    function setLoadingReason(reasons, on, reason, sync) {
        if (on) reasons.add(reason);
        else reasons.delete(reason);
        sync?.();
    }

    root.utils = {
        ...(root.utils || {}),
        onReady,
        normSpace,
        normalizeCompact,
        sleep,
        isVisible,
        pickLargestVisible,
        getMainVideoElement,
        elementMatchesOrContains,
        mutationMatchesSelector,
        createThrottledDomSync,
        startPageChangeDetection,
        injectStyleOnce,
        isLastPage,
        setLoadingReason,
    };
})();
