#!/usr/bin/env python3
"""Fetch + crop the card-body art for patent cards (thrusters first).

Reads every scripts/card-art/<deck>.json source manifest, downloads each
source image (NASA Image and Video Library, or Wikimedia Commons), crops it to
the card body's shape, and writes:

  assets/cards/<deck>/<cardId>-<front|back>.webp   the art itself
  assets/cards/CREDITS.md                          per-image source + licence
  data/card-art.js                                 runtime manifest (generated)

Run:  python3 scripts/fetch-card-art.py            (re-crops from the cache)
      python3 scripts/fetch-card-art.py --refresh  (re-downloads every source)

Needs ImageMagick (`convert`) with WebP support. Downloads are cached in
$CARD_ART_CACHE (default /tmp/hf-card-art-cache) so re-cropping is offline.
See docs/card-art-guide.md for the art recipe and the approval gate.
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, 'scripts', 'card-art')
OUT_DIR = os.path.join(ROOT, 'assets', 'cards')
MANIFEST_JS = os.path.join(ROOT, 'data', 'card-art.js')
CREDITS_MD = os.path.join(OUT_DIR, 'CREDITS.md')
CACHE = os.environ.get('CARD_ART_CACHE', '/tmp/hf-card-art-cache')

# The card body is ~218x209 css px; render at 2x for sharp hi-dpi output.
OUT_W, OUT_H = 436, 418
QUALITY = '80'
UA = {'User-Agent': 'HF4FanGameCardArt/1.0 (non-commercial fan project)'}


def _get(url, timeout):
    # Wikimedia rate-limits shared IPs (HTTP 429); back off and retry.
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 4:
                raise
            time.sleep(10 * (attempt + 1))


def fetch_json(url):
    return json.loads(_get(url, 60))


def download(url, dest):
    data = _get(url, 120)
    with open(dest, 'wb') as f:
        f.write(data)


def source_url(src):
    """Resolve a manifest source to (download url, credit line, licence)."""
    if src['kind'] == 'nasa':
        nid = src['id']
        files = fetch_json(f'https://images-assets.nasa.gov/image/{urllib.parse.quote(nid)}/collection.json')
        imgs = [u for u in files if u.lower().endswith(('.jpg', '.jpeg', '.png'))]
        for pref in ('~large', '~orig', '~medium'):
            hit = [u for u in imgs if pref in u]
            if hit:
                url = hit[0].replace('http://', 'https://').replace(' ', '%20')
                return url, f'NASA, image {nid} (images.nasa.gov)', 'Public domain (NASA)'
        raise RuntimeError(f'no usable rendition for NASA {nid}')
    if src['kind'] == 'commons':
        title = 'File:' + src['file']
        q = urllib.parse.urlencode({
            'action': 'query', 'titles': title, 'prop': 'imageinfo',
            'iiprop': 'url', 'iiurlwidth': '1280', 'format': 'json'})
        data = fetch_json('https://commons.wikimedia.org/w/api.php?' + q)
        page = next(iter(data['query']['pages'].values()))
        info = page['imageinfo'][0]
        url = info.get('thumburl') or info['url']
        return url, f"{src.get('author', 'unknown')}, Wikimedia Commons {title}", src['license']
    raise ValueError('unknown source kind ' + src['kind'])


def cache_path(src):
    key = src.get('id') or src.get('file')
    safe = ''.join(c if c.isalnum() or c in '-_.' else '_' for c in key)
    return os.path.join(CACHE, src['kind'] + '_' + safe)


def crop(raw, out, entry):
    args = ['convert', raw + '[0]', '-auto-orient']
    c = entry.get('crop')
    if c:
        # Fractional pre-crop, resolution independent.
        w, h = map(int, subprocess.check_output(
            ['identify', '-format', '%w %h', raw + '[0]']).split())
        args += ['-crop', f"{int(c['w'] * w)}x{int(c['h'] * h)}+{int(c['x'] * w)}+{int(c['y'] * h)}", '+repage']
    args += ['-resize', f'{OUT_W}x{OUT_H}^', '-gravity', entry.get('gravity', 'center'),
             '-extent', f'{OUT_W}x{OUT_H}', '-strip', '-quality', QUALITY, out]
    subprocess.check_call(args)


def main():
    refresh = '--refresh' in sys.argv
    os.makedirs(CACHE, exist_ok=True)
    manifest = {}
    credits = []
    for fname in sorted(os.listdir(SRC_DIR)):
        if not fname.endswith('.json'):
            continue
        spec = json.load(open(os.path.join(SRC_DIR, fname)))
        deck = spec['deck']
        os.makedirs(os.path.join(OUT_DIR, deck), exist_ok=True)
        for e in spec['entries']:
            src = e['source']
            raw = cache_path(src)
            meta = raw + '.meta.json'
            if refresh or not os.path.exists(raw) or not os.path.exists(meta):
                url, credit, lic = source_url(src)
                download(url, raw)
                json.dump({'url': url, 'credit': credit, 'license': lic}, open(meta, 'w'))
            m = json.load(open(meta))
            side = 'front' if e['face'] == 'primary' else 'back'
            rel = f'assets/cards/{deck}/{e["card"]}-{side}.webp'
            crop(raw, os.path.join(ROOT, rel), e)
            manifest.setdefault(e['card'], {})[e['face']] = {
                'src': rel, 'approved': bool(e.get('approved'))}
            credits.append((rel, e.get('subject', ''), m['credit'], m['license'], m['url']))
            print(('OK   ' if e.get('approved') else 'PEND ') + rel)

    lines = [
        '// AUTO-GENERATED by scripts/fetch-card-art.py - do not edit by hand.',
        '// Card-body art for patent cards, keyed by card id then face',
        '// (primary = white front, secondary = black back). Only entries with',
        "// approved: true render in the game; the rest await the user's sign-off",
        '// (set "approved": true in scripts/card-art/<deck>.json and re-run).',
        '// Consumed by js/game/card-ui.js. Sources + licences: assets/cards/CREDITS.md.',
        'export const CARD_ART = ' + json.dumps(manifest, indent=2) + ';',
        '',
    ]
    open(MANIFEST_JS, 'w').write('\n'.join(lines))

    md = ['# Card art credits', '',
          'Generated by `scripts/fetch-card-art.py` from `scripts/card-art/*.json`.',
          'NASA imagery is not subject to copyright in the United States; use here',
          'does not imply NASA endorsement. Other sources carry the licence listed.', '',
          '| File | Subject | Credit | Licence |', '|---|---|---|---|']
    for rel, subj, credit, lic, url in credits:
        md.append(f'| `{rel}` | {subj} | [{credit}]({url}) | {lic} |')
    open(CREDITS_MD, 'w').write('\n'.join(md) + '\n')


if __name__ == '__main__':
    main()
