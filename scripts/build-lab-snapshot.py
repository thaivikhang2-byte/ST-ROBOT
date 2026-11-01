#!/usr/bin/env python3
"""Keep the small lab registry in the same HTML response as its renderer.

This prevents older browser/CDN copies of lab-platforms.js from hiding the
restored platforms. The JS file remains the editable source of truth.
"""
import argparse
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
source = (ROOT / 'frontend/src/data/lab-platforms.js').read_text()
if '</script' in source.lower():
    raise ValueError('Lab registry must not contain a closing script tag')
version = hashlib.sha256(source.encode()).hexdigest()[:12]
block = f'<script id="lab-platform-data" data-lab-version="{version}">\n{source.rstrip()}\n</script>'
page = ROOT / 'frontend/public/course.learning.html'
html = page.read_text()
external = '<script src="../src/data/lab-platforms.js"></script>'
if external in html:
    expected = html.replace(external, block, 1)
else:
    expected, count = re.subn(r'<script id="lab-platform-data"[^>]*>.*?</script>', lambda _: block, html, count=1, flags=re.S)
    if count != 1:
        raise ValueError('Learning page is missing its lab registry snapshot')
if args.check:
    if expected != html:
        raise SystemExit('Lab snapshot is stale; run python3 scripts/build-lab-snapshot.py')
    print(f'Lab snapshot matches registry: {version}')
else:
    page.write_text(expected)
    print(f'Updated lab snapshot: {version}')
