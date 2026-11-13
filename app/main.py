import asyncio
import ipaddress
import logging
import re
import secrets
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

import yt_dlp
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

app = FastAPI(title="YouTunes Studio", version="2.0.0")

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

DOWNLOAD_DIR = Path(tempfile.gettempdir()) / "youtunes_downloads"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_URL_LENGTH = 2048
MAX_SEARCH_LENGTH = 200
MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
MAX_VIDEO_HEIGHT = 2160
MEDIA_SEMAPHORE = asyncio.Semaphore(2)
ALLOWED_MEDIA_DOMAINS = (
    "youtube.com",
    "youtube-nocookie.com",
    "youtu.be",
    "soundcloud.com",
    "bandcamp.com",
    "vimeo.com",
    "tiktok.com",
    "twitter.com",
    "x.com",
)
logger = logging.getLogger(__name__)


@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
    )
    return response


def validate_media_url(value: str) -> str:
    """Accept only HTTP(S) URLs hosted by the media providers used by this app."""
    url = (value or "").strip()
    if not url or len(url) > MAX_URL_LENGTH:
        raise HTTPException(status_code=400, detail="A valid media URL is required.")
    if any(ord(char) < 32 or ord(char) == 127 for char in url):
        raise HTTPException(
            status_code=400, detail="The media URL contains invalid characters."
        )

    if url.startswith("//"):
        url = "https:" + url
    else:
        explicit_scheme = re.match(r"^([A-Za-z][A-Za-z0-9+.-]*)://", url)
        if explicit_scheme:
            if explicit_scheme.group(1).lower() not in {"http", "https"}:
                raise HTTPException(
                    status_code=400, detail="Only HTTP(S) media URLs are allowed."
                )
        else:
            url = "https://" + url
    if len(url) > MAX_URL_LENGTH:
        raise HTTPException(status_code=400, detail="The media URL is too long.")

    try:
        parsed = urlsplit(url)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail="The media URL is invalid."
        ) from exc

    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or port not in {None, 80, 443}
    ):
        raise HTTPException(
            status_code=400, detail="Only supported public media URLs are allowed."
        )

    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address is not None:
        if not address.is_global:
            raise HTTPException(
                status_code=400, detail="Private and local media addresses are blocked."
            )
        raise HTTPException(
            status_code=400, detail="Direct IP media URLs are not supported."
        )

    try:
        normalized_host = hostname.rstrip(".").encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise HTTPException(
            status_code=400, detail="The media URL host is invalid."
        ) from exc

    if not any(
        normalized_host == domain or normalized_host.endswith("." + domain)
        for domain in ALLOWED_MEDIA_DOMAINS
    ):
        raise HTTPException(
            status_code=400, detail="URL host is not a supported media provider."
        )
    return url


async def run_media_task(func):
    """Bound concurrent yt-dlp work and fail quickly when the service is busy."""
    try:
        await asyncio.wait_for(MEDIA_SEMAPHORE.acquire(), timeout=0.25)
    except TimeoutError as exc:
        raise HTTPException(
            status_code=503, detail="Media service is busy; retry shortly."
        ) from exc
    try:
        future = asyncio.get_running_loop().run_in_executor(None, func)
        return await asyncio.shield(future)
    except asyncio.CancelledError:
        try:
            await asyncio.shield(future)
        except asyncio.CancelledError:
            pass
        except Exception as exc:  # noqa: BLE001 -- drain-and-discard: cancellation must win
            logger.debug(
                "Discarding media task result after cancellation (%s)",
                type(exc).__name__,
            )
        raise
    finally:
        MEDIA_SEMAPHORE.release()


def enforce_download_size_limit(progress):
    try:
        downloaded = int(progress.get("downloaded_bytes") or 0)
    except (TypeError, ValueError):
        return
    if downloaded > MAX_DOWNLOAD_BYTES:
        raise yt_dlp.utils.DownloadError("Download exceeds the configured size limit.")


def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r'[\x00-\x1f\x7f\\/*?:"<>|]', "", name).strip(" .")
    return cleaned[:180] if cleaned else "youtunes_track"


def remove_file_safely(path: Path):
    try:
        if path.exists():
            path.unlink()
    except OSError:
        pass


def remove_download_group(temp_id: str):
    for path in DOWNLOAD_DIR.glob(f"{temp_id}_*"):
        remove_file_safely(path)


class InfoRequest(BaseModel):
    url: str = Field(min_length=1, max_length=MAX_URL_LENGTH)


@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def index():
    index_file = TEMPLATES_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Template not found")
    return index_file.read_text(encoding="utf-8")


@app.api_route("/api/health", methods=["GET", "HEAD"])
async def health():
    return {
        "status": "healthy",
        "service": "YouTunes Studio",
        "domain": "youtunes.xyz",
        "version": "2.0.0",
    }


@app.api_route("/api/trending", methods=["GET", "HEAD"])
async def trending():
    return {"trending": []}


@app.post("/api/info")
async def get_info(req: InfoRequest):
    url = validate_media_url(req.url)

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        "skip_download": True,
        "noplaylist": True,
        "cachedir": False,
        "socket_timeout": 15,
        "retries": 1,
    }

    try:

        def extract():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                return ydl.extract_info(url, download=False)

        info = await run_media_task(extract)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Track analysis failed (%s)", type(exc).__name__)
        raise HTTPException(
            status_code=502, detail="Unable to analyze this media URL."
        ) from exc

    if not info:
        raise HTTPException(status_code=404, detail="Track not found")

    formats = info.get("formats") or []

    # Direct audio stream URL for preview playback
    stream_url = None
    audio_formats = [
        f for f in formats if f.get("vcodec") == "none" and f.get("acodec") != "none"
    ]
    if audio_formats:
        audio_formats.sort(key=lambda x: x.get("abr") or 0, reverse=True)
        stream_url = audio_formats[0].get("url")
    elif formats:
        with_audio = [f for f in formats if f.get("acodec") != "none"]
        if with_audio:
            stream_url = with_audio[0].get("url")

    # Audio format specs
    audio_options = [
        {
            "format_id": "mp3-320",
            "ext": "mp3",
            "quality": "320 kbps",
            "label": "Ultra Hi-Fi",
            "type": "audio",
            "sample_rate": "48 kHz · CBR",
        },
        {
            "format_id": "mp3-192",
            "ext": "mp3",
            "quality": "192 kbps",
            "label": "Standard HQ",
            "type": "audio",
            "sample_rate": "44.1 kHz · VBR",
        },
        {
            "format_id": "m4a",
            "ext": "m4a",
            "quality": "Original AAC",
            "label": "Direct Demux",
            "type": "audio",
            "sample_rate": "Untouched Stream",
        },
        {
            "format_id": "flac",
            "ext": "flac",
            "quality": "Lossless FLAC",
            "label": "Master Quality",
            "type": "audio",
            "sample_rate": "24-bit · Lossless",
        },
    ]

    # Video format specs
    video_options = []
    seen_heights = set()
    for f in formats:
        height = f.get("height")
        if height and height not in seen_heights and 360 <= height <= MAX_VIDEO_HEIGHT:
            seen_heights.add(height)
            filesize = f.get("filesize") or f.get("filesize_approx")
            size_str = (
                f" (~{round(filesize / (1024 * 1024), 1)} MB)" if filesize else ""
            )

            label = f"{height}p"
            tag = "Standard"
            if height >= 2160:
                label = "4K Ultra HD"
                tag = "2160p 60fps"
            elif height >= 1440:
                label = "2K Quad HD"
                tag = "1440p"
            elif height >= 1080:
                label = "Full HD"
                tag = "1080p 60fps"
            elif height >= 720:
                label = "HD Ready"
                tag = "720p"

            video_options.append(
                {
                    "format_id": f"video-{height}",
                    "height": height,
                    "ext": "mp4",
                    "quality": label,
                    "label": tag + size_str,
                    "type": "video",
                }
            )
    video_options.sort(key=lambda x: x["height"], reverse=True)

    return {
        "id": info.get("id"),
        "title": info.get("title"),
        "uploader": info.get("uploader") or info.get("channel") or "Unknown Artist",
        "duration": info.get("duration") or 0,
        "view_count": info.get("view_count") or 0,
        "thumbnail": info.get("thumbnail"),
        "webpage_url": url,
        "stream_url": stream_url,
        "audio_options": audio_options,
        "video_options": video_options,
    }


@app.get("/api/search")
async def search_tracks(
    q: str = Query(..., min_length=1, max_length=MAX_SEARCH_LENGTH),
):
    query = q.strip()
    if not query or any(ord(char) < 32 or ord(char) == 127 for char in query):
        raise HTTPException(status_code=400, detail="A valid search query is required.")
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
        "cachedir": False,
        "socket_timeout": 15,
        "retries": 1,
        "noplaylist": True,
    }

    try:

        def search():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                return ydl.extract_info(f"ytsearch15:{query}", download=False)

        res = await run_media_task(search)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Media search failed (%s)", type(exc).__name__)
        raise HTTPException(
            status_code=502, detail="Search service is temporarily unavailable."
        ) from exc

    entries = res.get("entries", []) if res else []
    results = []
    for item in entries:
        if not item:
            continue
        vid_id = item.get("id")
        title = item.get("title")
        uploader = item.get("uploader") or item.get("channel") or ""
        duration = item.get("duration") or 0
        thumbnails = item.get("thumbnails") or []
        thumb_url = (
            thumbnails[-1].get("url")
            if thumbnails
            else (f"https://i.ytimg.com/vi/{vid_id}/hqdefault.jpg" if vid_id else "")
        )

        results.append(
            {
                "id": vid_id,
                "title": title,
                "uploader": uploader,
                "duration": duration,
                "thumbnail": thumb_url,
                "url": f"https://www.youtube.com/watch?v={vid_id}",
            }
        )

    return {"query": query, "results": results}


@app.get("/api/download")
async def download_file(
    background_tasks: BackgroundTasks,
    url: str = Query(..., max_length=MAX_URL_LENGTH),
    format_type: str = Query("mp3-320", max_length=32),
):
    url = validate_media_url(url)

    target_h = None
    if format_type.startswith("video-"):
        match = re.fullmatch(r"video-(\d{3,4})", format_type)
        if match:
            target_h = int(match.group(1))
        if target_h is None or not 360 <= target_h <= MAX_VIDEO_HEIGHT:
            raise HTTPException(status_code=400, detail="Unsupported video quality.")
    elif format_type not in {"mp3-320", "mp3-192", "m4a", "flac"}:
        raise HTTPException(status_code=400, detail="Unsupported download format.")

    temp_id = secrets.token_hex(16)
    out_template = str(DOWNLOAD_DIR / f"{temp_id}_%(title)s.%(ext)s")

    ydl_opts = {
        "outtmpl": out_template,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "cachedir": False,
        "socket_timeout": 15,
        "retries": 1,
        "fragment_retries": 1,
        "max_filesize": MAX_DOWNLOAD_BYTES,
        "progress_hooks": [enforce_download_size_limit],
    }

    if format_type.startswith("mp3"):
        bitrate = "320" if "320" in format_type else "192"
        ydl_opts.update(
            {
                "format": "bestaudio/best",
                "postprocessors": [
                    {
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3",
                        "preferredquality": bitrate,
                    }
                ],
            }
        )
    elif format_type == "m4a":
        ydl_opts.update(
            {
                "format": "bestaudio[ext=m4a]/bestaudio/best",
                "postprocessors": [
                    {
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "m4a",
                    }
                ],
            }
        )
    elif format_type == "flac":
        ydl_opts.update(
            {
                "format": "bestaudio/best",
                "postprocessors": [
                    {
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "flac",
                    }
                ],
            }
        )
    else:
        ydl_opts.update(
            {
                "format": f"bestvideo[height<={target_h}][ext=mp4]+bestaudio[ext=m4a]/best[height<={target_h}][ext=mp4]/best",
                "merge_output_format": "mp4",
            }
        )

    try:

        def run_dl():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                return ydl.extract_info(url, download=True)

        await run_media_task(run_dl)
    except asyncio.CancelledError:
        remove_download_group(temp_id)
        raise
    except HTTPException:
        raise
    except Exception as exc:
        remove_download_group(temp_id)
        logger.warning("Media download failed (%s)", type(exc).__name__)
        raise HTTPException(
            status_code=502, detail="Download or conversion failed."
        ) from exc

    matching_files = [
        path
        for path in DOWNLOAD_DIR.glob(f"{temp_id}_*")
        if path.is_file() and not path.name.endswith((".part", ".ytdl"))
    ]
    if not matching_files:
        remove_download_group(temp_id)
        raise HTTPException(
            status_code=500, detail="The converted file was not produced."
        )

    target_file = max(matching_files, key=lambda path: path.stat().st_mtime_ns)
    if target_file.stat().st_size > MAX_DOWNLOAD_BYTES:
        remove_download_group(temp_id)
        raise HTTPException(
            status_code=413,
            detail="The converted file exceeds the configured size limit.",
        )
    filename = target_file.name.removeprefix(f"{temp_id}_")
    filename = sanitize_filename(filename)

    background_tasks.add_task(remove_download_group, temp_id)

    media_type = {
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".flac": "audio/flac",
        ".mp4": "video/mp4",
    }.get(target_file.suffix.lower(), "application/octet-stream")
    return FileResponse(
        path=str(target_file),
        filename=filename,
        media_type=media_type,
    )
