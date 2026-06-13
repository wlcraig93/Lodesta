/**
 * Header-only image dimension measurement for the formats scraped media
 * accepts (PNG, JPEG, WebP). Pure byte parsing — no decoder dependency —
 * so download paths can measure assets the moment bytes arrive instead of
 * waiting for the Playwright palette pass.
 */

export type ImageDimensions = { width: number; height: number };

export function measureImageDimensions(bytes: Buffer, mimeType: string): ImageDimensions | undefined {
  try {
    if (mimeType === "image/png") return measurePng(bytes);
    if (mimeType === "image/jpeg") return measureJpeg(bytes);
    if (mimeType === "image/webp") return measureWebp(bytes);
    return undefined;
  } catch {
    return undefined;
  }
}

function valid(dimensions: ImageDimensions): ImageDimensions | undefined {
  return dimensions.width > 0 && dimensions.height > 0 ? dimensions : undefined;
}

function measurePng(bytes: Buffer): ImageDimensions | undefined {
  // 8-byte signature, 4-byte IHDR length, 4-byte "IHDR", then width/height.
  if (bytes.length < 24) return undefined;
  if (bytes.readUInt32BE(0) !== 0x89504e47) return undefined;
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return undefined;
  return valid({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
}

function measureJpeg(bytes: Buffer): ImageDimensions | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    // Standalone markers without a length payload.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01 || marker === 0xff) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    // SOF0–SOF15 carry frame dimensions (excluding DHT/JPGA/DAC tables).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return valid({ width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) });
    }
    if (length < 2) return undefined;
    offset += 2 + length;
  }
  return undefined;
}

function measureWebp(bytes: Buffer): ImageDimensions | undefined {
  if (bytes.length < 30) return undefined;
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return undefined;
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return valid({
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3)
    });
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return undefined;
    const bits = bytes.readUInt32LE(21);
    return valid({
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff)
    });
  }
  if (chunk === "VP8 ") {
    // Lossy frame: 3-byte frame tag, then 0x9D012A sync code, then dimensions.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return undefined;
    return valid({
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff
    });
  }
  return undefined;
}
