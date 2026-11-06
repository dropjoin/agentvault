#!/usr/bin/env python3
"""Deploy the AgentVault live demo dashboard to Cloudflare.
Uploads worker 'agentvault' (redesigned dashboard/index.html), enables the
workers.dev subdomain, then attaches the worker custom domain
agentvault.apeagent.online on the existing apeagent.online zone.
Does not touch any other script, route, or domain."""
import json, os, sys, urllib.error
import importlib.util
spec = importlib.util.spec_from_file_location("cf", "/home/hatch/workspace/custom-connectors/custom.cloudflare/bin/cf.py")
cf = importlib.util.module_from_spec(spec); spec.loader.exec_module(cf)

ACCOUNT = cf.ACCOUNT
ZONE_ID = "0c338246d2ef5db64b59593428a87539"  # apeagent.online
SCRIPT = "agentvault"
HOSTNAME = "agentvault.apeagent.online"
BASE = os.path.dirname(os.path.abspath(__file__))

def call(path, method="GET", data=None, headers=None, timeout=300):
    req = cf.make_request(path, method=method, data=data, headers=headers)
    try:
        with cf.open_req(req, timeout=timeout) as resp:
            raw = resp.read()
            try: return resp.status, json.loads(raw)
            except Exception: return resp.status, {"raw": raw[:300]}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, {"raw": raw[:300]}

def upload_worker():
    html_bytes = open(os.path.join(BASE, "index.html"), "rb").read()
    worker_bytes = open(os.path.join(BASE, "worker.js"), "rb").read()
    metadata = {"main_module": "worker.js", "compatibility_date": "2026-11-01",
                "rules": [{"type": "Text", "globs": ["**/*.html"], "fallthrough": True}]}
    boundary = "----museCfBoundary7MA4YWxkTrZu0gW"
    parts = []
    def part(name, filename, ctype, data):
        head = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\nContent-Type: {ctype}\r\n\r\n").encode()
        parts.append(head + data + b"\r\n")
    part("metadata", "metadata.json", "application/json", json.dumps(metadata).encode())
    part("worker.js", "worker.js", "application/javascript+module", worker_bytes)
    part("index.html", "index.html", "text/plain", html_bytes)
    body = b"".join(parts) + f"--{boundary}--\r\n".encode()
    print("total upload bytes:", len(body))
    st, resp = call(f"/accounts/{ACCOUNT}/workers/scripts/{SCRIPT}", method="PUT", data=body,
                    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    print("worker upload:", st, "success=", resp.get("success"), resp.get("errors") or "")
    if not resp.get("success"):
        print(json.dumps(resp)[:1000]); sys.exit(1)
    st2, resp2 = call(f"/accounts/{ACCOUNT}/workers/scripts/{SCRIPT}/subdomain", method="POST",
                      data=json.dumps({"enabled": True}).encode(),
                      headers={"Content-Type": "application/json"})
    print("subdomain enable:", st2, "success=", resp2.get("success"), resp2.get("errors") or "")

def attach_domain():
    st, resp = call(f"/zones/{ZONE_ID}/workers/domains", method="PUT",
                    data=json.dumps({"hostname": HOSTNAME, "service": SCRIPT,
                                     "environment": "production"}).encode(),
                    headers={"Content-Type": "application/json"})
    print("domain attach:", st, "success=", resp.get("success"), resp.get("errors") or "")
    print("domain result:", json.dumps(resp.get("result"))[:500])
    if not resp.get("success"):
        sys.exit(1)

def verify_domain():
    st, resp = call(f"/zones/{ZONE_ID}/workers/domains?per_page=100")
    for d in resp.get("result") or []:
        if d.get("hostname") == HOSTNAME:
            print("attached domain:", d.get("hostname"), "->", d.get("service"), d.get("environment"), "id:", d.get("id"))

if __name__ == "__main__":
    upload_worker()
    attach_domain()
    verify_domain()
    print("OK agentvault worker deployed:", "https://" + HOSTNAME)
