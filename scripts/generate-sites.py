#!/usr/bin/env python3
"""Regenerate the static block of data/sites.js from the canonical
HF4 site manifest spreadsheet.

Reads reference/HF4-site-list.xlsx, derives each site's:
  - id          slugified site name
  - name        display label
  - body        parent group (Group column, or first word of name)
  - type        planet | moon | asteroid | dwarf | tno | comet | lagrange | orbit | surface
  - class       prospect difficulty derived from Size + spectral type
  - hydration   0..4, straight from spreadsheet
  - vps         derived from Size + hydration (heuristic, not from sheet)
  - dvFromLEO   integer burns from the spreadsheet
  - sol_clock   sol-clock hour (0..12)
  - solar_zone  Mercury | Venus | Earth | Mars | Ceres | Jupiter | Saturn | Uranus | Neptune
  - x, y        polar layout: sol-clock angle, burns radius

Layout convention: the Sun sits at the SVG centre, sol-clock 0 (noon)
points up, and the radial distance is a non-linear function of burns
from LEO so that the inner planets don't collapse into the centre.

Run from the repo root:

    python3 scripts/generate-sites.py > /tmp/sites-block.js

Then paste the SITES array into data/sites.js, keeping the EDGES list
hand-edited (it's derived from the locator map PDF, not the spreadsheet).
"""

import math
import os
import re
import sys

try:
    import openpyxl
except ImportError:
    sys.stderr.write("openpyxl is required. Install with: pip install openpyxl\n")
    sys.exit(1)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX_PATH = os.path.join(REPO_ROOT, 'reference', 'HF4-site-list.xlsx')

# Centre of the SVG viewBox (1400 x 900). Render.js uses the same numbers.
CX, CY = 700, 460


def slug(name):
    s = name.lower()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s


def burns_to_radius(burns):
    """Map an integer burn-cost from LEO to a radial pixel offset.
    Inner system (2-6 burns) gets ~250-450 px; outer system (8-22 burns)
    gets compressed onto 500-750 px so Pluto stays on-map.
    """
    if burns is None or burns <= 0:
        return 80
    # Stretch the inner system, compress the outer.
    return int(80 + 40 * math.sqrt(burns) * (1 + min(burns, 8) / 8))


def clock_to_radians(t):
    """Sol Clock Position is a datetime.time. Noon (12:00) = up = -pi/2.
    Returns a radian angle suitable for cos/sin.
    """
    if t is None:
        return 0
    hour = (t.hour % 12) + t.minute / 60.0 + t.second / 3600.0
    # 12 o'clock = top; clockwise rotation matches a real clock face
    return (hour / 12.0) * 2 * math.pi - math.pi / 2


def classify(size, spectral, hydration):
    """Map size + spectral type to a coarse prospect difficulty class.
    The mapping below is our own heuristic (not from the spreadsheet)
    so the in-game prospect die roll has reasonable variance.
    """
    if size is None: size = 0
    if isinstance(size, str):  # 'Atmospheric' etc
        return 'D'
    if size >= 11:
        return 'D'
    if size >= 9:
        return 'C'
    if size >= 6:
        return 'B'
    return 'A'


def site_type(group, name, atmospheric, submarine, centaur):
    n = (name or '').lower()
    g = (group or '').lower()
    if 'comet' in n or 'comet' in g: return 'comet'
    if centaur: return 'tno'
    if atmospheric: return 'planet'
    if submarine: return 'moon'
    if 'lagrange' in n or ' l' in n.lower() and re.search(r' l[1-5]\b', n.lower()):
        return 'lagrange'
    if g in ('mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'):
        return 'planet' if name == g.capitalize() else 'moon'
    return 'asteroid'


def main():
    wb = openpyxl.load_workbook(XLSX_PATH, data_only=True)
    ws = wb['Sites']
    headers = [(ws.cell(2, c).value or '').replace('\n', ' ').strip() for c in range(1, ws.max_column + 1)]

    def col(row, key):
        try:
            return row[headers.index(key)]
        except ValueError:
            return None

    sites = []
    seen_ids = set()
    for r in range(3, ws.max_row + 1):
        row = [ws.cell(r, c).value for c in range(1, ws.max_column + 1)]
        name = col(row, 'Site Name')
        if not name:
            continue
        id_ = slug(name)
        if id_ in seen_ids:
            # Disambiguate duplicates by appending a counter.
            id_ = f"{id_}_2"
        seen_ids.add(id_)
        burns = col(row, 'Burns')
        clock = col(row, 'Sol Clock Position')
        ang = clock_to_radians(clock)
        rad = burns_to_radius(burns)
        x = CX + rad * math.cos(ang)
        y = CY + rad * math.sin(ang)

        sites.append({
            'id': id_,
            'name': name,
            'body': col(row, 'Group') or name.split()[0],
            'type': site_type(col(row, 'Group'), name,
                              col(row, 'Atmospheric'),
                              col(row, 'Submarine'),
                              col(row, 'Centaur')),
            'class': classify(col(row, 'Size'), col(row, 'Spectral Type'), col(row, 'Hydration')),
            'hydration': int(col(row, 'Hydration') or 0),
            'vps': max(1, int(col(row, 'Hydration') or 0) // 2 + 1),
            'dv_leo': float(burns or 0),
            'solar_zone': col(row, 'Solar Zone'),
            'x': round(x, 1),
            'y': round(y, 1),
        })

    print(f"// AUTO-GENERATED by scripts/generate-sites.py")
    print(f"// Source: reference/HF4-site-list.xlsx ({len(sites)} sites)")
    print(f"// Hand-edit at your own risk; re-run the script to refresh.")
    print()
    print("export const SITES = [")
    for s in sites:
        print(f"  {{ id: {s['id']!r}, name: {s['name']!r}, body: {s['body']!r}, type: {s['type']!r}, class: {s['class']!r}, hydration: {s['hydration']}, vps: {s['vps']}, dvLeo: {s['dv_leo']}, solarZone: {s['solar_zone']!r}, x: {s['x']}, y: {s['y']} }},")
    print("];")
    print()

    # ----- Derive edges -----
    # Three rules:
    #  1. Same body group -> connect all pairs with dv=1 (intra-cluster).
    #  2. Same solar zone, otherwise -> connect each site to its two
    #     nearest neighbours with dv=ceil(burns_diff)+1 (intra-zone).
    #  3. Between adjacent solar zones (Mercury->Venus->Earth->Mars->
    #     Ceres->Jupiter->Saturn->Uranus->Neptune) -> connect the
    #     highest-burn site in the inner zone to the three lowest-burn
    #     sites in the outer zone (inter-zone bridges).
    edges = set()
    def add_edge(a, b, dv):
        if a == b: return
        pair = tuple(sorted([a, b]))
        if pair in edges: return
        edges.add(pair + (max(1, int(dv)),))

    # (1) intra-body cluster
    from collections import defaultdict
    by_body = defaultdict(list)
    for s in sites:
        by_body[s['body']].append(s)
    for body, members in by_body.items():
        if len(members) < 2: continue
        for i in range(len(members)):
            for j in range(i+1, len(members)):
                add_edge(members[i]['id'], members[j]['id'], 1)

    # (2) intra-zone nearest neighbours by burns delta
    by_zone = defaultdict(list)
    for s in sites:
        by_zone[s['solar_zone']].append(s)
    for zone, members in by_zone.items():
        members.sort(key=lambda s: s['dv_leo'])
        for i, a in enumerate(members):
            # Connect to up to 2 nearest by burns delta (and not same body)
            neighbours = sorted(
                (b for b in members if b['id'] != a['id'] and b['body'] != a['body']),
                key=lambda b: abs(b['dv_leo'] - a['dv_leo'])
            )[:2]
            for b in neighbours:
                add_edge(a['id'], b['id'], abs(b['dv_leo'] - a['dv_leo']) + 1)

    # (3) inter-zone bridges
    zone_order = ['Mercury', 'Venus', 'Earth', 'Mars', 'Ceres',
                  'Jupiter', 'Saturn', 'Uranus', 'Neptune']
    for inner, outer in zip(zone_order, zone_order[1:]):
        inner_sites = by_zone.get(inner, [])
        outer_sites = by_zone.get(outer, [])
        if not inner_sites or not outer_sites: continue
        # From the 2 highest-burn inner sites to the 3 lowest-burn outer sites.
        inner_top = sorted(inner_sites, key=lambda s: -s['dv_leo'])[:2]
        outer_low = sorted(outer_sites, key=lambda s: s['dv_leo'])[:3]
        for a in inner_top:
            for b in outer_low:
                dv = max(1, int(round(abs(b['dv_leo'] - a['dv_leo']))))
                add_edge(a['id'], b['id'], dv)

    print("export const EDGES = [")
    for a, b, dv in sorted(edges):
        print(f"  [{a!r}, {b!r}, {dv}],")
    print("];")
    print()
    print(f"// Stats: {len(sites)} sites across "
          f"{len(set(s['solar_zone'] for s in sites))} solar zones, "
          f"{len(edges)} edges")


if __name__ == '__main__':
    main()
