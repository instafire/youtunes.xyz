import os
import re
import tempfile
import asyncio
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks, Request
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yt_dlp

app = FastAPI(title="YouTunes Studio", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

DOWNLOAD_DIR = Path(tempfile.gettempdir()) / "youtunes_downloads"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)


def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r'[\\/*?:"<>|]', "", name).strip()
    return cleaned if cleaned else "youtunes_track"


def remove_file_safely(path: Path):
    try:
        if path.exists():
            path.unlink()
    except Exception:
        pass


class InfoRequest(BaseModel):
    url: str


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
        "version": "2.0.0"
    }


@app.api_route("/api/trending", methods=["GET", "HEAD"])
async def trending():
    return {"trending": []}


@app.post("/api/info")
async def get_info(req: InfoRequest):
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        "skip_download": True,
        "noplaylist": True,
    }

    loop = asyncio.get_event_loop()
    try:
        def extract():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                return ydl.extract_info(url, download=False)
        info = await loop.run_in_executor(None, extract)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to analyze track: {str(e)}")

    if not info:
        raise HTTPException(status_code=404, detail="Track not found")

    formats = info.get("formats", [])
    
    # Direct audio stream URL for preview playback
    stream_url = None
    audio_formats = [f for f in formats if f.get("vcodec") == "none" and f.get("acodec") != "none"]
    if audio_formats:
        audio_formats.sort(key=lambda x: x.get("abr") or 0, reverse=True)
        stream_url = audio_formats[0].get("url")
    elif formats:
        with_audio = [f for f in formats if f.get("acodec") != "none"]
        if with_audio:
            stream_url = with_audio[0].get("url")

    # Audio format specs
    audio_options = [
        {"format_id": "mp3-320", "ext": "mp3", "quality": "320 kbps", "label": "Ultra Hi-Fi", "type": "audio", "sample_rate": "48 kHz · CBR"},
        {"format_id": "mp3-192", "ext": "mp3", "quality": "192 kbps", "label": "Standard HQ", "type": "audio", "sample_rate": "44.1 kHz · VBR"},
        {"format_id": "m4a", "ext": "m4a", "quality": "Original AAC", "label": "Direct Demux", "type": "audio", "sample_rate": "Untouched Stream"},
        {"format_id": "flac", "ext": "flac", "quality": "Lossless FLAC", "label": "Master Quality", "type": "audio", "sample_rate": "24-bit · Lossless"},
    ]

    # Video format specs
    video_options = []
    seen_heights = set()
    for f in formats:
        height = f.get("height")
        if height and height not in seen_heights and height >= 360:
            seen_heights.add(height)
            filesize = f.get("filesize") or f.get("filesize_approx")
            size_str = f" (~{round(filesize / (1024*1024), 1)} MB)" if filesize else ""
            
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

            video_options.append({
                "format_id": f"video-{height}",
                "height": height,
                "ext": "mp4",
                "quality": label,
                "label": tag + size_str,
                "type": "video"
            })
    video_options.sort(key=lambda x: x["height"], reverse=True)

    return {
        "id": info.get("id"),
        "title": info.get("title"),
        "uploader": info.get("uploader") or info.get("channel") or "Unknown Artist",
        "duration": info.get("duration") or 0,
        "view_count": info.get("view_count") or 0,
        "thumbnail": info.get("thumbnail"),
        "webpage_url": info.get("webpage_url") or url,
        "stream_url": stream_url,
        "audio_options": audio_options,
        "video_options": video_options,
    }


@app.get("/api/search")
async def search_tracks(q: str = Query(..., min_length=1)):
    query = q.strip()
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
    }

    loop = asyncio.get_event_loop()
    try:
        def search():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                return ydl.extract_info(f"ytsearch15:{query}", download=False)
        res = await loop.run_in_executor(None, search)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")

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
        thumb_url = thumbnails[-1].get("url") if thumbnails else f"https://i.ytimg.com/vi/{vid_id}/hqdefault.jpg"

        results.append({
            "id": vid_id,
            "title": title,
            "uploader": uploader,
            "duration": duration,
            "thumbnail": thumb_url,
            "url": f"https://www.youtube.com/watch?v={vid_id}"
        })

    return {"query": query, "results": results}


@app.get("/api/download")
async def download_file(
    url: str = Query(...),
    format_type: str = Query("mp3-320"),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    url = url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    temp_id = next(tempfile._get_candidate_names())
    out_template = str(DOWNLOAD_DIR / f"{temp_id}_%(title)s.%(ext)s")

    ydl_opts = {
        "outtmpl": out_template,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }

    if format_type.startswith("mp3"):
        bitrate = "320" if "320" in format_type else "192"
        ydl_opts.update({
            "format": "bestaudio/best",
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": bitrate,
            }]
        })
    elif format_type == "m4a":
        ydl_opts.update({
            "format": "bestaudio[ext=m4a]/bestaudio/best",
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "m4a",
            }]
        })
    elif format_type == "flac":
        ydl_opts.update({
            "format": "bestaudio/best",
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "flac",
            }]
        })
    elif format_type.startswith("video-"):
        try:
            target_h = int(format_type.split("-")[1])
            ydl_opts.update({
                "format": f"bestvideo[height<={target_h}][ext=mp4]+bestaudio[ext=m4a]/best[height<={target_h}][ext=mp4]/best",
                "merge_output_format": "mp4",
            })
        except Exception:
            ydl_opts.update({"format": "bestvideo+bestaudio/best", "merge_output_format": "mp4"})
    else:
        ydl_opts.update({"format": "bestaudio/best"})

    loop = asyncio.get_event_loop()
    try:
        def run_dl():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                return ydl.extract_info(url, download=True)
        info = await loop.run_in_executor(None, run_dl)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download conversion failed: {str(e)}")

    matching_files = list(DOWNLOAD_DIR.glob(f"{temp_id}_*"))
    if not matching_files:
        raise HTTPException(status_code=500, detail="Output file was not produced")

    target_file = matching_files[0]
    filename = target_file.name.replace(f"{temp_id}_", "")
    filename = sanitize_filename(filename)

    background_tasks.add_task(remove_file_safely, target_file)

    media_type = "audio/mpeg" if target_file.suffix == ".mp3" else "video/mp4"
    return FileResponse(
        path=str(target_file),
        filename=filename,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
