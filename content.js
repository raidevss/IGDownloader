(function () {
  const DOWNLOAD_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';

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
    const seen = new Set();
    const deduped = [];
    for (const r of results) {
      if (!seen.has(r.url)) {
        seen.add(r.url);
        deduped.push(r);
      }
    }
    // Some responses (e.g. reels) omit width/height and only differ by an
    // opaque "type" ranking; Instagram already lists those best-first, so
    // only re-sort when real dimensions are available to sort by.
    if (deduped.some((r) => r.width && r.height)) {
      deduped.sort((a, b) => b.width * b.height - a.width * a.height);
    }
    return deduped;
  }

  async function fetchQualitiesForInfo(info) {
    if (info.href === location.href) {
      const domQ = extractVideoVersions(document.documentElement.outerHTML);
      if (domQ.length) return domQ;
    }
    const res = await fetch(info.href, { credentials: "include" });
    const html = await res.text();
    return extractVideoVersions(html);
  }

  function findShortcodeInfo(container) {
    if (container) {
      const a = container.querySelector(
        'a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/tv/"]'
      );
      if (a) {
        const href = a.getAttribute("href");
        const m = href.match(/\/(p|reel|reels|tv)\/([^/?#]+)/);
        if (m) return { code: m[2], href: new URL(href, location.origin).href };
      }
    }
    const m2 = location.pathname.match(/\/(p|reel|reels|tv)\/([^/]+)/);
    if (m2) return { code: m2[2], href: location.href };
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
      if (node.querySelector && node.querySelector("video")) return node;
      node = node.parentElement;
    }
    return null;
  }

  function removePanel() {
    const p = document.getElementById("igdl-panel");
    if (p) p.remove();
  }

  function showPanel(qualities, code, triggerEl) {
    removePanel();
    const panel = document.createElement("div");
    panel.id = "igdl-panel";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "✕";
    closeBtn.className = "igdl-close-btn";
    closeBtn.addEventListener("click", removePanel);
    panel.appendChild(closeBtn);

    const title = document.createElement("div");
    title.className = "igdl-panel-title";
    title.textContent = "Select quality";
    panel.appendChild(title);

    const select = document.createElement("select");
    select.id = "igdl-quality-select";
    qualities.forEach((q, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      const dims = q.width && q.height ? `${q.width}x${q.height}` : `Quality ${i + 1}`;
      let tag = "";
      if (i === 0) tag = " (highest)";
      else if (i === qualities.length - 1) tag = " (lowest)";
      opt.textContent = dims + tag;
      select.appendChild(opt);
    });
    panel.appendChild(select);

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.textContent = "Download";
    downloadBtn.className = "igdl-download-btn";
    downloadBtn.addEventListener("click", () => {
      const idx = Number(select.value);
      const q = qualities[idx];
      const label = q.width && q.height ? `${q.width}x${q.height}` : `q${idx + 1}`;
      const filename = `instagram_${code}_${label}.mp4`;
      chrome.runtime.sendMessage({ type: "IGDL_DOWNLOAD", url: q.url, filename });
      removePanel();
    });
    panel.appendChild(downloadBtn);

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
    const info = findShortcodeInfo(container);
    if (!info) {
      alert("IG Video Downloader: could not identify this post.");
      return;
    }
    triggerEl.classList.add("igdl-loading");
    let qualities = [];
    try {
      qualities = await fetchQualitiesForInfo(info);
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
      const saveBtn = getClickableAncestor(svg);
      if (!saveBtn || saveBtn.dataset.igdlProcessed) continue;

      const container = findVideoContainer(saveBtn);
      if (!container) continue; // no nearby video -> likely an image-only post

      saveBtn.dataset.igdlProcessed = "1";

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

      wrap.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onDownloadClick(wrap, container);
      });
      wrap.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDownloadClick(wrap, container);
        }
      });

      saveBtn.insertAdjacentElement("afterend", wrap);
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
