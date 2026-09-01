(function () {
  const STATE = { qualities: [], shortcode: getShortcode(location.pathname) };

  function getShortcode(pathname) {
    const m = pathname.match(/\/(?:p|reel|reels|tv)\/([^/]+)/);
    return m ? m[1] : "video";
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
    const seen = new Set();
    const deduped = [];
    for (const r of results) {
      if (!seen.has(r.url)) {
        seen.add(r.url);
        deduped.push(r);
      }
    }
    deduped.sort((a, b) => b.width * b.height - a.width * a.height);
    return deduped;
  }

  async function fetchQualities() {
    let html = document.documentElement.outerHTML;
    let qualities = extractVideoVersions(html);
    if (qualities.length) return qualities;

    const res = await fetch(location.href, { credentials: "include" });
    html = await res.text();
    return extractVideoVersions(html);
  }

  function removePanel() {
    const p = document.getElementById("igdl-panel");
    if (p) p.remove();
  }

  function createButton() {
    if (document.getElementById("igdl-save-btn")) return;
    const btn = document.createElement("button");
    btn.id = "igdl-save-btn";
    btn.type = "button";
    btn.textContent = "⬇ Save Video";
    btn.className = "igdl-btn";
    btn.addEventListener("click", onSaveClick);
    document.body.appendChild(btn);
  }

  async function onSaveClick() {
    removePanel();
    const btn = document.getElementById("igdl-save-btn");
    const originalText = btn.textContent;
    btn.textContent = "Scanning…";
    btn.disabled = true;

    let qualities = [];
    try {
      qualities = await fetchQualities();
    } catch (e) {
      console.error("IGDL: failed to fetch qualities", e);
    }

    btn.textContent = originalText;
    btn.disabled = false;

    if (!qualities.length) {
      alert("IG Video Downloader: no video found on this page.");
      return;
    }
    STATE.qualities = qualities;
    showPanel(qualities);
  }

  function showPanel(qualities) {
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
      const dims = q.width && q.height ? `${q.width}x${q.height}` : `Option ${i + 1}`;
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
    downloadBtn.className = "igdl-btn igdl-download-btn";
    downloadBtn.addEventListener("click", () => {
      const idx = Number(select.value);
      const q = qualities[idx];
      const filename = `instagram_${STATE.shortcode}_${q.width}x${q.height}.mp4`;
      chrome.runtime.sendMessage({ type: "IGDL_DOWNLOAD", url: q.url, filename });
      removePanel();
    });
    panel.appendChild(downloadBtn);

    document.body.appendChild(panel);
  }

  createButton();

  let lastPath = location.pathname;
  new MutationObserver(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      STATE.shortcode = getShortcode(location.pathname);
      removePanel();
      createButton();
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
