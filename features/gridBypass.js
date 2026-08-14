/**
 * features/gridBypass.js — 그리드 우회 설정을 MAIN-world 재생 메타데이터 브리지에 전달한다.
 *
 * 실행 컨텍스트: isolated world(확장) — shared/settings.js와 content.js 이후 로드된다.
 * 동작 위치: https://chzzk.naver.com/* 전체. 실제 우회는 MAIN world에서 /live/*에만 적용된다.
 * 하는 일: gridBypassEnabled 옵션을 document.documentElement의 상태 속성으로 동기화한다.
 * 의존: BetterChzzk.utils.bindFeatureOptions.
 * 옵션 키: gridBypassEnabled.
 * 통신: data-betterchzzk-grid-bypass-state 속성("1"/"0").
 */
(() => {
    "use strict";

    const STATE_ATTR = "data-betterchzzk-grid-bypass-state";
    const { bindFeatureOptions } = BetterChzzk.utils;

    function publishState(options) {
        document.documentElement.setAttribute(STATE_ATTR, options.gridBypassEnabled ? "1" : "0");
    }

    bindFeatureOptions(publishState);
})();
