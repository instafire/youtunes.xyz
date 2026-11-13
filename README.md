# YouTunes (youtunes.xyz)

> YouTube music and video search, extraction, downloading, and streaming web application built with FastAPI, yt-dlp, FFmpeg, Docker, and Cloudflare Tunnel.

---

## Overview

- **Live domain:** `youtunes.xyz` / `www.youtunes.xyz`
- **Local host port:** `8750` (`http://127.0.0.1:8750`)
- **Docker network:** `youtunes-network`
- **Cloudflare Tunnel ID:** `c0a43dbb-c89f-45be-a37a-2c4ab86eb7c6`
- **Tunnel hostname:** `c0a43dbb-c89f-45be-a37a-2c4ab86eb7c6.cfargotunnel.com`

## Features

1. Search tracks by artist or title, or paste a supported YouTube, YouTube Music, SoundCloud, Bandcamp, Vimeo, TikTok, or Twitter/X URL.
2. Download audio as MP3, M4A/AAC, or FLAC, and video in available resolutions up to 4K.
3. Preview audio in the browser and save extracted tracks in a local browser library.
4. Responsive single-page interface with a dark theme.

## Security and service limits

- Media extraction accepts HTTP(S) URLs only from the supported public media-provider domains. Local/private IP addresses, nonstandard ports, credentials embedded in URLs, and other schemes are rejected before yt-dlp runs.
- Search and extraction work is limited to two concurrent yt-dlp tasks, and a single download is capped at 512 MiB.
- The web container runs as a non-root user with a read-only root filesystem and a temporary filesystem for downloads. The host port is bound to `127.0.0.1`; the Cloudflare Tunnel reaches the app over the private Compose network, so it does not require a public host-port mapping.
- The app is same-origin only and does not enable wildcard CORS.

## Docker services

The stack is managed by `docker-compose.yml`:

- **`youtunes-web`** runs FastAPI and FFmpeg on internal port `8080`; it is available on the host only at `127.0.0.1:8750`.
- **`youtunes-tunnel`** routes traffic from `youtunes.xyz` and `www.youtunes.xyz` to `youtunes-web` over the Compose network.

### Tunnel configuration

1. Copy `deploy/credentials.example.json` to `deploy/<YOUR_TUNNEL_ID>.json` and fill in your Cloudflare credentials.
2. Update the tunnel ID and credentials file path in `deploy/cloudflared.yml` and `docker-compose.yml`.
3. Keep the real credential JSON out of version control; the deploy JSON ignore rule is already in place.

### Commands

```sh
# Start the stack
docker compose up -d

# Follow logs
docker compose logs -f

# Check the local health endpoint
curl http://127.0.0.1:8750/api/health
```

## Development and tests

Install the development dependencies and run the local test suite:

```sh
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

## Cloudflare DNS

In the Cloudflare Dashboard under `youtunes.xyz` → **DNS** → **Records**:

| Type | Name | Target | Proxy status |
| :--- | :--- | :--- | :--- |
| `CNAME` | `@` | `c0a43dbb-c89f-45be-a37a-2c4ab86eb7c6.cfargotunnel.com` | Proxied |
| `CNAME` | `www` | `c0a43dbb-c89f-45be-a37a-2c4ab86eb7c6.cfargotunnel.com` | Proxied |
