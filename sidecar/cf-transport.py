#!/usr/bin/env python3
import base64
import json
import os
import sys
from urllib.parse import urljoin, urlsplit

try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    sys.stderr.write("cf-transport: curl_cffi not importable (try: uv run --with curl_cffi ...)\n")
    sys.exit(1)

PROXY = (os.environ.get("ALZA_PROXY_URL") or "").strip() or None
# A product page is well under a megabyte; anything far above that is not a page we can use and would only fill the pipe.
MAX_BODY = int(os.environ.get("SIDECAR_MAX_BODY_BYTES") or 8 * 1024 * 1024)
# The only hosts this process talks to, with their subdomains. Redirects are followed by hand so that a page which sends
# the browser elsewhere cannot make this process fetch an arbitrary address: a service on this machine, a metadata endpoint.
ALLOWED_HOSTS = tuple(
    h.strip().lower()
    for h in (os.environ.get("SIDECAR_ALLOWED_HOSTS") or "alza.cz,alza.sk,alza.hu,alza.de,alza.at").split(",")
    if h.strip()
)
MAX_REDIRECTS = 5
REDIRECT_STATUSES = (301, 302, 303, 307, 308)


def new_session():
    return cffi_requests.Session(impersonate="chrome", proxy=PROXY)


def close_quietly(session) -> None:
    try:
        session.close()
    except Exception:
        pass


def is_timeout(e: Exception) -> bool:
    return "timeout" in type(e).__name__.lower() or "timed out" in str(e).lower()


def allowed(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and bool(host) and any(host == a or host.endswith("." + a) for a in ALLOWED_HOSTS)


def fetch(session, method: str, url: str, headers: dict, timeout: float):
    for _ in range(MAX_REDIRECTS + 1):
        if not allowed(url):
            raise ValueError(f"refusing {urlsplit(url).hostname or url!r}: not an allowed host")
        r = session.request(method, url, headers=headers, timeout=timeout, allow_redirects=False)
        location = r.headers.get("location") if r.status_code in REDIRECT_STATUSES else None
        if not location:
            return r
        url = urljoin(url, location)
        if r.status_code == 303 or (r.status_code in (301, 302) and method != "GET"):
            method = "GET"
    raise ValueError("too many redirects")


def main() -> None:
    session = new_session()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        rotate = False
        try:
            req = json.loads(line)
            rid = req.get("id")
            r = fetch(
                session,
                (req.get("method") or "GET").upper(),
                req["url"],
                req.get("headers") or {},
                float(req.get("timeoutMs") or 20000) / 1000.0,
            )
            content = r.content or b""
            truncated = len(content) > MAX_BODY
            out = {
                "id": rid,
                "status": r.status_code,
                "headers": {k.lower(): v for k, v in r.headers.items()},
                "body": base64.b64encode(content[:MAX_BODY]).decode("ascii"),
                "error": None,
                "truncated": truncated,
            }
            # A 403 tends to stick to the session (its cookies and TLS session), so the next request starts a new one.
            rotate = r.status_code == 403
        except Exception as e:
            out = {"id": rid, "status": 0, "headers": {}, "body": "", "error": f"{type(e).__name__}: {e}"}
            # A broken connection pool would fail every following request too. A plain timeout keeps the warm connections.
            rotate = not is_timeout(e)
        if rotate:
            close_quietly(session)
            session = new_session()
        try:
            sys.stdout.write(json.dumps(out) + "\n")
            sys.stdout.flush()
        except (BrokenPipeError, OSError):
            # the server is gone, there is nobody to answer
            return


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
