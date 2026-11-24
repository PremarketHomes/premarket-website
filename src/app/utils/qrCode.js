/**
 * QR code generator (ISO/IEC 18004, byte mode, versions 1–40), dependency-free and pure, so QR codes are drawn by
 * Premarket itself as crisp SVG (A3 / A-frame print quality) without sending the encoded link to a third-party image
 * service. The algorithm follows Project Nayuki's reference implementation (MIT licence); every output is checked
 * against an independent decoder in tests (see tests/unit/qr-code.test.js).
 *
 *   const qr = encodeQr('https://premarket.homes/prop4827319056', { ecc: 'M' });
 *   qr.size            // modules per side (21 for version 1 … 177 for version 40)
 *   qr.isDark(x, y)    // true for a dark module
 *   qrSvgPath(qr, 4)   // one SVG path ("M…h1v1h-1z…") covering every dark module, with a 4-module quiet zone
 */

const ECC_LEVELS = {
  L: { ordinal: 0, formatBits: 1 },
  M: { ordinal: 1, formatBits: 0 },
  Q: { ordinal: 2, formatBits: 3 },
  H: { ordinal: 3, formatBits: 2 },
};

// Error-correction codewords per block, by level (L, M, Q, H) and version (index 0 unused).
const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

// Error-correction blocks, by level (L, M, Q, H) and version (index 0 unused).
const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const getBit = (x, i) => ((x >>> i) & 1) !== 0;

function numRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(ver, ecl) {
  return Math.floor(numRawDataModules(ver) / 8)
    - ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
}

// GF(2^8) multiplication modulo x^8 + x^4 + x^3 + x^2 + 1.
function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function reedSolomonDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMultiply(coef, factor); });
  }
  return result;
}

function utf8Bytes(text) {
  if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
  return Array.from(unescape(encodeURIComponent(text)), (c) => c.charCodeAt(0));
}

/**
 * Encodes `text` (UTF-8, byte mode) at the smallest version that fits the requested error-correction level.
 * `ecc`: 'L' | 'M' | 'Q' | 'H' (default 'M', ~15% damage tolerance). Throws if the text is too long for version 40.
 */
export function encodeQr(text, { ecc = 'M', minVersion = 1, maxVersion = 40 } = {}) {
  const ecl = ECC_LEVELS[ecc];
  if (!ecl) throw new Error(`Unknown QR error-correction level: ${ecc}`);
  const bytes = utf8Bytes(String(text));

  // Smallest version whose capacity fits: 4-bit mode + character count (8 bits up to v9, else 16) + data.
  let version;
  for (version = minVersion; ; version += 1) {
    const countBits = version <= 9 ? 8 : 16;
    const usedBits = 4 + countBits + bytes.length * 8;
    if (bytes.length < (1 << countBits) && usedBits <= numDataCodewords(version, ecl) * 8) break;
    if (version >= maxVersion) throw new Error('Text too long for a QR code');
  }

  // Bit stream: byte mode (0100), count, data, terminator, byte padding, then alternating pad codewords.
  const bits = [];
  const append = (val, len) => { for (let i = len - 1; i >= 0; i -= 1) bits.push((val >>> i) & 1); };
  append(0x4, 4);
  append(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) append(b, 8);
  const capacityBits = numDataCodewords(version, ecl) * 8;
  append(0, Math.min(4, capacityBits - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) append(pad, 8);
  const dataCodewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j += 1) v = (v << 1) | bits[i + j];
    dataCodewords.push(v);
  }

  // Split into blocks, add Reed–Solomon error correction, interleave.
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][version];
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = reedSolomonDivisor(blockEccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i += 1) {
    const dat = dataCodewords.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const eccBytes = reedSolomonRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(eccBytes));
  }
  const allCodewords = [];
  for (let i = 0; i < blocks[0].length; i += 1) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) allCodewords.push(block[i]);
    });
  }

  // Module grid.
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFunction = (x, y, dark) => { modules[y][x] = dark; isFunction[y][x] = true; };

  for (let i = 0; i < size; i += 1) { setFunction(6, i, i % 2 === 0); setFunction(i, 6, i % 2 === 0); }
  const drawFinder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFunction(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  const alignPositions = (() => {
    if (version === 1) return [];
    const numAlign = Math.floor(version / 7) + 2;
    const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
    const result = [6];
    for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  })();
  const n = alignPositions.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          setFunction(alignPositions[i] + dx, alignPositions[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  const drawFormatBits = (mask) => {
    const data = (ecl.formatBits << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fbits = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i += 1) setFunction(8, i, getBit(fbits, i));
    setFunction(8, 7, getBit(fbits, 6));
    setFunction(8, 8, getBit(fbits, 7));
    setFunction(7, 8, getBit(fbits, 8));
    for (let i = 9; i < 15; i += 1) setFunction(14 - i, 8, getBit(fbits, i));
    for (let i = 0; i < 8; i += 1) setFunction(size - 1 - i, 8, getBit(fbits, i));
    for (let i = 8; i < 15; i += 1) setFunction(8, size - 15 + i, getBit(fbits, i));
    setFunction(8, size - 8, true); // the always-dark module
  };
  drawFormatBits(0); // reserve the format areas; redrawn once the mask is chosen

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vbits = (version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const bit = getBit(vbits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(a, b, bit);
      setFunction(b, a, bit);
    }
  }

  // Codewords in the zig-zag order, skipping function modules.
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && bitIndex < allCodewords.length * 8) {
          modules[y][x] = getBit(allCodewords[bitIndex >>> 3], 7 - (bitIndex & 7));
          bitIndex += 1;
        }
      }
    }
  }

  const maskBit = (mask, x, y) => {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  };
  const applyMask = (mask) => {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (!isFunction[y][x] && maskBit(mask, x, y)) modules[y][x] = !modules[y][x];
      }
    }
  };

  // Penalty score (ISO 18004 §7.8.3): long runs, 2x2 blocks, finder-like patterns, dark/light balance.
  const penalty = () => {
    let score = 0;
    const runPenalty = (getter) => {
      for (let a = 0; a < size; a += 1) {
        let runColor = getter(a, 0);
        let runLen = 1;
        for (let b = 1; b < size; b += 1) {
          const c = getter(a, b);
          if (c === runColor) {
            runLen += 1;
          } else {
            if (runLen >= 5) score += 3 + (runLen - 5);
            runColor = c;
            runLen = 1;
          }
        }
        if (runLen >= 5) score += 3 + (runLen - 5);
      }
    };
    runPenalty((y, x) => modules[y][x]);
    runPenalty((x, y) => modules[y][x]);
    for (let y = 0; y < size - 1; y += 1) {
      for (let x = 0; x < size - 1; x += 1) {
        const c = modules[y][x];
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
      }
    }
    const patternA = [true, false, true, true, true, false, true, false, false, false, false];
    const patternB = [false, false, false, false, true, false, true, true, true, false, true];
    const matches = (getter, a, b, pattern) => pattern.every((p, k) => getter(a, b + k) === p);
    for (let a = 0; a < size; a += 1) {
      for (let b = 0; b + 11 <= size; b += 1) {
        const row = (r, c) => modules[r][c];
        const col = (c, r) => modules[r][c];
        if (matches(row, a, b, patternA) || matches(row, a, b, patternB)) score += 40;
        if (matches(col, a, b, patternA) || matches(col, a, b, patternB)) score += 40;
      }
    }
    let dark = 0;
    for (const row of modules) for (const c of row) if (c) dark += 1;
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    score += Math.max(0, k) * 10;
    return score;
  };

  let bestMask = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    applyMask(mask);
    drawFormatBits(mask);
    const s = penalty();
    if (s < bestScore) { bestScore = s; bestMask = mask; }
    applyMask(mask); // undo (XOR)
  }
  applyMask(bestMask);
  drawFormatBits(bestMask);

  return {
    version,
    size,
    ecc,
    mask: bestMask,
    isDark: (x, y) => x >= 0 && y >= 0 && x < size && y < size && modules[y][x],
  };
}

/**
 * One SVG path for every dark module (horizontal runs merged), offset by a quiet-zone `border` in modules.
 * Render with viewBox `0 0 ${qr.size + 2 * border} ${qr.size + 2 * border}` and shape-rendering="crispEdges".
 */
export function qrSvgPath(qr, border = 4) {
  const parts = [];
  for (let y = 0; y < qr.size; y += 1) {
    let x = 0;
    while (x < qr.size) {
      if (!qr.isDark(x, y)) { x += 1; continue; }
      let run = 1;
      while (x + run < qr.size && qr.isDark(x + run, y)) run += 1;
      parts.push(`M${x + border} ${y + border}h${run}v1h-${run}z`);
      x += run;
    }
  }
  return parts.join('');
}
