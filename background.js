chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "IGDL_DOWNLOAD") {
    chrome.downloads.download(
      { url: msg.url, filename: msg.filename, saveAs: false },
      () => {
        if (chrome.runtime.lastError) {
          console.error("IGDL download error:", chrome.runtime.lastError.message);
        }
      }
    );
  }
});
