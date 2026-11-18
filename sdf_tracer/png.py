"""Tiny uncompressed PNG writer using only the standard library."""
import struct
import zlib


def write_png(path, width, height, rgb_rows):
    """rgb_rows: iterable of rows, each a flat sequence of R,G,B bytes."""
    raw = bytearray()
    for row in rgb_rows:
        raw.append(0)
        raw.extend(row)

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return out + struct.pack(">I", crc)

    signature = b"\x89PNG\r\n\x1a\n"
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    with open(path, "wb") as fh:
        fh.write(signature)
        fh.write(chunk(b"IHDR", header))
        fh.write(chunk(b"IDAT", zlib.compress(bytes(raw), 6)))
        fh.write(chunk(b"IEND", b""))
