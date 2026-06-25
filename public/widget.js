(function () {
  if (window.__nettsmedChatbotLoaded) return;
  window.__nettsmedChatbotLoaded = true;

  var scriptEl = document.currentScript;
  function attr(name, fallback) {
    if (scriptEl && scriptEl.dataset && scriptEl.dataset[name]) return scriptEl.dataset[name];
    return fallback;
  }

  var base = (function () {
    if (scriptEl && scriptEl.dataset && scriptEl.dataset.base) {
      return scriptEl.dataset.base.replace(/\/$/, "");
    }
    if (typeof window.__NETTSMED_CHATBOT_BASE__ === "string" && window.__NETTSMED_CHATBOT_BASE__) {
      return window.__NETTSMED_CHATBOT_BASE__.replace(/\/$/, "");
    }
    var src = scriptEl && scriptEl.src ? scriptEl.src : "";
    return src.replace(/\/widget\.js.*$/, "");
  })();

  // Brand + copy, all driven by data-* (no hardcoded tenant values)
  var COLOR_PRIMARY = attr("primary", "#1F3133");
  var COLOR_HOVER = attr("hover", "#2F5D62");
  var COLOR_ACCENT = attr("accent", "#7FC9C1");
  var INITIAL = attr("initial", "N");
  var LABEL = attr("label", "Chat");
  var ARIA = attr("aria", "Åpne chat");
  var TITLE = attr("title", "Chat");
  var GA_LABEL = attr("gaLabel", "chatbot");
  // Optional page-context passthrough. When the host knows where the user is
  // (e.g. a WP plugin reporting the current admin screen + active stack), it
  // sets data-screen / data-stack; we forward them to the embed so it can
  // surface screen-aware suggestions and weight answers. Absent → no-op.
  var SCREEN = attr("screen", "");
  var STACK = attr("stack", "");

  function injectStyles() {
    if (document.getElementById("nettsmed-chatbot-styles")) return;
    var style = document.createElement("style");
    style.id = "nettsmed-chatbot-styles";
    style.textContent =
      "@keyframes nettsmed-chat-pulse { 0%, 100% { transform: scale(1); opacity: 0.5; } 50% { transform: scale(1.6); opacity: 0; } }" +
      "@keyframes nettsmed-chat-in { 0% { opacity: 0; transform: translateY(16px) scale(0.97); } 100% { opacity: 1; transform: translateY(0) scale(1); } }" +
      "@keyframes nettsmed-btn-in { 0% { opacity: 0; transform: translateY(8px); } 100% { opacity: 1; transform: translateY(0); } }" +
      ".nettsmed-chat-btn { position: fixed; bottom: 20px; right: 20px; z-index: 999998;" +
      "  display: flex; align-items: center; gap: 10px;" +
      "  background: " + COLOR_PRIMARY + "; color: #fff; border: none; cursor: pointer;" +
      "  padding: 10px 18px 10px 10px; border-radius: 999px;" +
      "  font-family: 'DM Sans', system-ui, -apple-system, sans-serif;" +
      "  font-size: 14px; font-weight: 500; letter-spacing: 0.01em;" +
      "  box-shadow: 0 10px 30px -8px rgba(31,49,51,0.45);" +
      "  transition: background 0.25s, box-shadow 0.25s, transform 0.15s;" +
      "  animation: nettsmed-btn-in 0.5s cubic-bezier(0.22,1,0.36,1) both; }" +
      ".nettsmed-chat-btn:hover { background: " + COLOR_HOVER + "; box-shadow: 0 14px 36px -8px rgba(31,49,51,0.55); }" +
      ".nettsmed-chat-btn:active { transform: scale(0.98); }" +
      ".nettsmed-chat-avatar { position: relative; display: flex; align-items: center; justify-content: center;" +
      "  width: 28px; height: 28px; background: rgba(255,255,255,0.12); border-radius: 999px;" +
      "  font-size: 13px; font-weight: 600; }" +
      ".nettsmed-chat-avatar-pulse { position: absolute; inset: 0; border-radius: 999px; background: " + COLOR_ACCENT + "; animation: nettsmed-chat-pulse 2.4s ease-in-out infinite; }" +
      ".nettsmed-chat-wrap { position: fixed; bottom: 20px; right: 20px; z-index: 999999;" +
      "  width: 380px; height: 580px; max-height: calc(100vh - 40px); max-width: calc(100vw - 40px);" +
      "  display: none; border-radius: 14px; overflow: hidden;" +
      "  box-shadow: 0 20px 60px -15px rgba(31,49,51,0.35);" +
      "  border: 1px solid rgba(31,49,51,0.08); background: #fff;" +
      "  animation: nettsmed-chat-in 0.28s cubic-bezier(0.22,1,0.36,1); }" +
      ".nettsmed-chat-wrap iframe { width: 100%; height: 100%; border: none; display: block; background: white; }" +
      "@media (max-width: 480px) {" +
      "  .nettsmed-chat-wrap { width: calc(100vw - 24px); right: 12px; bottom: 12px; height: calc(100vh - 24px); }" +
      "  .nettsmed-chat-btn { bottom: 14px; right: 14px; }" +
      "}";
    document.head.appendChild(style);
  }

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  onReady(function () {
    injectStyles();

    var btn = document.createElement("button");
    btn.className = "nettsmed-chat-btn";
    btn.setAttribute("aria-label", ARIA);

    var avatar = document.createElement("span");
    avatar.className = "nettsmed-chat-avatar";
    var pulse = document.createElement("span");
    pulse.className = "nettsmed-chat-avatar-pulse";
    var n = document.createElement("span");
    n.textContent = INITIAL;
    n.style.position = "relative";
    avatar.appendChild(pulse);
    avatar.appendChild(n);
    btn.appendChild(avatar);

    var label = document.createElement("span");
    label.textContent = LABEL;
    btn.appendChild(label);

    var wrap = document.createElement("div");
    wrap.className = "nettsmed-chat-wrap";

    var iframe = document.createElement("iframe");
    var embedSrc = base + "/embed?ctx=" + encodeURIComponent(window.location.href) + "&t=" + encodeURIComponent((document.title || "").slice(0, 200));
    if (SCREEN) embedSrc += "&screen=" + encodeURIComponent(SCREEN.slice(0, 120));
    if (STACK) embedSrc += "&stack=" + encodeURIComponent(STACK.slice(0, 120));
    iframe.src = embedSrc;
    iframe.title = TITLE;
    iframe.setAttribute("allow", "clipboard-write");
    // Register this iframe as the trusted source for the site-bridge (origin
    // alone is shared across tenants — the bridge also pins to ev.source).
    iframe.addEventListener("load", function () {
      try {
        if (window.__SITE_BRIDGE_CONFIG__) window.__SITE_BRIDGE_CONFIG__.frame = iframe.contentWindow;
      } catch (e) {}
    });
    wrap.appendChild(iframe);

    var SESSION_KEY = "nettsmed_chat_open";

    function openChat(focusInput) {
      btn.style.display = "none";
      wrap.style.display = "block";
      try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (e) {}
      if (focusInput) {
        setTimeout(function () {
          try {
            iframe.focus();
            iframe.contentWindow.postMessage({ type: "focus-input" }, "*");
          } catch (e) {}
        }, 120);
      }
    }

    function closeChat() {
      wrap.style.display = "none";
      btn.style.display = "flex";
      try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    }

    window.addEventListener("message", function (ev) {
      if (!ev || !ev.data) return;
      var data = ev.data;
      if (data.type === "nettsmed-chat-close") {
        closeChat();
        return;
      }
      if (data.type === "nettsmed-chat-event" && typeof data.event === "string") {
        try {
          if (typeof window.gtag === "function") {
            window.gtag("event", data.event, { event_category: "chatbot", event_label: GA_LABEL });
          } else if (Array.isArray(window.dataLayer)) {
            window.dataLayer.push({ event: data.event, event_category: "chatbot", event_label: GA_LABEL });
          }
        } catch (e) {}
      }
    });

    btn.addEventListener("click", function () {
      openChat(true);
    });

    document.body.appendChild(btn);
    document.body.appendChild(wrap);

    try {
      if (sessionStorage.getItem(SESSION_KEY) === "1") {
        openChat(false);
      }
    } catch (e) {}
  });
})();
