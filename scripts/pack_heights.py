"""One-off: re-pack the existing 16-bit height PNGs as lossless two-channel WebP
(the format both builders now write) and point the manifests at them. Values are
bit-exact; each file is round-tripped before its PNG is moved to scripts/.cache."""

from __future__ import annotations

import json
import shutil
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

from build_moon_data import write_height_webp

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / "public"
ATTIC = ROOT / "scripts" / ".cache" / "png_heights"


def pack(png: str) -> tuple[str, int, int]:
    src = PUB / png
    dst = src.with_suffix(".webp")
    q = np.array(Image.open(src))
    assert q.dtype == np.uint16 or q.dtype == np.int32, (png, q.dtype)
    write_height_webp(q, dst)
    rgb = np.array(Image.open(dst).convert("RGB")).astype(np.int32)
    back = (rgb[..., 0] << 8) | rgb[..., 1]
    if not np.array_equal(back, q.astype(np.int32)):
        dst.unlink()
        raise SystemExit(f"round-trip mismatch for {png}")
    return png, src.stat().st_size, dst.stat().st_size


def main() -> None:
    moon_m = PUB / "moon" / "manifest.json"
    sim_m = PUB / "sim" / "manifest.json"
    sites_j = PUB / "sim" / "sites.json"
    moon = json.loads(moon_m.read_text(encoding="utf-8"))
    sim = json.loads(sim_m.read_text(encoding="utf-8"))
    sites = json.loads(sites_j.read_text(encoding="utf-8"))

    entries = [("moon", moon["global"])] + [("moon", p) for p in moon["patches"]]
    entries += [("sim", sim["poleFine"]), ("sim", sim["poleWide"])]
    for s in sites:
        for k in ("near", "mid"):
            if s.get(k):
                entries.append(("sim", s[k]))
    todo = [f"{d}/{e['file']}" for d, e in entries if e["file"].endswith(".png")]

    before = after = 0
    with ProcessPoolExecutor(max_workers=6) as ex:
        for png, a, b in ex.map(pack, todo):
            before += a
            after += b
            print(f"  {png:34s} {a / 1e6:6.2f} -> {b / 1e6:6.2f} MB")
    for _, e in entries:
        e["file"] = e["file"].replace(".png", ".webp")
    moon_m.write_text(json.dumps(moon, indent=2), encoding="utf-8")
    sim_m.write_text(json.dumps(sim, indent=1), encoding="utf-8")
    sites_j.write_text(json.dumps(sites, indent=1, ensure_ascii=False), encoding="utf-8")
    for png in todo:
        dest = ATTIC / png
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(PUB / png), dest)
    print(f"total {before / 1e6:.1f} -> {after / 1e6:.1f} MB; PNGs moved to {ATTIC.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
