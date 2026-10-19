#!/usr/bin/env python3
"""Assemble index.html from template.html + partials/*.html. Atomic write, safe to run concurrently."""
import os, re, sys, tempfile
ROOT = os.path.dirname(os.path.abspath(__file__))
tpl = open(os.path.join(ROOT, "template.html"), encoding="utf-8").read()
def sub(m):
    name = m.group(1)
    p = os.path.join(ROOT, "partials", name + ".html")
    if not os.path.exists(p):
        return f"<!-- partial '{name}' missing -->"
    return open(p, encoding="utf-8").read().rstrip() + "\n"
out = re.sub(r"<!-- @partial ([\w-]+) -->", sub, tpl)
# cache-bust stylesheets and scripts: append a short content hash so every deploy reaches browsers at once
import hashlib
def bust(m):
    path = m.group(2)
    fp = os.path.join(ROOT, path)
    if not os.path.exists(fp):
        return m.group(0)
    h = hashlib.sha1(open(fp, "rb").read()).hexdigest()[:8]
    return f'{m.group(1)}{path}?v={h}"'
out = re.sub(r'((?:href|src|poster|data-still)=")(static/(?:css|js|video|img)/[\w./-]+\.(?:css|js|mp4|jpg|jpeg|png|webp))"', bust, out)
fd, tmp = tempfile.mkstemp(dir=ROOT, suffix=".tmp")
with os.fdopen(fd, "w", encoding="utf-8") as f:
    f.write(out)
os.chmod(tmp, 0o644)  # mkstemp creates 0600; a web server running as another user must be able to read it
os.replace(tmp, os.path.join(ROOT, "index.html"))
missing = re.findall(r"<!-- partial '([\w-]+)' missing -->", out)
print("built index.html" + (f" (missing partials: {', '.join(missing)})" if missing else ""))
