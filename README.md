# IG Video Downloader

Chrome extension that adds a "Save Video" button to Instagram post/reel pages, letting you pick a video quality (highest to lowest) and download it.

## How it works

- Runs across all of `instagram.com` (home feed, explore, profile, reels tab, and single post/reel/tv pages) since Instagram is a single-page app and posts render in-place without a full navigation.
- It watches the page for Instagram's native bookmark-shaped **Save** icon (present on every post/reel with an attached video) and injects a matching download-arrow icon right next to it, copying that icon's computed color so it blends into both light and dark themes.
- Clicking the icon resolves that specific post's shortcode from a nearby permalink link (or the current URL, on a single post/reel page), then fetches that post's page fresh with your session cookies and parses the `video_versions` array Instagram ships with every video post (multiple resolutions/bitrates).
- A small popover anchored to the icon lists the available qualities, sorted from highest to lowest resolution. Pick one and click **Download** — the file is saved via the browser's native downloads API.

## Install (unpacked, for local/dev use)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Reload any open Instagram tab (or visit `https://www.instagram.com/p/DcLE_-WRHMR/`). Wherever you see a native **Save** (bookmark) icon on a video post/reel, a download-arrow icon appears right next to it.

## Notes / limitations

- Only appears next to posts/reels that have a video. Image-only posts aren't handled.
- For carousel posts with multiple video slides, all detected `video_versions` across slides are listed together — quality options aren't currently grouped per-slide.
- Instagram doesn't always expose real width/height per variant (reels in particular only tag each URL with an opaque `type`). When dimensions aren't available, options are shown as "Quality 1", "Quality 2", etc. in the order Instagram itself returned them (best-first), rather than a real resolution.
- Some posts only have one actual distinct video file behind all listed variants — in that case only one quality option will show, which is correct, not a bug.
- If Instagram changes its DOM structure or the `Save` icon's `aria-label`, icon injection may stop working until updated.
- Downloading content you don't own or don't have rights to redistribute may violate Instagram's Terms of Service. Use for personal archival of your own content or content you have permission to save.
- No external servers are involved — everything happens client-side in your browser using your own logged-in session.
