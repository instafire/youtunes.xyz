# YouTunes (youtunes.xyz)

> Modern, full-featured, zero-ad YouTube music & video downloader and streaming web application built with FastAPI, yt-dlp, FFmpeg, and Docker, secured behind Cloudflare Tunnel.

---

## 🚀 Overview

- **Live Domain:** `youtunes.xyz` / `www.youtunes.xyz`
- **Host Port:** `8750` (`http://localhost:8750`)
- **Docker Network:** `youtunes-network`
- **Cloudflare Tunnel ID:** `c0a43dbb-c89f-45be-a37a-2c4ab86eb7c6`
- **Tunnel Hostname:** `c0a43dbb-c89f-45be-a37a-2c4ab86eb7c6.cfargotunnel.com`

---

## ⚡ Features

1. **Instant YouTube Search & Convert:**
   - Search by artist or title directly in the app without requiring an API key.
   - Paste direct YouTube, Shorts, Music, SoundCloud, or Twitter/X URLs.
2. **Lossless Audio & HD Video Downloads:**
   - **Audio:** MP3 (320 kbps & 192 kbps), original M4A/AAC, and lossless FLAC.
   - **Video:** 4K UHD, 2K QHD, Full HD 1080p, HD 720p, 480p, 360p with audio merged.
3. **In-Browser Audio Player:**
   - Direct audio stream playback with live scrubber, volume control, and time tracking.
4. **Curated & Trending Tracks:**
   - Pre-loaded popular music and viral tracks ready to stream or download in 1 click.
5. **Modern Glassmorphic UI:**
   - Dark mode aesthetic with ambient glowing gradients, responsive on mobile and desktop.

---

## 🐳 Docker Services

The stack is managed via `docker-compose.yml`:

- **`youtunes-web`**: Python 3.11 container with `yt-dlp` and `ffmpeg` running the FastAPI application on internal port `8080` (mapped to host port `8750`).
- **`youtunes-tunnel`**: Official Cloudflare `cloudflared` edge connector routing traffic from `youtunes.xyz` directly to `youtunes-web`.

### Tunnel Configuration

1. Copy `deploy/credentials.example.json` to `deploy/<YOUR_TUNNEL_ID>.json` and fill in your Cloudflare credentials.
2. Update the tunnel ID and credentials file path in `deploy/cloudflared.yml` and `docker-compose.yml`.

### Commands

```powershell
# Start the stack in background
docker compose up -d

# Check logs
docker compose logs -f

# Check health
curl http://localhost:8750/api/health
```


---

## 🌐 Cloudflare DNS Configuration

In the Cloudflare Dashboard under `youtunes.xyz` -> **DNS** -> **Records**:

| Type | Name | Target | Proxy Status |
| :--- | :--- | :--- | :--- |
| `CNAME` | `@` | `c0a43dbb-c89f-45be-a37a-2c4ab86eb7c6.cfargotunnel.com` | Proxied ☁️ (Orange) |
| `CNAME` | `www` | `c0a43dbb-c89f-45be-a37a-2c4ab86eb7c6.cfargotunnel.com` | Proxied ☁️ (Orange) |
