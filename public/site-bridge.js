/* @nettsmed/chat-widget — generalized site-bridge (PHASE 6, skeleton).
 * Parent-page engine: reads window.__SITE_BRIDGE_CONFIG__ and handles
 * origin-validated, namespaced, capability-gated requests from the chat iframe
 * (prefill / scroll / context / calculator). Full implementation lands in the
 * site-bridge phase; this stub exists so the package export resolves. */
(function () {
  if (window.__nettsmedSiteBridgeLoaded) return;
  window.__nettsmedSiteBridgeLoaded = true;
  // Intentionally a no-op until the bridge phase ships.
})();
