#!/usr/bin/env python3
"""nice-deck hero-image helper.

Generate a slide-resolution hero image via an Azure OpenAI image deployment
(e.g. gpt-image-2) using an Entra ID (AAD) token from the Azure CLI. No API
keys required. Saves the raw PNG returned by the model.

Config comes from the environment (see .env.example). Nothing internal is
baked in.

  AZURE_OPENAI_ENDPOINT      (required)  e.g. https://your-res.openai.azure.com
  AZURE_OPENAI_DEPLOYMENT    (default: gpt-image-2)
  AZURE_OPENAI_API_VERSION   (optional; else a sensible list is tried)
  AZURE_SUBSCRIPTION_ID      (optional; passed to `az account get-access-token`)

Usage:
  python hero.py --prompt-file p.txt --out heroes/01.png
  python hero.py --prompt "..." --out heroes/01.png --size 1536x1024 --quality high
"""
import argparse, base64, json, os, subprocess, sys, time, urllib.request, urllib.error

DEFAULT_API_VERSIONS = ["2025-04-01-preview", "2025-12-01-preview",
                        "2026-04-01-preview", "2026-01-01-preview",
                        "2025-03-01-preview"]


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


def token():
    cmd = ["az", "account", "get-access-token", "--resource",
           "https://cognitiveservices.azure.com", "--query", "accessToken",
           "-o", "tsv"]
    sub = os.environ.get("AZURE_SUBSCRIPTION_ID")
    if sub:
        cmd += ["--subscription", sub]
    out = subprocess.run(cmd, capture_output=True, text=True, shell=True)
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
    load_dotenv()
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt")
    ap.add_argument("--prompt-file")
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", default="1536x1024")
    ap.add_argument("--quality", default="high")
    a = ap.parse_args()

    endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT", "").rstrip("/")
    if not endpoint:
        sys.exit("set AZURE_OPENAI_ENDPOINT (see .env.example)")
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
