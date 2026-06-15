/* @nettsmed/chat-widget — generalized site-bridge (parent engine).
 *
 * Lets the chat iframe interact with the host page (prefill a form, scroll)
 * WITHOUT ever naming a selector. The iframe sends only logical field keys; this
 * parent — which owns the DOM — is the sole party that maps a key to a selector,
 * and only for keys present in window.__SITE_BRIDGE_CONFIG__. Hidden/nonce/auth
 * fields are unreachable by construction (absent from the map). Prefill only —
 * never submits; the human reads and clicks the form's own button.
 *
 * Config shape (printed by the per-client WP mu-plugin in <head>):
 *   window.__SITE_BRIDGE_CONFIG__ = {
 *     iframeOrigin: "https://nettsmed-chatbot.vercel.app",
 *     capabilities: { prefill: true, scroll: true },
 *     forms: {
 *       contact: {
 *         fields: { navn:"input[name='navn']", epost:"input[name='e-post']",
 *                   melding:"textarea[name='melding']" },
 *         scrollTo: "form.jet-form-builder"   // optional
 *       }
 *     }
 *   }
 */
(function () {
  if (window.__nettsmedSiteBridgeLoaded) return;
  window.__nettsmedSiteBridgeLoaded = true;

  var NS = "nettsmed-bridge";
  var V = 1;
  var MAX_LEN = 4000;

  function cfg() {
    return window.__SITE_BRIDGE_CONFIG__ || null;
  }

  function reply(source, origin, id, type, payload) {
    try {
      source.postMessage({ ns: NS, v: V, id: id, type: type, payload: payload }, origin);
    } catch (e) {}
  }

  function applyField(selector, value) {
    var el = document.querySelector(selector);
    if (!el) return false;
    try {
      el.focus();
      el.value = String(value == null ? "" : value).slice(0, MAX_LEN);
      // JetFormBuilder (and most validators) bind to both events.
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
      return true;
    } catch (e) {
      return false;
    }
  }

  function handlePrefill(c, payload) {
    var formKey = payload && payload.form;
    var form = c.forms && c.forms[formKey];
    if (!form || !form.fields) return { ok: false, error: "form_not_found", applied: [] };

    var applied = [];
    var fields = (payload && payload.fields) || {};
    // Only logical keys defined in the config map are honoured — allowlist.
    Object.keys(form.fields).forEach(function (logical) {
      if (Object.prototype.hasOwnProperty.call(fields, logical) && fields[logical] != null && fields[logical] !== "") {
        if (applyField(form.fields[logical], fields[logical])) applied.push(logical);
      }
    });

    if (form.scrollTo) {
      var target = document.querySelector(form.scrollTo);
      if (target && target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return { ok: applied.length > 0, applied: applied };
  }

  function handleScroll(c, payload) {
    var formKey = payload && payload.form;
    var form = c.forms && c.forms[formKey];
    var sel = form && form.scrollTo;
    if (!sel) return { ok: false, error: "no_target" };
    var target = document.querySelector(sel);
    if (target && target.scrollIntoView) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      return { ok: true };
    }
    return { ok: false, error: "not_found" };
  }

  window.addEventListener("message", function (ev) {
    var c = cfg();
    if (!c || !c.iframeOrigin) return;
    // Origin guard — exact match, never "*".
    if (ev.origin !== c.iframeOrigin) return;
    // Source guard — pin to the embedded chat iframe. iframeOrigin is shared
    // across tenants, so origin alone would let any frame on that origin drive
    // the bridge. widget.js registers c.frame on iframe load; if absent (e.g. a
    // bare embed), this degrades to origin-only rather than breaking.
    if (c.frame && ev.source !== c.frame) return;
    var data = ev.data;
    if (!data || data.ns !== NS || data.v !== V || !data.type) return;

    var caps = c.capabilities || {};
    var result;
    if (data.type === "prefill") {
      if (!caps.prefill) result = { ok: false, error: "capability_disabled" };
      else result = handlePrefill(c, data.payload);
      reply(ev.source, ev.origin, data.id, "prefill.result", result);
    } else if (data.type === "scroll") {
      if (!caps.scroll) result = { ok: false, error: "capability_disabled" };
      else result = handleScroll(c, data.payload);
      reply(ev.source, ev.origin, data.id, "scroll.result", result);
    }
    // Unknown types are ignored.
  });
})();
