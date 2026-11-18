"""Minimal PNG writer (RGB8) using only the standard library."""

import struct
import zlib


def write_png(path, width, height, rgb):
    """rgb: flat list/bytes of length width*height*3 with values 0..255."""
    raw = bytearray()
    stride = width * 3
    for y in range(height):
        raw.append(0)  # filter type 0
        row = rgb[y * stride:(y + 1) * stride]
        raw.extend(bytes(row))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    data = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 6))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(data)
