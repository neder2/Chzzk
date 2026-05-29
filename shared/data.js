(() => {
    const root = globalThis.BetterChzzk = globalThis.BetterChzzk || {};
    const ARRAY_RESPONSE_KEYS = Object.freeze(["data", "videos", "list", "items", "content"]);

    function pickArray(obj, keys = ARRAY_RESPONSE_KEYS) {
        if (!obj || typeof obj !== "object") return null;
        if (Array.isArray(obj)) return obj;

        for (const key of keys) {
            if (Array.isArray(obj[key])) return obj[key];
        }

        for (const value of Object.values(obj)) {
            if (Array.isArray(value) && value.length && typeof value[0] === "object") return value;
        }

        return null;
    }

    root.utils = {
        ...(root.utils || {}),
        ARRAY_RESPONSE_KEYS,
        pickArray,
    };
})();
