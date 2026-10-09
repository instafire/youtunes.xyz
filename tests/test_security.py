from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import main


@pytest.fixture
def client():
    with TestClient(main.app) as test_client:
        yield test_client


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://youtube.com/watch?v=abc",
        "http://127.0.0.1/admin",
        "http://localhost:8080/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.1/",
        "http://[::1]/",
        "https://youtube.com.attacker.example/watch?v=abc",
        "https://example.com/video",
        "https://user:password@youtube.com/watch?v=abc",
        "https://youtube.com:8443/watch?v=abc",
        "https://youtube.com/\r\nHeader: injected",
    ],
)
def test_validate_media_url_rejects_unsafe_or_unsupported_urls(url):
    with pytest.raises(HTTPException) as exc:
        main.validate_media_url(url)
    assert exc.value.status_code == 400


@pytest.mark.parametrize(
    "url",
    [
        "https://youtube.com/watch?v=abc",
        "https://music.youtube.com/watch?v=abc",
        "https://youtu.be/abc",
        "https://on.soundcloud.com/abc",
        "https://artist.bandcamp.com/track/song",
        "https://vimeo.com/123456",
        "https://www.tiktok.com/@artist/video/123",
        "https://x.com/user/status/123",
        "https://twitter.com/user/status/123",
    ],
)
def test_validate_media_url_accepts_documented_providers(url):
    assert main.validate_media_url(url) == url


def test_validate_media_url_adds_https_to_bare_provider_url():
    assert (
        main.validate_media_url("www.youtube.com/watch?v=abc")
        == "https://www.youtube.com/watch?v=abc"
    )
    assert (
        main.validate_media_url("youtube.com:443/watch?v=abc")
        == "https://youtube.com:443/watch?v=abc"
    )


def test_info_rejects_local_file_before_yt_dlp_runs(client, monkeypatch):
    def unexpected_call(*args, **kwargs):
        pytest.fail("yt-dlp must not receive an unsafe URL")

    monkeypatch.setattr(main.yt_dlp, "YoutubeDL", unexpected_call)
    response = client.post("/api/info", json={"url": "file:///etc/passwd"})
    assert response.status_code == 400


def test_download_rejects_private_destination_and_unknown_format(client, monkeypatch):
    def unexpected_call(*args, **kwargs):
        pytest.fail("yt-dlp must not receive an unsafe URL or format")

    monkeypatch.setattr(main.yt_dlp, "YoutubeDL", unexpected_call)
    response = client.get(
        "/api/download", params={"url": "http://127.0.0.1/", "format_type": "mp3-320"}
    )
    assert response.status_code == 400

    response = client.get(
        "/api/download",
        params={
            "url": "https://youtube.com/watch?v=abc",
            "format_type": "mp3-320;--exec",
        },
    )
    assert response.status_code == 400

    response = client.get(
        "/api/download",
        params={"url": "https://youtube.com/watch?v=abc", "format_type": "video-4320"},
    )
    assert response.status_code == 400


def test_info_uses_validated_input_url_and_returns_metadata(client, monkeypatch):
    class FakeYoutubeDL:
        def __init__(self, options):
            self.options = options

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, url, download=False):
            assert url == "https://www.youtube.com/watch?v=abc"
            assert download is False
            assert self.options["socket_timeout"] == 15
            return {
                "id": "abc",
                "title": "<img src=x onerror=alert(1)>",
                "uploader": "Artist",
                "duration": 60,
                "view_count": 100,
                "thumbnail": "https://i.ytimg.com/vi/abc/default.jpg",
                "webpage_url": "https://attacker.example/redirect",
                "formats": [
                    {
                        "vcodec": "none",
                        "acodec": "mp4a.40.2",
                        "abr": 128,
                        "url": "https://cdn.example/audio",
                    },
                    {"height": 2160, "vcodec": "avc1", "acodec": "none"},
                    {"height": 4320, "vcodec": "avc1", "acodec": "none"},
                    {"height": 240, "vcodec": "avc1", "acodec": "none"},
                ],
            }

    monkeypatch.setattr(main.yt_dlp, "YoutubeDL", FakeYoutubeDL)
    response = client.post(
        "/api/info", json={"url": "https://www.youtube.com/watch?v=abc"}
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["title"] == "<img src=x onerror=alert(1)>"
    assert payload["webpage_url"] == "https://www.youtube.com/watch?v=abc"
    assert payload["stream_url"] == "https://cdn.example/audio"
    assert [option["height"] for option in payload["video_options"]] == [2160]


def test_info_error_does_not_disclose_extractor_exception(client, monkeypatch):
    class BrokenYoutubeDL:
        def __init__(self, options):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, url, download=False):
            raise RuntimeError("/srv/private/config-with-secret.txt")

    monkeypatch.setattr(main.yt_dlp, "YoutubeDL", BrokenYoutubeDL)
    response = client.post("/api/info", json={"url": "https://youtube.com/watch?v=abc"})

    assert response.status_code == 502
    assert "/srv/private" not in response.text
    assert "secret" not in response.text


def test_download_uses_safe_filename_mime_and_cleans_temp_files(
    client, monkeypatch, tmp_path
):
    monkeypatch.setattr(main, "DOWNLOAD_DIR", tmp_path)
    captured_options = {}

    class FakeYoutubeDL:
        def __init__(self, options):
            self.options = options
            captured_options.update(options)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, url, download=False):
            assert download is True
            output = Path(
                self.options["outtmpl"]
                .replace("%(title)s", "Song\r\nName")
                .replace("%(ext)s", "m4a")
            )
            output.write_bytes(b"fake audio")
            return {"id": "abc"}

    monkeypatch.setattr(main.yt_dlp, "YoutubeDL", FakeYoutubeDL)
    response = client.get(
        "/api/download",
        params={"url": "https://youtube.com/watch?v=abc", "format_type": "m4a"},
    )

    assert response.status_code == 200
    assert response.content == b"fake audio"
    assert response.headers["content-type"] == "audio/mp4"
    assert "SongName.m4a" in response.headers["content-disposition"]
    assert "\r" not in response.headers["content-disposition"]
    assert "\n" not in response.headers["content-disposition"]
    assert captured_options["max_filesize"] == main.MAX_DOWNLOAD_BYTES
    assert list(tmp_path.iterdir()) == []


def test_download_rejects_and_removes_oversized_completed_file(
    client, monkeypatch, tmp_path
):
    monkeypatch.setattr(main, "DOWNLOAD_DIR", tmp_path)
    monkeypatch.setattr(main, "MAX_DOWNLOAD_BYTES", 4)

    class FakeYoutubeDL:
        def __init__(self, options):
            self.options = options

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, url, download=False):
            output = Path(
                self.options["outtmpl"]
                .replace("%(title)s", "Oversized")
                .replace("%(ext)s", "mp3")
            )
            output.write_bytes(b"too large")
            return {"id": "abc"}

    monkeypatch.setattr(main.yt_dlp, "YoutubeDL", FakeYoutubeDL)
    response = client.get(
        "/api/download",
        params={"url": "https://youtube.com/watch?v=abc", "format_type": "mp3-320"},
    )

    assert response.status_code == 413
    assert list(tmp_path.iterdir()) == []


def test_sanitize_filename_removes_controls_and_header_metacharacters():
    assert main.sanitize_filename('bad\r\n"<>:/\\name.m4a') == "badname.m4a"


def test_cors_is_not_open_to_arbitrary_origins(client):
    response = client.get("/api/health", headers={"Origin": "https://attacker.example"})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert (
        response.headers["permissions-policy"]
        == "camera=(), microphone=(), geolocation=()"
    )


def test_search_rejects_blank_or_oversized_queries_before_yt_dlp(client, monkeypatch):
    def unexpected_call(*args, **kwargs):
        pytest.fail("yt-dlp must not run for invalid search queries")

    monkeypatch.setattr(main.yt_dlp, "YoutubeDL", unexpected_call)
    assert client.get("/api/search", params={"q": "   "}).status_code == 400
    assert client.get("/api/search", params={"q": "x" * 201}).status_code == 422


@pytest.mark.parametrize(
    "url", ["https://8.8.8.8/video", "https://[2001:4860:4860::8888]/video"]
)
def test_direct_ip_urls_are_not_supported(url):
    with pytest.raises(HTTPException):
        main.validate_media_url(url)
