#!/usr/bin/env python3
"""Generate original raster graphics for nice-deck prototypes.

Generate a draft or final deck graphic via an Azure OpenAI image deployment
(for example gpt-image-2) using an Entra ID token from the Azure CLI. No API
keys required. The prompt owns the medium and composition; this script only
handles authenticated generation and saves the returned PNG.

Config comes from the environment (see .env.example). Nothing internal is
baked in.

  AZURE_OPENAI_ENDPOINT      (required)  e.g. https://your-res.openai.azure.com
  AZURE_OPENAI_DEPLOYMENT    (default: gpt-image-2)
  AZURE_OPENAI_API_VERSION   (optional; else a sensible list is tried)
  AZURE_SUBSCRIPTION_ID      (optional; passed to `az account get-access-token`)

Usage:
  python image.py --prompt-file direction.txt --out assets/direction.png --quality medium
  python image.py --prompt "..." --out assets/final.png --size 1536x1024 --quality high
"""
import argparse, base64, json, os, shutil, subprocess, sys, time, urllib.request, urllib.error, urllib.parse
from pathlib import Path

DEFAULT_API_VERSIONS = ["2025-04-01-preview", "2025-12-01-preview",
                        "2026-04-01-preview", "2026-01-01-preview",
                        "2025-03-01-preview"]
AZURE_OPENAI_HOST_SUFFIXES = (".openai.azure.com",
                              ".services.ai.azure.com",
                              ".cognitiveservices.azure.com")


def load_dotenv(path=".env"):
    """Minimal .env loader (KEY=VALUE lines). No dependency on python-dotenv."""
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


def validate_endpoint(endpoint):
    parsed = urllib.parse.urlparse(endpoint)
    try:
        port = parsed.port
    except ValueError:
        port = None
    host = (parsed.hostname or "").lower()
    if (parsed.scheme != "https" or parsed.username or parsed.password
            or port not in (None, 443) or parsed.path not in ("", "/")
            or parsed.query or parsed.fragment
            or not any(host.endswith(suffix)
                       for suffix in AZURE_OPENAI_HOST_SUFFIXES)):
        sys.exit("AZURE_OPENAI_ENDPOINT must be an HTTPS Azure OpenAI endpoint")
    return endpoint.rstrip("/")


def token():
    az = shutil.which("az")
    if not az:
        sys.exit("az token fail: Azure CLI is not installed or not on PATH")
    cmd = [az, "account", "get-access-token", "--resource",
           "https://cognitiveservices.azure.com", "--query", "accessToken",
           "-o", "tsv"]
    sub = os.environ.get("AZURE_SUBSCRIPTION_ID")
    if sub:
        cmd += ["--subscription", sub]
    out = subprocess.run(cmd, capture_output=True, text=True, shell=False)
    t = out.stdout.strip()
    if not t or len(t) < 100:
        sys.exit(f"az token fail (is the Azure CLI logged in?): {out.stderr}")
    return t


def gen(prompt, size, quality, endpoint, deployment, versions, tok):
    body = json.dumps({"prompt": prompt, "size": size, "n": 1,
                       "quality": quality}).encode()
    last = None
    for ver in versions:
        url = (f"{endpoint}/openai/deployments/{deployment}"
               f"/images/generations?api-version={ver}")
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
        req.add_header("Authorization", f"Bearer {tok}")
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                print(f"  OK api-version={ver}", file=sys.stderr)
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            last = f"{e.code} {ver}: {e.read().decode()[:300]}"
            print(f"  x {last}", file=sys.stderr)
            if e.code in (401, 403, 429):  # auth/quota — retrying won't help
                break
        except Exception as e:
            last = f"{ver}: {e}"
            print(f"  x {last}", file=sys.stderr)
    sys.exit(f"all api-versions failed. last: {last}")


def main():
    # Load only the trusted repo-root config, never a deck workspace's .env.
    load_dotenv(Path(__file__).resolve().parents[3] / ".env")
    ap = argparse.ArgumentParser()
    prompt_group = ap.add_mutually_exclusive_group(required=True)
    prompt_group.add_argument("--prompt")
    prompt_group.add_argument("--prompt-file")
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", default="1536x1024")
    ap.add_argument("--quality", default="high")
    a = ap.parse_args()

    endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT", "")
    if not endpoint:
        sys.exit("set AZURE_OPENAI_ENDPOINT (see .env.example)")
    endpoint = validate_endpoint(endpoint)
    deployment = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-image-2")
    pinned = os.environ.get("AZURE_OPENAI_API_VERSION")
    versions = [pinned] if pinned else DEFAULT_API_VERSIONS

    prompt = a.prompt or open(a.prompt_file, encoding="utf-8").read()
    t0 = time.time()
    resp = gen(prompt, a.size, a.quality, endpoint, deployment, versions, token())
    b64 = resp["data"][0].get("b64_json")
    if not b64:
        sys.exit(f"no b64 in response: {json.dumps(resp)[:300]}")
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    open(a.out, "wb").write(base64.b64decode(b64))
    print(f"saved {a.out} ({len(b64) * 3 // 4 // 1024} KB) in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
