/** Small dependency-free SHA-256 implementation shared by HarmonyOS and Android. */
const ROUND = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function utf8(text: string): number[] {
  const bytes: number[] = [];
  for (let index: number = 0; index < text.length; index++) {
    let value: number = text.charCodeAt(index);
    if (value >= 0xd800 && value <= 0xdbff) {
      if (index + 1 >= text.length) throw new Error('Invalid UTF-16 surrogate');
      const low: number = text.charCodeAt(++index);
      if (low < 0xdc00 || low > 0xdfff) throw new Error('Invalid UTF-16 surrogate');
      value = 0x10000 + ((value - 0xd800) << 10) + (low - 0xdc00);
    } else if (value >= 0xdc00 && value <= 0xdfff) {
      throw new Error('Invalid UTF-16 surrogate');
    }
    if (value <= 0x7f) {
      bytes.push(value);
    } else if (value <= 0x7ff) {
      bytes.push(0xc0 | (value >> 6), 0x80 | (value & 0x3f));
    } else if (value <= 0xffff) {
      bytes.push(0xe0 | (value >> 12), 0x80 | ((value >> 6) & 0x3f), 0x80 | (value & 0x3f));
    } else {
      bytes.push(0xf0 | (value >> 18), 0x80 | ((value >> 12) & 0x3f),
        0x80 | ((value >> 6) & 0x3f), 0x80 | (value & 0x3f));
    }
  }
  return bytes;
}

function rotate(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

function hex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

/** Returns the lowercase SHA-256 digest of the exact UTF-8 text. */
export function sha256Hex(text: string): string {
  const input: number[] = utf8(text);
  const bitLength: number = input.length * 8;
  input.push(0x80);
  while (input.length % 64 !== 56) input.push(0);

  const high: number = Math.floor(bitLength / 0x100000000);
  const low: number = bitLength >>> 0;
  for (let shift: number = 24; shift >= 0; shift -= 8) input.push((high >>> shift) & 0xff);
  for (let shift: number = 24; shift >= 0; shift -= 8) input.push((low >>> shift) & 0xff);

  const state: number[] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];

  for (let offset: number = 0; offset < input.length; offset += 64) {
    const words: number[] = [];
    for (let index: number = 0; index < 16; index++) {
      const position: number = offset + index * 4;
      words.push(((input[position] << 24) | (input[position + 1] << 16) |
        (input[position + 2] << 8) | input[position + 3]) >>> 0);
    }
    for (let index: number = 16; index < 64; index++) {
      const x: number = words[index - 15];
      const y: number = words[index - 2];
      const s0: number = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
      const s1: number = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
      words.push((words[index - 16] + s0 + words[index - 7] + s1) >>> 0);
    }
    let a: number = state[0];
    let b: number = state[1];
    let c: number = state[2];
    let d: number = state[3];
    let e: number = state[4];
    let f: number = state[5];
    let g: number = state[6];
    let h: number = state[7];
    for (let index: number = 0; index < 64; index++) {
      const s1: number = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choose: number = (e & f) ^ (~e & g);
      const temp1: number = (h + s1 + choose + ROUND[index] + words[index]) >>> 0;
      const s0: number = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority: number = (a & b) ^ (a & c) ^ (b & c);
      const temp2: number = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return state.map((value: number) => hex(value)).join('');
}
