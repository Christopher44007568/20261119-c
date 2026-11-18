"use strict";

const zlib = require("node:zlib");

let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

function crc32(buffer) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function aces(x) {
  return Math.max(0, Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
}

function encodePng(linear, width, height, sampleCount = 1) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  const inverseSamples = 1 / Math.max(sampleCount, 1);
  for (let y = 0; y < height; y++) {
    const row = height - 1 - y;
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const src = (row * width + x) * 3;
      const dst = y * stride + 1 + x * 3;
      const uvx = (x + 0.5) / width;
      const uvy = (row + 0.5) / height;
      const dist = Math.hypot(uvx - 0.5, uvy - 0.5);
      const vignette = 1 - 0.13 * Math.max(0, Math.min(1, (dist - 0.32) / 0.54));
      for (let c = 0; c < 3; c++) {
        let value = linear[src + c] * inverseSamples * 1.18 * vignette;
        if (!Number.isFinite(value)) value = 0;
        value = Math.pow(aces(value), 1 / 2.2);
        raw[dst + c] = Math.round(Math.max(0, Math.min(1, value)) * 255);
      }
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("gAMA", Buffer.from([0, 0, 0xb1, 0x8f])),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

module.exports = { encodePng };
