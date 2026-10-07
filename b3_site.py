#!/usr/bin/env python3
"""Pages publish-dir helpers: dated preview paths and retention prune."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
import shutil


def preview_run_parts(run_at: datetime) -> tuple[str, str]:
    """Return (YYYY-MM-DD, HH-MM) in the datetime's local fields (use America/Sao_Paulo)."""
    return run_at.strftime("%Y-%m-%d"), run_at.strftime("%H-%M")


def preview_relpath(run_at: datetime, index: int, ticker: str) -> str:
    """Site-root-relative PNG path: previews/YYYY-MM-DD/HH-MM/NN_TICKER.png"""
    day, hm = preview_run_parts(run_at)
    return f"previews/{day}/{hm}/{index:02d}_{ticker}.png"


def preview_run_dir(site_dir: Path, run_at: datetime) -> Path:
    day, hm = preview_run_parts(run_at)
    return Path(site_dir) / "previews" / day / hm


def prune_preview_days(
    previews_root: Path,
    keep_days: int,
    today: date,
) -> list[str]:
    """Delete date folders older than today - (keep_days - 1). Returns removed folder names."""
    if keep_days < 1 or not previews_root.is_dir():
        return []
    cutoff = today - timedelta(days=keep_days - 1)
    removed: list[str] = []
    for child in sorted(previews_root.iterdir()):
        if not child.is_dir():
            continue
        try:
            folder_day = date.fromisoformat(child.name)
        except ValueError:
            continue
        if folder_day < cutoff:
            shutil.rmtree(child, ignore_errors=True)
            removed.append(child.name)
    return removed


def write_nojekyll(site_dir: Path) -> None:
    (Path(site_dir) / ".nojekyll").write_text("", encoding="utf-8")
