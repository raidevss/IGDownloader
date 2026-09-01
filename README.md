# IG Video Downloader

Chrome extension that adds a "Save Video" button to Instagram post/reel pages, letting you pick a video quality (highest to lowest) and download it.

## How it works

- On `instagram.com/p/*`, `/reel/*`, `/reels/*`, and `/tv/*` pages, a floating "⬇ Save Video" button is injected.
- Clicking it scans the page's own embedded data for the `video_versions` array Instagram ships with every video post (multiple resolutions/bitrates). If nothing is found in the current DOM (e.g. after an in-app SPA navigation), it re-fetches the same URL with your session cookies and parses that instead.
- A small panel lists the available qualities, sorted from highest to lowest resolution. Pick one and click **Download** — the file is saved via the browser's native downloads API.

## Install (unpacked, for local/dev use)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Visit any Instagram post/reel URL, e.g. `https://www.instagram.com/p/DcLE_-WRHMR/`, and use the Save button in the bottom-right corner.

## Notes / limitations

- Only works on posts that contain a video. Image-only posts/carousels aren't handled.
- For carousel posts with multiple video slides, all detected `video_versions` across slides are listed together — quality options aren't currently grouped per-slide.
- Downloading content you don't own or don't have rights to redistribute may violate Instagram's Terms of Service. Use for personal archival of your own content or content you have permission to save.
- No external servers are involved — everything happens client-side in your browser using your own logged-in session.
