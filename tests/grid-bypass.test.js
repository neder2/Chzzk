const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");

const repoRoot = path.resolve(__dirname, "..");
const pageSource = fs.readFileSync(path.join(repoRoot, "features", "gridBypassPage.js"), "utf8");
const isolatedSource = fs.readFileSync(path.join(repoRoot, "features", "gridBypass.js"), "utf8");

function createDom(pathname = "/live/test-channel") {
    return new JSDOM("<!doctype html><html><head></head><body></body></html>", {
        url: `https://chzzk.naver.com${pathname}`,
        runScripts: "outside-only",
    });
}

function createPlaybackFixture(host = "livecloud.pstatic.net") {
    return {
        meta: { videoId: "measured-live", p2p: true },
        media: [
            {
                mediaId: "HLS",
                protocol: "HLS",
                path: `https://${host}/chzzk/live/master.m3u8`,
                p2pPath: "nliveconnector://hls-master",
                p2pPathUrlEncoding: true,
                encodingTrack: [
                    {
                        encodingTrackId: "1080p",
                        videoWidth: 1920,
                        videoHeight: 1080,
                        p2pPath: "nliveconnector://1080p",
                        p2pPathUrlEncoding: true,
                    },
                    {
                        encodingTrackId: "480p",
                        videoWidth: 852,
                        videoHeight: 480,
                    },
                ],
            },
            {
                mediaId: "LLHLS",
                protocol: "HLS",
                latency: "lowLatency",
                path: `https://${host}/chzzk/live/ll-master.m3u8`,
                p2pPath: "nliveconnector://ll-master",
                encodingTrack: [
                    {
                        encodingTrackId: "720p",
                        videoWidth: 1280,
                        videoHeight: 720,
                        p2pPath: "nliveconnector://720p",
                    },
                ],
            },
        ],
    };
}

test("grid bypass handles every measured direct HLS host and keeps non-P2P track data", () => {
    for (const host of ["livecloud.pstatic.net", "nvelop-livecloud.pstatic.net", "ex-nlive-streaming.navercdn.com"]) {
        const dom = createDom();
        dom.window.document.documentElement.setAttribute("data-betterchzzk-grid-bypass-state", "1");
        dom.window.eval(pageSource);

        const fixture = createPlaybackFixture(host);
        const result = dom.window.JSON.parse(JSON.stringify(fixture));

        assert.equal(result.meta.p2p, false);
        assert.equal(result.media[0].path, `https://${host}/chzzk/live/master.m3u8`);
        assert.equal(result.media[0].p2pPath, undefined);
        assert.equal(result.media[0].p2pPathUrlEncoding, undefined);
        assert.equal(result.media[0].encodingTrack[0].encodingTrackId, "1080p");
        assert.equal(result.media[0].encodingTrack[0].p2pPath, undefined);
        assert.equal(result.media[0].encodingTrack[0].p2pPathUrlEncoding, undefined);
        assert.deepEqual(
            JSON.parse(JSON.stringify(result.media[0].encodingTrack[1])),
            fixture.media[0].encodingTrack[1]
        );
        assert.equal(result.media[1].p2pPath, undefined);
        assert.equal(result.media[1].encodingTrack[0].p2pPath, undefined);
        assert.equal(dom.window.document.documentElement.dataset.betterchzzkGridBypassPageReady, "1");
        dom.window.close();
    }
});

test("grid bypass fails closed outside the measured direct HLS shapes", () => {
    const dom = createDom();
    dom.window.document.documentElement.setAttribute("data-betterchzzk-grid-bypass-state", "1");
    dom.window.eval(pageSource);

    for (const host of ["media.example.invalid", "livecloud.pstatic.net.example.invalid"]) {
        const untrusted = createPlaybackFixture(host);
        const parsedUntrusted = dom.window.JSON.parse(JSON.stringify(untrusted));
        assert.equal(parsedUntrusted.meta.p2p, true);
        assert.equal(parsedUntrusted.media[0].p2pPath, untrusted.media[0].p2pPath);
        assert.equal(parsedUntrusted.media[0].encodingTrack[0].p2pPath, untrusted.media[0].encodingTrack[0].p2pPath);
    }

    const unrelated = { media: [{ mediaId: "DASH", protocol: "DASH", p2pPath: "leave-me" }] };
    assert.deepEqual(JSON.parse(JSON.stringify(dom.window.JSON.parse(JSON.stringify(unrelated)))), unrelated);
    dom.window.close();
});

test("grid bypass follows its setting, live route, and native reviver contract", () => {
    const dom = createDom();
    dom.window.eval(pageSource);
    const serialized = JSON.stringify(createPlaybackFixture());

    assert.equal(dom.window.document.documentElement.hasAttribute("data-betterchzzk-grid-bypass-state"), false);
    assert.equal(dom.window.JSON.parse(serialized).media[0].p2pPath, "nliveconnector://hls-master");

    dom.window.document.documentElement.setAttribute("data-betterchzzk-grid-bypass-state", "0");
    assert.equal(dom.window.JSON.parse(serialized).media[0].p2pPath, "nliveconnector://hls-master");

    dom.window.document.documentElement.setAttribute("data-betterchzzk-grid-bypass-state", "1");
    assert.equal(dom.window.JSON.parse(serialized).media[0].p2pPath, undefined);
    assert.equal(
        dom.window.JSON.parse(serialized, (_key, value) => value).media[0].p2pPath,
        "nliveconnector://hls-master"
    );

    dom.window.history.replaceState(null, "", "/video/123");
    assert.equal(dom.window.JSON.parse(serialized).media[0].p2pPath, "nliveconnector://hls-master");
    dom.window.close();
});

test("isolated grid bypass bridge waits for loaded options and publishes later changes", () => {
    const dom = createDom();
    let optionListener = null;
    dom.window.BetterChzzk = {
        utils: {
            bindFeatureOptions(listener) {
                optionListener = listener;
            },
        },
    };

    dom.window.eval(isolatedSource);

    assert.equal(dom.window.document.documentElement.hasAttribute("data-betterchzzk-grid-bypass-state"), false);
    assert.equal(typeof optionListener, "function");
    optionListener({ gridBypassEnabled: true });
    assert.equal(dom.window.document.documentElement.dataset.betterchzzkGridBypassState, "1");
    optionListener({ gridBypassEnabled: false });
    assert.equal(dom.window.document.documentElement.dataset.betterchzzkGridBypassState, "0");
    dom.window.close();
});
