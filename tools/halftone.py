#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
halftone.py — turn the photographs into halftone cell maps.

The hero is a point cloud; the photographs downstream have to be made of the
same stuff or the page breaks in two at the fold. So every photograph is
re-screened: the picture becomes dots whose size is the local brightness.

WHY THIS SHIPS MAPS AND NOT PICTURES OF DOTS
--------------------------------------------
Baking the dots into image files was tried first and measured: the twenty
photographs went from 1,299kB to 2,868kB, even resized down to the size they
are actually displayed at and encoded at quality 66. A screen of dots is
nothing but high-frequency detail, which is the worst case for every lossy
codec — the halftone of a nearly blank sheet of paper came out fourteen times
larger than the photograph of it.

But a halftone carries almost no information. One number per cell, the local
brightness, is the whole of it. So that is what gets shipped: a greyscale PNG
with one pixel per cell, seventy-seven pixels wide for a plate. The dots are
drawn in the browser from that (see src/paper/halftone.js). Twenty maps come
to about 90kB — the page ends up lighter than it was, not heavier.

The colour is written into the HTML as `data-ink`, not into the pixels. The
temperature ramp the design asks for — silver at the top of the page, the
warmth of ink and paper at the bottom — is a gradient over the DOCUMENT, and
each photograph sits at a fixed place in it, so nothing has to be recomputed
while scrolling. Positions come from index.html: sections in document order,
images inside them; a file used in several sections gets the average.

    python tools/halftone.py           # write public/paper/ht/*.png, patch index.html
    python tools/halftone.py --dry     # print the plan and change nothing

Safe to re-run: the source photographs stay where they are and are always
found by name, never through the src the markup currently carries.
"""

import argparse
import os
import re

from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(HERE, 'index.html')
OUT_DIR = os.path.join(HERE, 'public', 'paper', 'ht')

# Dot pitch on screen, in CSS px, per role. This is the number that decides how
# the whole site reads: at 4 the dots dissolve into a grey wash, at 12 the
# photographs stop being legible.
#
# Finer for the small plates, for the reason a printer runs a finer screen on a
# small reproduction: a 196px chip at a 7px pitch is 28 cells across, and 28
# cells cannot hold a photograph of thread or a type case — on the page they
# came out as blocky abstractions that read as a glitch rather than a picture.
# The portrait gets the same treatment; a face needs cells to be a face.
PITCH_CSS = {'bg': 7.0, 'lead': 7.0, 'portrait': 5.0, 'sub': 4.4}

# Rendered widths measured in the page at a 1440px viewport (Playwright,
# 2026-09-06). Hard-coded rather than derived from the files' own dimensions,
# which are all 1024-1536px regardless of how large they are actually drawn.
DISPLAY_CSS = {
    'bg': 1613,        # .mv__bg — full bleed
    'lead': 540,       # .plate[data-p="lead"]
    'sub': 196,        # .plate[data-p="sub"] and "chip"
    'portrait': 290,   # .plate--portrait
}

# Ends of the temperature ramp: the colour of the dots themselves. There is no
# ground colour — the dots are drawn on transparency and the page's field shows
# between them, which is also why images with an alpha channel need no special
# handling.
COLD_INK = (201, 212, 226)
WARM_INK = (233, 221, 202)

SKIP = {'dust01.webp', 'dust02.webp'}   # WebGL textures for the dust pass


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def hexcolor(rgb):
    return '#%02x%02x%02x' % rgb


def scan_index():
    """[(src, t, role)] — document order gives t, the surrounding tag the role."""
    html = open(INDEX, encoding='utf-8').read()
    parts = re.split(r'(<section class="mv[^"]*")', html)
    sections = [parts[i] + parts[i + 1] for i in range(1, len(parts), 2)]

    order = ['sub', 'portrait', 'lead', 'bg']
    hits = {}
    for i, sec in enumerate(sections):
        t = i / max(1, len(sections) - 1)
        for wrap, src in re.findall(
                r'<(figure[^>]*|div class="mv__bg"[^>]*)>\s*<img[^>]*src="(/[^"]+)"', sec):
            if 'mv__bg' in wrap:
                role = 'bg'
            elif 'portrait' in wrap:
                role = 'portrait'
            elif 'data-p="lead"' in wrap:
                role = 'lead'
            else:
                role = 'sub'
            rec = hits.setdefault(src, {'t': [], 'role': role})
            rec['t'].append(t)
            # A file used both as a lead and as a chip is screened for the
            # larger of the two; screening it for the small one would show.
            if order.index(role) > order.index(rec['role']):
                rec['role'] = role

    return sorted(((src, sum(v['t']) / len(v['t']), v['role'])
                   for src, v in hits.items()), key=lambda r: r[1])


def find_origin(stem):
    """The photograph a stem came from, looked up by name.

    index.html is rewritten to point at the maps, so on a second run the src
    in the markup IS a map. Deriving the source from it re-screened the screens
    and turned every map into upscaled mush — which is what happened the first
    time this was run twice. The original is therefore always found by stem
    among the photographs, and never from whatever src currently says.

    The photographs stay exactly where they have always been. They are no
    longer referenced by the page, but they are the masters these maps are
    generated from, so they are not something to tidy away.
    """
    for folder in (os.path.join(HERE, 'public', 'paper'),
                   os.path.join(HERE, 'public')):
        for ext in ('.webp', '.jpg', '.jpeg'):
            candidate = os.path.join(folder, stem + ext)
            if os.path.exists(candidate):
                return candidate
    return None


def build_map(origin, cells_x):
    im = Image.open(origin)
    alpha = im.getchannel('A') if im.mode in ('RGBA', 'LA') else None
    grey = im.convert('L')
    w, h = grey.size
    cells_y = max(1, round(cells_x * h / w))

    # BOX, not LANCZOS: each output pixel has to be the plain average of the
    # cell under it. A sharpening filter would give dots that overshoot into
    # black and white at every edge in the photograph.
    small = grey.resize((cells_x, cells_y), Image.BOX)
    if alpha is not None:
        a = alpha.resize((cells_x, cells_y), Image.BOX)
        small = Image.composite(small, Image.new('L', small.size, 0),
                                a.point(lambda v: 255 if v > 127 else 0))
    return small


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry', action='store_true')
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)

    table, rows, total = {}, [], 0
    for src, t, role in scan_index():
        stem = os.path.splitext(os.path.basename(src))[0]
        origin = find_origin(stem)
        if origin is None or os.path.basename(origin) in SKIP:
            continue

        cells_x = max(12, round(DISPLAY_CSS[role] / PITCH_CSS[role]))
        ink = hexcolor(lerp(COLD_INK, WARM_INK, t))
        out_name = stem + '.png'
        table[stem] = (out_name, ink)

        if args.dry:
            rows.append('%-32s %-8s t=%.2f cells=%3d ink=%s'
                        % (stem, role, t, cells_x, ink))
            continue

        out_path = os.path.join(OUT_DIR, out_name)
        # An earlier version of this script wrote its output over the served
        # path — which was the photograph itself — and destroyed three of the
        # originals before anyone noticed. Nothing here writes outside ht/.
        assert os.path.dirname(os.path.abspath(out_path)) == os.path.abspath(OUT_DIR)
        build_map(origin, cells_x).save(out_path, 'PNG', optimize=True)
        total += os.path.getsize(out_path)
        rows.append('%-32s %-8s t=%.2f cells=%3d ink=%s %6.1fKB'
                    % (stem, role, t, cells_x, ink,
                       os.path.getsize(out_path) / 1024))

    if args.dry:
        print('\n'.join(rows))
        return

    # Rewrite every <img> whose stem was screened. Keyed on the stem, and any
    # existing data-ink is stripped first, so re-running is a no-op rather than
    # a second attribute.
    def fix(match):
        tag = match.group(0)
        src = re.search(r'src="([^"]+)"', tag)
        if not src:
            return tag
        stem = os.path.splitext(os.path.basename(src.group(1)))[0]
        if stem not in table:
            return tag
        out_name, ink = table[stem]
        tag = re.sub(r'\s*data-ink="[^"]*"', '', tag)
        return tag.replace(src.group(0),
                           'src="/paper/ht/%s" data-ink="%s"' % (out_name, ink))

    html = re.sub(r'<img\b[^>]*>', fix, open(INDEX, encoding='utf-8').read())
    open(INDEX, 'w', encoding='utf-8').write(html)

    print('\n'.join(rows))
    print('\n%d maps, %.0fKB total' % (len(rows), total / 1024))


if __name__ == '__main__':
    main()
