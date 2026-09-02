// Runs in the page's own MAIN world (see manifest.json), not the isolated
// content-script world - this is required to see Instagram's own fetch/XHR
// calls at all. As you scroll the Reels feed, Instagram never writes new
// reels' data into the DOM/HTML text - it only ever exists in the API
// response that populates React state. Scanning outerHTML (what content.js
// used to rely on exclusively) can only ever see whatever was there on
// first load, so it silently goes stale the moment you scroll past that
// reel. Tapping the actual network responses is the only reliable source.
(function () {
  if (window.__igdlHooked) return;
  window.__igdlHooked = true;

  function collect(node, out) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) collect(item, out);
      return;
    }
    if (Array.isArray(node.video_versions) && node.video_versions.length && node.code) {
      out.push({
        code: node.code,
        videoVersions: node.video_versions
          .filter((v) => v && v.url)
          .map((v) => ({ url: v.url, width: v.width || 0, height: v.height || 0 })),
      });
    }
    for (const key in node) collect(node[key], out);
  }

  function handleText(text) {
    if (!text || text.indexOf('"video_versions"') === -1) return;
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return; // not a plain JSON body (e.g. multipart GraphQL stream) - skip
    }
    const out = [];
    collect(json, out);
    if (out.length) {
      window.dispatchEvent(new CustomEvent("igdl-video-data", { detail: out }));
    }
  }

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    p.then((res) => {
      try {
        res
          .clone()
          .text()
          .then(handleText)
          .catch(() => {});
      } catch (e) {}
    }).catch(() => {});
    return p;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (...args) {
    return origOpen.apply(this, args);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        handleText(this.responseText);
      } catch (e) {}
    });
    return origSend.apply(this, args);
  };
})();
