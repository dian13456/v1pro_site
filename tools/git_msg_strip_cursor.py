#!/usr/bin/env python3
"""Strip Cursor co-author / attribution trailers from git commit messages (stdin -> stdout)."""

from __future__ import annotations

import re
import sys

CURSOR_PATTERNS = (
    re.compile(r"(?i)^co-authored-by:\s*cursor\b"),
    re.compile(r"(?i)^made-with:\s*cursor\b"),
)


def strip_cursor_trailers(text: str) -> str:
    lines = text.splitlines()
    filtered = [line for line in lines if not any(p.match(line) for p in CURSOR_PATTERNS)]
    while filtered and not filtered[-1].strip():
        filtered.pop()
    if not filtered:
        return ""
    return "\n".join(filtered) + "\n"


if __name__ == "__main__":
    sys.stdout.write(strip_cursor_trailers(sys.stdin.read()))
