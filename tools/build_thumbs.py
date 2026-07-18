#!/usr/bin/env python3
"""Generate 800px grid thumbnails and enrich photos.json with responsive data.

Run from the repo root:  python3 tools/build_thumbs.py

For every image in photos.json (all galleries, payday + collage) plus the
hardcoded EXTRA_IMAGES below, this writes an 800px-wide WebP thumbnail to
photos/thumbs/<same path>, then rewrites photos.json so each entry carries:

    thumb   - the grid-tile file (800px WebP)
    srcset  - "<thumb> 800w, <original> <realW>w"
    sizes   - matches the collage's responsive column widths
    width/height - the thumb's real pixels (browsers use the ratio for CLS)

The lightbox keeps using `src` (full resolution). Idempotent: existing thumbs
are kept, so re-running after adding new photos only processes the new ones.
Falls back to sips+JPEG when cwebp is unavailable.

Also writes tools/thumbs-report.json listing every processed image with its
original and thumb dimensions (used to keep hardcoded <img> tags accurate).
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "photos.json"
THUMBS_DIR = "photos/thumbs"
THUMB_WIDTH = 800
GALLERY_SIZES = "(max-width: 640px) 50vw, (max-width: 960px) 33vw, 308px"

# Images referenced directly by HTML/JS rather than photos.json.
EXTRA_IMAGES = [
    "photos/work/work-1.jpg",
    "photos/work/work-2.jpg",
    "photos/video/mens-basketball-intro/cover.jpg",
    "photos/homepage/game-days/gameday-01.jpg",
    "photos/homepage/game-days/gameday-02.jpg",
    "photos/homepage/game-days/gameday-03.jpg",
    "photos/homepage/game-days/gameday-04.jpg",
    "photos/homepage/media-days/mediaday-01.jpg",
    "photos/homepage/media-days/mediaday-02.jpg",
    "photos/homepage/media-days/mediaday-03.jpg",
    "photos/homepage/media-days/mediaday-04.jpg",
    "photos/homepage/video-covers/video-cover-01.jpg",
    "photos/homepage/video-covers/video-cover-02.jpg",
    "photos/about-me/01.jpg",
    "photos/about-me/pfp.jpg",
    "photos/about-me/athlete/football-portrait.jpg",
    "photos/about-me/athlete/basketball-seniornight.jpg",
    "photos/about-me/athlete/basketball-huddle.jpg",
    "photos/about-me/athlete/football-night.jpg",
    "photos/about-me/behind-the-lens/bts-01.jpg",
    "photos/about-me/behind-the-lens/bts-02.jpg",
    "photos/about-me/behind-the-lens/bts-03.jpg",
    "photos/about-me/behind-the-lens/bts-04.jpg",
    "photos/about-me/company/video-cover-01.jpeg",
    "photos/about-me/company/video-cover-02.jpeg",
    "photos/about-me/company/video-cover-03.jpeg",
    "photos/about-me/company/video-cover-04.jpeg",
    "photos/about-me/future/future-01-poster.jpg",
    "photos/about-me/future/future-01.jpg",
    "photos/about-me/future/future-02-poster.jpg",
    "photos/about-me/future/future-02.jpg",
]

HAVE_CWEBP = shutil.which("cwebp") is not None


def dimensions(path):
    out = subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    w = h = None
    for line in out.splitlines():
        if "pixelWidth:" in line:
            w = int(line.split(":")[1])
        elif "pixelHeight:" in line:
            h = int(line.split(":")[1])
    if not w or not h:
        raise RuntimeError(f"could not read dimensions of {path}")
    return w, h


def thumb_path(src):
    rel = Path(src).relative_to("photos")
    ext = ".webp" if HAVE_CWEBP else rel.suffix
    return str(Path(THUMBS_DIR) / rel.with_suffix(ext))


def build_thumb(src, dest, src_width):
    dest_abs = ROOT / dest
    dest_abs.parent.mkdir(parents=True, exist_ok=True)
    if dest_abs.exists():
        return False
    if HAVE_CWEBP:
        cmd = ["cwebp", "-quiet", "-q", "78"]
        if src_width > THUMB_WIDTH:
            cmd += ["-resize", str(THUMB_WIDTH), "0"]
        cmd += [str(ROOT / src), "-o", str(dest_abs)]
        subprocess.run(cmd, check=True)
    else:
        shutil.copy(ROOT / src, dest_abs)
        cmd = ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "75"]
        if src_width > THUMB_WIDTH:
            cmd += ["--resampleWidth", str(THUMB_WIDTH)]
        subprocess.run(cmd + [str(dest_abs)], check=True, capture_output=True)
    return True


def process(src, report):
    src_abs = ROOT / src
    if not src_abs.exists():
        raise FileNotFoundError(src)
    w, h = dimensions(src_abs)
    dest = thumb_path(src)
    made = build_thumb(src, dest, w)
    tw, th = dimensions(ROOT / dest)
    # Sanity: the thumb must keep the original's aspect ratio.
    if abs((w / h) - (tw / th)) / (w / h) > 0.01:
        raise RuntimeError(f"aspect ratio drifted for {src}: {w}x{h} -> {tw}x{th}")
    report[src] = {"thumb": dest, "width": w, "height": h,
                   "thumbWidth": tw, "thumbHeight": th}
    return made


def main():
    manifest = json.loads(MANIFEST.read_text())
    report = {}
    created = 0

    for gallery in manifest.values():
        for section in ("payday", "collage"):
            for entry in gallery.get(section, []):
                src = entry["src"]
                created += process(src, report)
                info = report[src]
                entry["thumb"] = info["thumb"]
                entry["srcset"] = (
                    f"{info['thumb']} {info['thumbWidth']}w, "
                    f"{src} {info['width']}w"
                )
                entry["sizes"] = GALLERY_SIZES
                entry["width"] = info["thumbWidth"]
                entry["height"] = info["thumbHeight"]

    for src in EXTRA_IMAGES:
        created += process(src, report)

    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    (ROOT / "tools/thumbs-report.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )
    print(f"{len(report)} images processed, {created} thumbnails created "
          f"({'webp' if HAVE_CWEBP else 'jpeg fallback'})")


if __name__ == "__main__":
    sys.exit(main())
