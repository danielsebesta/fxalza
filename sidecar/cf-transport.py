#!/usr/bin/env python3
import base64
import json
import os
import sys

try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    sys.stderr.write("cf-transport: curl_cffi not importable (try: uv run --with curl_cffi ...)\n")
    sys.exit(1)

PROXY = (os.environ.get("ALZA_PROXY_URL") or "").strip() or None


def main() -> None:
    session = cffi_requests.Session(impersonate="chrome", proxy=PROXY)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            r = session.request(
                (req.get("method") or "GET").upper(),
                req["url"],
                headers=req.get("headers") or {},
                timeout=float(req.get("timeoutMs") or 20000) / 1000.0,
                allow_redirects=True,
            )
            out = {
                "id": rid,
                "status": r.status_code,
                "headers": {k.lower(): v for k, v in r.headers.items()},
                "body": base64.b64encode(r.content or b"").decode("ascii"),
                "error": None,
            }
        except Exception as e:
            out = {"id": rid, "status": 0, "headers": {}, "body": "", "error": f"{type(e).__name__}: {e}"}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
