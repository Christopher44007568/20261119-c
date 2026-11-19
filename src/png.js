// Minimal 8-bit RGB PNG writer using only Node's built-in zlib.
// Buffers passed in are Float32 RGB arrays; values are expected to be already
// tonemapped/normalized into [0, 1] by the caller.

import zlib from 'node:zlib';
import { clamp01 } from './math.js';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, body])), 0);
  return Buffer.concat([length, typeBuffer, body, checksum]);
}

export function encodePng(rgbBuffer, width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter type none
    for (let x = 0; x < stride; x++) {
      const v = clamp01(rgbBuffer[y * stride + x]);
      raw[offset++] = Math.round(v * 255);
    }
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Reinhard tonemap of an HDR float buffer into a new [0, 1] float buffer.
// Applied only at visualization time; the simulation keeps linear HDR values.
export function reinhard(rgbBuffer) {
  const out = new Float32Array(rgbBuffer.length);
  for (let i = 0; i < rgbBuffer.length; i++) {
    const v = rgbBuffer[i];
    out[i] = v / (1 + v);
  }
  return out;
}
