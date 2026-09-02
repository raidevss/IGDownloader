(function () {
  const DOWNLOAD_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';

  // Populated by page-hook.js (runs in the page's own MAIN world) as it
  // taps Instagram's real fetch/XHR responses. This is the only reliable
  // source of a reel's video_versions once you've scrolled past whichever
  // reel was present in the initial page load - Instagram never writes
  // later reels' data back into the DOM/HTML text, so the outerHTML-based
  // extraction below can only ever see stale/neighboring data for those.
  const NETWORK_VIDEO_CACHE = new Map();
  const NETWORK_VIDEO_CACHE_MAX = 50;
  window.addEventListener("igdl-video-data", (e) => {
    for (const { code, videoVersions } of e.detail) {
      if (!code || !videoVersions || !videoVersions.length) continue;
      if (NETWORK_VIDEO_CACHE.size >= NETWORK_VIDEO_CACHE_MAX && !NETWORK_VIDEO_CACHE.has(code)) {
        const oldestKey = NETWORK_VIDEO_CACHE.keys().next().value;
        NETWORK_VIDEO_CACHE.delete(oldestKey);
      }
      NETWORK_VIDEO_CACHE.set(code, videoVersions);
    }
  });

  function dedupeByUrl(results) {
    const seen = new Set();
    const deduped = [];
    for (const r of results) {
      if (r.url && !seen.has(r.url)) {
        seen.add(r.url);
        deduped.push(r);
      }
    }
    return deduped;
  }

  function extractVideoVersions(html) {
    const results = [];
    const re = /"video_versions":\s*(\[[^\]]*\])/g;
    let match;
    while ((match = re.exec(html)) !== null) {
      try {
        const arr = JSON.parse(match[1]);
        for (const v of arr) {
          if (v && v.url) {
            results.push({ url: v.url, width: v.width || 0, height: v.height || 0 });
          }
        }
      } catch (e) {
        // skip malformed fragment
      }
    }
    const deduped = dedupeByUrl(results);
    // Some responses (e.g. reels) omit width/height and only differ by an
    // opaque "type" ranking; Instagram already lists those best-first, so
    // only re-sort when real dimensions are available to sort by.
    if (deduped.some((r) => r.width && r.height)) {
      deduped.sort((a, b) => b.width * b.height - a.width * a.height);
    }
    return deduped;
  }

  // Fallback for pages that never got video_versions embedded (e.g. a
  // fresh, non-hydrated fetch of a post that isn't the currently open one -
  // Instagram's server-rendered HTML doesn't include video_versions at all,
  // only the client hydrates it into the DOM). og:video is server-rendered
  // for link-preview crawlers, and the embed page renders a plain <video
  // src> with no client JS required, so both are reachable without
  // depending on hydration state.
  function extractFallbackVideoUrls(html) {
    const results = [];
    const metaRe = /<meta[^>]+property="og:video(?::secure_url)?"[^>]+content="([^"]+)"/g;
    let m;
    while ((m = metaRe.exec(html)) !== null) {
      results.push({ url: m[1].replace(/&amp;/g, "&"), width: 0, height: 0 });
    }
    const videoTagRe = /<video[^>]*\ssrc="(https:[^"]+)"/g;
    while ((m = videoTagRe.exec(html)) !== null) {
      results.push({ url: m[1].replace(/&amp;/g, "&"), width: 0, height: 0 });
    }
    const videoUrlFieldRe = /"video_url":"([^"]+)"/g;
    while ((m = videoUrlFieldRe.exec(html)) !== null) {
      try {
        results.push({ url: JSON.parse(`"${m[1]}"`), width: 0, height: 0 });
      } catch (e) {
        // skip malformed escape sequence
      }
    }
    return dedupeByUrl(results);
  }

  // Instagram's video_versions blocks belong to whichever post/reel object
  // they're embedded in; when the DOM has data for several hydrated posts
  // at once, narrow the search to the region around this post's own
  // "code" field so we don't accidentally grab a neighboring post's video.
  function scopeHtmlToCode(html, code) {
    if (!code) return html;
    const idx = html.indexOf(`"code":"${code}"`);
    if (idx === -1) return html;
    const start = Math.max(0, idx - 20000);
    const end = Math.min(html.length, idx + 20000);
    return html.slice(start, end);
  }

  function extractQualitiesFromHtml(html, code) {
    const scoped = scopeHtmlToCode(html, code);
    let q = extractVideoVersions(scoped);
    if (q.length) return q;
    q = extractVideoVersions(html);
    if (q.length) return q;
    return extractFallbackVideoUrls(html);
  }

  // Last-resort fallback: Instagram's player streams video over MSE using
  // a blob: URL, so the <video> element's own src is never a real file -
  // but the actual .mp4 segment(s) still go out as real network requests,
  // visible in the Resource Timing API regardless of whether Instagram
  // exposes them in any parseable JSON. Only safe to use when the video in
  // this specific container is the one actually playing right now, since
  // otherwise the most-recent network activity could belong to a
  // different post entirely.
  function extractFromNetworkActivity(container) {
    const video = container && container.querySelector("video");
    if (!video || video.paused || video.currentTime <= 0) return [];
    try {
      const entries = performance.getEntriesByType("resource");
      const candidates = entries.filter(
        (e) => /\.mp4(\?|$)/i.test(e.name) || /\/v\/t2\//.test(e.name)
      );
      candidates.sort((a, b) => b.responseEnd - a.responseEnd);
      const seen = new Set();
      const results = [];
      for (const e of candidates) {
        if (seen.has(e.name)) continue;
        seen.add(e.name);
        results.push({ url: e.name, width: 0, height: 0 });
        if (results.length >= 5) break;
      }
      return results;
    } catch (e) {
      return [];
    }
  }

  async function fetchQualitiesForInfo(info, container) {
    // 1) A real network response tagged with this exact code, captured by
    // page-hook.js as Instagram's own client fetched it. Checked first
    // because it's authoritative - unlike outerHTML, it can't be stale or
    // ambiguous between neighboring reels.
    let cached = NETWORK_VIDEO_CACHE.get(info.code);
    if (cached && cached.length) {
      let q = dedupeByUrl(cached);
      if (q.some((r) => r.width && r.height)) q.sort((a, b) => b.width * b.height - a.width * a.height);
      if (q.length) return q;
    }

    // 2) Whatever's already hydrated in the current page's DOM - covers
    // the common case where the icon being clicked belongs to a post/reel
    // that's actually rendered on screen right now.
    let q = extractQualitiesFromHtml(document.documentElement.outerHTML, info.code);
    if (q.length) return q;

    // 3) A fresh fetch of the post's own page. Instagram's server-rendered
    // HTML doesn't always include video_versions (client hydration adds
    // it), so this only helps for post types that do SSR it, but it's a
    // free thing to try.
    try {
      const res = await fetch(info.href, { credentials: "include" });
      const html = await res.text();
      q = extractQualitiesFromHtml(html, info.code);
      if (q.length) return q;
    } catch (e) {
      console.error("IGDL: direct page fetch failed", e);
    }

    // 4) Network activity for the currently-playing video in this
    // container, as a last resort.
    return extractFromNetworkActivity(container);
  }

  // A shortcode-bearing path is EXACTLY /keyword/code/ - nothing before the
  // keyword, nothing after the code. Unanchored matching used to accept
  // decoys like /reels/audio/28220520900913430/ (captures "audio" as a fake
  // "code") and /some_username/reels/, both of which are common near a
  // reel's action buttons and neither of which identifies the reel itself.
  const SHORTCODE_RE = /^\/(p|reel|reels|tv)\/([^/?#]+)\/?(?:[?#].*)?$/;

  // Picks the post/reel permalink that's visually closest on screen to
  // whatever was clicked, rather than trusting DOM nesting (the permalink
  // isn't always a descendant of the nearest "post" wrapper). Falls back to
  // location.pathname, which Instagram keeps in sync with whichever reel is
  // centered on the Reels feed even though that feed exposes no per-item
  // permalink anchor at all - confirmed live: DcwsOejx9jI -> DcqjoKYSZUG ->
  // DcxVoNwBrgV -> Dcv76S6ld2j as the user scrolled.
  function findShortcodeInfo(container, triggerEl) {
    const refEl = triggerEl || container;
    const refRect = refEl ? refEl.getBoundingClientRect() : null;
    const anchors = document.querySelectorAll(
      'a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/tv/"]'
    );
    let best = null;
    let bestDist = Infinity;
    for (const a of anchors) {
      const href = a.getAttribute("href");
      const m = href && href.match(SHORTCODE_RE);
      if (!m) continue;
      const r = a.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // not rendered on screen
      const dist = refRect
        ? Math.abs((r.top + r.bottom) / 2 - (refRect.top + refRect.bottom) / 2)
        : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = { type: m[1], code: m[2], href: new URL(href, location.origin).href };
      }
    }
    if (best) return best;
    const m2 = location.pathname.match(SHORTCODE_RE);
    if (m2) return { type: m2[1], code: m2[2], href: location.href };
    return null;
  }

  function getClickableAncestor(el) {
    let node = el;
    for (let i = 0; i < 6 && node; i++) {
      if (node.getAttribute && node.getAttribute("role") === "button") return node;
      node = node.parentElement;
    }
    return el.parentElement;
  }

  function findVideoContainer(fromEl) {
    let node = fromEl;
    for (let i = 0; i < 14 && node; i++) {
      if (node.querySelector) {
        // More than one Save button means this ancestor has widened past the
        // current post into a wrapper shared with neighboring posts - stop
        // here rather than returning a video that belongs to one of them.
        if (node.querySelectorAll('svg[aria-label="Save"]').length > 1) return null;
        if (node.querySelector("video")) return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function getActionBarDirection(saveBtn) {
    // Walk up until we find the ancestor whose parent holds several small,
    // icon-button-sized children (Like/Comment/Share/Save/...) - that's the
    // real action bar, as opposed to some inner single-icon centering
    // wrapper closer by, or an outer card wrapper whose children are large
    // structural blocks that merely happen to contain an svg somewhere.
    let node = saveBtn;
    for (let i = 0; i < 10 && node; i++) {
      const parent = node.parentElement;
      if (parent) {
        const iconSiblings = Array.from(parent.children).filter((c) => {
          if (!c.querySelector || !c.querySelector("svg")) return false;
          const r = c.getBoundingClientRect();
          return r.width > 0 && r.width < 60 && r.height < 60;
        });
        if (iconSiblings.length >= 3) {
          return getComputedStyle(parent).flexDirection;
        }
      }
      node = parent;
    }
    return "row";
  }

  function removePanel() {
    const p = document.getElementById("igdl-panel");
    if (p) p.remove();
  }

  // Instagram's own menus (the "..." dropdown, share sheet, etc.) are dark
  // by default but respect a light-theme opt-in; sample the page itself
  // instead of guessing from prefers-color-scheme, since IG's theme choice
  // isn't necessarily tied to the OS setting.
  function isDarkTheme() {
    const bg = getComputedStyle(document.body).backgroundColor;
    const m = bg.match(/\d+/g);
    if (!m) return true;
    const [r, g, b] = m.map(Number);
    return (r + g + b) / 3 < 128;
  }

  function showPanel(qualities, code, triggerEl) {
    removePanel();
    const dark = isDarkTheme();

    const panel = document.createElement("div");
    panel.id = "igdl-panel";
    panel.className = dark ? "igdl-theme-dark" : "igdl-theme-light";

    qualities.forEach((q, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "igdl-option";
      const dims = q.width && q.height ? `${q.width} × ${q.height}` : `Quality ${i + 1}`;
      let tag = "";
      if (qualities.length > 1) {
        if (i === 0) tag = " · Best";
        else if (i === qualities.length - 1) tag = " · Lowest";
      }
      row.textContent = dims + tag;
      row.addEventListener("click", () => {
        const label = q.width && q.height ? `${q.width}x${q.height}` : `q${i + 1}`;
        const filename = `instagram_${code}_${label}.mp4`;
        chrome.runtime.sendMessage({ type: "IGDL_DOWNLOAD", url: q.url, filename });
        removePanel();
      });
      panel.appendChild(row);
    });

    document.body.appendChild(panel);

    const rect = triggerEl.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    let top = rect.bottom + 6;
    let left = rect.right - panelRect.width;
    if (top + panelRect.height > window.innerHeight) top = rect.top - panelRect.height - 6;
    if (top < 8) top = 8;
    if (left < 8) left = 8;
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;

    function onOutsideClick(e) {
      if (!panel.contains(e.target) && e.target !== triggerEl && !triggerEl.contains(e.target)) {
        removePanel();
        document.removeEventListener("mousedown", onOutsideClick, true);
      }
    }
    document.addEventListener("mousedown", onOutsideClick, true);
  }

  async function onDownloadClick(triggerEl, container) {
    removePanel();
    const info = findShortcodeInfo(container, triggerEl);
    if (!info) {
      alert("IG Video Downloader: could not identify this post.");
      return;
    }
    triggerEl.classList.add("igdl-loading");
    let qualities = [];
    try {
      qualities = await fetchQualitiesForInfo(info, container);
    } catch (e) {
      console.error("IGDL: failed to fetch qualities", e);
    }
    triggerEl.classList.remove("igdl-loading");

    if (!qualities.length) {
      alert("IG Video Downloader: no video found for this post.");
      return;
    }
    showPanel(qualities, info.code, triggerEl);
  }

  function injectButtons() {
    const saveSvgs = document.querySelectorAll('svg[aria-label="Save"]');
    for (const svg of saveSvgs) {
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue; // hidden/duplicate a11y clone

      const saveBtn = getClickableAncestor(svg);
      if (!saveBtn) continue;

      // Live DOM check instead of a permanent flag: Instagram's React tree
      // can re-render and strip our injected node on its own, and a flag
      // left on saveBtn would then block us from ever re-adding it.
      const sibling = saveBtn.nextElementSibling;
      if (sibling && sibling.classList && sibling.classList.contains("igdl-inline-wrap")) {
        continue;
      }

      const container = findVideoContainer(saveBtn);
      if (!container) continue; // no nearby video -> likely an image-only post

      const wrap = document.createElement("div");
      wrap.className = "igdl-inline-wrap";
      wrap.setAttribute("role", "button");
      wrap.tabIndex = 0;
      wrap.setAttribute("aria-label", "Download video");
      wrap.title = "Download video";
      wrap.innerHTML = DOWNLOAD_ICON_SVG;

      const themeColor = getComputedStyle(svg).color;
      const newSvg = wrap.querySelector("svg");
      if (themeColor) newSvg.style.color = themeColor;

      wrap.addEventListener("mousedown", (e) => e.stopPropagation());
      wrap.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onDownloadClick(wrap, container);
      });
      wrap.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onDownloadClick(wrap, container);
        }
      });

      const direction = getActionBarDirection(saveBtn);
      const isColumn = direction.indexOf("column") !== -1;

      if (isColumn) {
        // Reels: plenty of vertical room in the icon rail, keep it in the
        // normal flow right below Save and just give it breathing room.
        wrap.classList.add("igdl-inline-wrap--column");
        saveBtn.insertAdjacentElement("afterend", wrap);
      } else {
        // Posts/feed: the action row is width-constrained, so adding a 6th
        // icon in normal flow can overflow and wrap the whole row onto a
        // new line, pushing the caption down. Keep it a plain sibling
        // (never a child of Instagram's own button - React can wipe
        // injected children on re-render) but pull it out of flow and
        // pin it to Save's own on-screen position so it can never affect
        // the row's width.
        wrap.classList.add("igdl-inline-wrap--row");
        const parent = saveBtn.parentElement;
        if (parent) {
          if (getComputedStyle(parent).position === "static") {
            parent.style.position = "relative";
          }
          const parentRect = parent.getBoundingClientRect();
          const saveRect = saveBtn.getBoundingClientRect();
          wrap.style.position = "absolute";
          wrap.style.top = `${saveRect.top - parentRect.top + (saveRect.height - 40) / 2}px`;
          wrap.style.left = `${saveRect.left - parentRect.left - 44}px`;
        }
        saveBtn.insertAdjacentElement("afterend", wrap);
      }
    }
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      injectButtons();
    }, 400);
  }

  scheduleScan();
  new MutationObserver(scheduleScan).observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
