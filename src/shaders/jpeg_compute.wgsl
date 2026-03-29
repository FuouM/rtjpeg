// row0: quality, output width/height (compute target), source video width
// row1: source video height, chroma mode, glitch rate, ringing amp
// row2: color drift, frame count, smear amount, corrupt rate
// row3: datamosh amount, (unused), (unused), mosh reset flag
// row4: chroma bleed, bit crush, suppress temporal history, block echo
// row5.x: block echo before JPEG (1) vs after (0)
// row5.y: custom flow X (normalised -1..+1, right = positive)
// row5.z: custom flow Y (normalised -1..+1, down  = positive)
// row5.w: 1 = use custom flow, 0 = use LK-computed flow
struct Params {
  row0: vec4<f32>,
  row1: vec4<f32>,
  row2: vec4<f32>,
  row3: vec4<f32>,
  row4: vec4<f32>,
  row5: vec4<f32>,
  row6: vec4<f32>, // x: invert DCT, y: lock chroma table, z: huffman desync, w: huffman corrupt
  row7: vec4<f32>, // x: huffman shift
}

struct HuffmanEntry {
  code: u32,
  len: u32,
  val: u32,
}

struct HuffmanMetadata {
  bitOffset: u32,
  bitLength: u32,
}

@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var prevOutputTex: texture_2d<f32>;
@group(0) @binding(4) var prevInputTex: texture_2d<f32>;
@group(0) @binding(5) var<storage, read_write> encodedBitstream: array<u32>;
@group(0) @binding(6) var<storage, read_write> bitstreamMetadata: array<HuffmanMetadata>;
@group(0) @binding(7) var<storage, read> huffmanTables: array<u32>; // Pre-computed LUTs

struct BitWriter {
  byteOffset: u32,
  bitOffset: u32, // 0..7
  blockBase: u32, // starting word index in encodedBitstream
}

fn write_bit(w: ptr<function, BitWriter>, bit: u32) {
  let wordIdx = (*w).blockBase + (*w).byteOffset / 4u;
  let bitInWord = ((*w).byteOffset % 4u) * 8u + (*w).bitOffset;
  
  if (bit != 0u) {
    let mask = 1u << (31u - bitInWord);
    encodedBitstream[wordIdx] |= mask;
  }
  
  (*w).bitOffset++;
  if ((*w).bitOffset == 8u) {
    (*w).bitOffset = 0u;
    (*w).byteOffset++;
  }
}

fn write_bits(w: ptr<function, BitWriter>, val: u32, len: u32) {
  if (len == 0u) { return; }
  // OPTIMIZATION: Write bits in chunks where possible if len is small
  // For now, keep it simple but avoid the loop if len is 1
  if (len == 1u) {
    write_bit(w, val & 1u);
    return;
  }
  for (var i = 0u; i < len; i++) {
    let bit = (val >> (len - 1u - i)) & 1u;
    write_bit(w, bit);
  }
}

struct BitReader {
  byteOffset: u32,
  bitOffset: u32,
  blockBase: u32,
}

fn read_bit(r: ptr<function, BitReader>) -> u32 {
  let wordIdx = (*r).blockBase + (*r).byteOffset / 4u;
  let byteInWord = (*r).byteOffset % 4u;
  
  let word = encodedBitstream[wordIdx];
  // Match original buggy wrap-around for high bitOffsets: (31 - (byte*8 + bit)) % 32
  let bitPos = byteInWord * 8u + (*r).bitOffset;
  let bit = (word >> (31u - (bitPos % 32u))) & 1u;
  
  (*r).bitOffset++;
  if ((*r).bitOffset == 8u) {
    (*r).bitOffset = 0u;
    (*r).byteOffset++;
  }
  return bit;
}

// Optimized peek_bits: supports normal (across words) and buggy (wrap within word) modes in O(1)
fn peek_bits(r: ptr<function, BitReader>, len: u32) -> u32 {
  if (len == 0u) { return 0u; }
  
  let wordIdx0 = (*r).blockBase + (*r).byteOffset / 4u;
  let byteInWord = (*r).byteOffset % 4u;
  let bitInWord = byteInWord * 8u + (*r).bitOffset;

  // GLITCH MODE: Elevated bitOffset >= 8 - emulate first-word-looping-bug
  if ((*r).bitOffset >= 8u) {
    let startBit = bitInWord % 32u;
    let word = encodedBitstream[wordIdx0];
    if (startBit + len <= 32u) {
      return (word >> (32u - startBit - len)) & ((1u << len) - 1u);
    } else {
      let bitsFromEnd = 32u - startBit;
      let bitsFromStart = len - bitsFromEnd;
      let val = ((word & ((1u << bitsFromEnd) - 1u)) << bitsFromStart) | (word >> (32u - bitsFromStart));
      return val;
    }
  }
  
  // NORMAL MODE
  let word0 = encodedBitstream[wordIdx0];
  if (bitInWord + len <= 32u) {
    return (word0 >> (32u - bitInWord - len)) & ((1u << len) - 1u);
  }
  
  let word1 = encodedBitstream[wordIdx0 + 1u];
  let bitsFrom0 = 32u - bitInWord;
  let bitsFrom1 = len - bitsFrom0;
  let high = (word0 & ((1u << bitsFrom0) - 1u)) << bitsFrom1;
  let low = word1 >> (32u - bitsFrom1);
  return high | low;
}

fn skip_bits(r: ptr<function, BitReader>, len: u32) {
  if (len == 0u) { return; }
  
  // If bitOffset is elevated, handle the "never hit 8" bug logic
  if ((*r).bitOffset >= 8u) {
    (*r).bitOffset += len;
    // Note: bitOffset stays >= 8 forever unless it overflows u32 (unlikely in block)
    return;
  }
  
  let totalBits = (*r).bitOffset + len;
  (*r).byteOffset += totalBits / 8u;
  (*r).bitOffset = totalBits % 8u;
}

fn read_bits(r: ptr<function, BitReader>, len: u32) -> u32 {
  if (len == 0u) { return 0u; }
  let val = peek_bits(r, len);
  skip_bits(r, len);
  return val;
}

// Bits needed to represent a value (used for Category)
fn get_category(val: i32) -> u32 {
  var v = abs(val);
  if (v == 0) { return 0u; }
  return u32(firstLeadingBit(v)) + 1u;
}

// Map a value to JPEG Huffman bits
fn get_value_bits(val: i32, cat: u32) -> u32 {
  if (val >= 0) { return u32(val); }
  return u32(val + i32(1u << cat) - 1);
}

const ZigZag = array<u32, 64>(
  0u,  1u,  8u, 16u,  9u,  2u,  3u, 10u,
 17u, 24u, 32u, 25u, 18u, 11u,  4u,  5u,
 12u, 19u, 26u, 33u, 40u, 48u, 41u, 34u,
 27u, 20u, 13u,  6u,  7u, 14u, 21u, 28u,
 35u, 42u, 49u, 56u, 57u, 50u, 43u, 36u,
 29u, 22u, 15u, 23u, 30u, 37u, 44u, 51u,
 58u, 59u, 52u, 45u, 38u, 31u, 39u, 46u,
 53u, 60u, 61u, 54u, 47u, 55u, 62u, 63u
);


// Standard JPEG Huffman Tables (simplified for implementation)
// In a full implementation, these would be provided via huffmanTables buffer
// For now, we'll use a subset to demonstrate the logic, then expand.
// [Code, Length] pairs
struct CodeEntry {
  code: u32,
  len: u32,
}

fn get_dc_code(is_chroma: bool, cat: u32) -> CodeEntry {
  let base = select(0u, 12u, is_chroma);
  let val = huffmanTables[base + cat];
  return CodeEntry(val >> 16u, val & 0xFFFFu);
}

// AC tables start at index 24 for Luma, 280 for Chroma
fn get_ac_code(is_chroma: bool, run: u32, cat: u32) -> CodeEntry {
  let rs = (run << 4u) | cat;
  let base = select(24u, 280u, is_chroma);
  let val = huffmanTables[base + rs];
  return CodeEntry(val >> 16u, val & 0xFFFFu);
}

fn encode_block(
  w: ptr<function, BitWriter>,
  coeffs: ptr<function, array<f32, 64>>,
  is_chroma: bool,
  prev_dc: ptr<function, i32>
) {
  let dc_val = i32((*coeffs)[0]);
  let diff = dc_val - (*prev_dc);
  *prev_dc = dc_val;
  
  let cat = get_category(diff);
  let dc_code = get_dc_code(is_chroma, cat);
  write_bits(w, dc_code.code, dc_code.len);
  write_bits(w, get_value_bits(diff, cat), cat);
  
  var run = 0u;
  for (var i = 1u; i < 64u; i++) {
    let ac = i32((*coeffs)[i]);
    if (ac == 0) {
      run++;
    } else {
      while (run >= 16u) {
        let zrl = get_ac_code(is_chroma, 15u, 0u);
        write_bits(w, zrl.code, zrl.len);
        run -= 16u;
      }
      let ac_cat = get_category(ac);
      let ac_code = get_ac_code(is_chroma, run, ac_cat);
      write_bits(w, ac_code.code, ac_code.len);
      write_bits(w, get_value_bits(ac, ac_cat), ac_cat);
      run = 0u;
    }
  }
  if (run > 0u) {
    let eob = get_ac_code(is_chroma, 0u, 0u);
    write_bits(w, eob.code, eob.len);
  }
}

// Decode a single symbol from the bitstream using the provided table
// Decode a single symbol from the bitstream using optimized 16-bit LUT
fn decode_symbol(r: ptr<function, BitReader>, is_chroma: bool, is_ac: bool) -> u32 {
  // Peek 16 bits for LUT (all JPEG codewords are max 16 bits)
  let peek16 = peek_bits(r, 16u);
  
  // Base offsets for 16-bit decoding LUTs (65536 entries each):
  // Luma DC: 536, Chroma DC: 66072, Luma AC: 131608, Chroma AC: 197144
  var base = 536u;
  if (is_chroma) { base += 65536u; }
  if (is_ac) { base += 131072u; }
  
  let entry = huffmanTables[base + peek16];
  let len = entry >> 8u;
  let symbol = entry & 0xFFu;
  
  // If valid codeword (len <= 16)
  if (len <= 16u) {
    skip_bits(r, len);
    return symbol;
  }
  
  // If invalid code/garbage (can happen in corruption), advance 1 bit to stay glitchy
  read_bit(r);
  return 0u;
}

fn decode_value(r: ptr<function, BitReader>, cat: u32) -> i32 {
  if (cat == 0u) { return 0; }
  let bits = read_bits(r, cat);
  let threshold = 1u << (cat - 1u);
  if (bits < threshold) {
    return i32(bits) - i32((1u << cat) - 1u);
  }
  return i32(bits);
}

fn decode_block(
  r: ptr<function, BitReader>,
  coeffs: ptr<function, array<f32, 64>>,
  is_chroma: bool,
  prev_dc: ptr<function, i32>
) {
  // Clear block
  for (var i = 0u; i < 64u; i++) { (*coeffs)[i] = 0.0; }
  
  // DC
  let cat = decode_symbol(r, is_chroma, false);
  let diff = decode_value(r, cat);
  let dc_val = (*prev_dc) + diff;
  (*coeffs)[0] = f32(dc_val);
  *prev_dc = dc_val;
  
  // AC
  var i = 1u;
  while (i < 64u) {
    let rs = decode_symbol(r, is_chroma, true);
    let run = rs >> 4u;
    let ac_cat = rs & 0xFu;
    
    if (ac_cat == 0u) {
      if (run == 15u) { i += 16u; } // ZRL
      else { break; } // EOB
    } else {
      i += run;
      if (i < 64u) {
        (*coeffs)[ZigZag[i]] = f32(decode_value(r, ac_cat));
        i++;
      }
    }
  }
}

// -----------------------------------------------------------------------
// 16×16 workgroup shared memory
var<workgroup> blockY:  array<array<f32, 16>, 16>;
var<workgroup> blockCb: array<array<f32, 16>, 16>;
var<workgroup> blockCr: array<array<f32, 16>, 16>;

var<workgroup> dctY:  array<array<f32, 16>, 16>;
var<workgroup> dctCb: array<array<f32, 16>, 16>;
var<workgroup> dctCr: array<array<f32, 16>, 16>;

// 8-entry cosine LUT for DCT-II/III (N=8).
// cosLUT[k] = cos(k * PI / 16)  for k in 0..7
// Populated once per dispatch by the first 8 threads of row 0.
var<workgroup> cosLUT: array<f32, 8>;

// Lucas-Kanade optical flow accumulators — only written/read when datamoshAmt > 0.
var<workgroup> lk_A: array<f32, 256>;
var<workgroup> lk_B: array<f32, 256>;
var<workgroup> lk_C: array<f32, 256>;
var<workgroup> lk_D: array<f32, 256>;
var<workgroup> lk_E: array<f32, 256>;
var<workgroup> block_mv: vec2<f32>;

const Q_Luma = array<f32, 64>(
  16., 11., 10., 16., 24., 40., 51., 61.,
  12., 12., 14., 19., 26., 58., 60., 55.,
  14., 13., 16., 24., 40., 57., 69., 56.,
  14., 17., 22., 29., 51., 87., 80., 62.,
  18., 22., 37., 56., 68.,109.,103., 77.,
  24., 35., 55., 64., 81.,104.,113., 92.,
  49., 64., 78., 87.,103.,121.,120.,101.,
  72., 92., 95., 98.,112.,100.,103., 99.
);

const Q_Chroma = array<f32, 64>(
  17., 18., 24., 47., 99., 99., 99., 99.,
  18., 21., 26., 66., 99., 99., 99., 99.,
  24., 26., 56., 99., 99., 99., 99., 99.,
  47., 66., 99., 99., 99., 99., 99., 99.,
  99., 99., 99., 99., 99., 99., 99., 99.,
  99., 99., 99., 99., 99., 99., 99., 99.,
  99., 99., 99., 99., 99., 99., 99., 99.,
  99., 99., 99., 99., 99., 99., 99., 99.
);

fn rgb2ycbcr(rgb: vec3<f32>) -> vec3<f32> {
  let y  =  0.299    * rgb.r + 0.587    * rgb.g + 0.114    * rgb.b;
  let cb = 128.0/255.0 - 0.168736 * rgb.r - 0.331264 * rgb.g + 0.5      * rgb.b;
  let cr = 128.0/255.0 + 0.5      * rgb.r - 0.418688 * rgb.g - 0.081312 * rgb.b;
  return vec3<f32>(y, cb, cr);
}

fn ycbcr2rgb_drift(ycbcr: vec3<f32>, drift: f32) -> vec3<f32> {
  let y  = ycbcr.x;
  let cb = ycbcr.y - 128.0/255.0;
  let cr = ycbcr.z - 128.0/255.0;

  // BT.601
  let r1 = y + 1.402    * cr;
  let g1 = y - 0.344136 * cb - 0.714136 * cr;
  let b1 = y + 1.772    * cb;

  // BT.709 drift
  let r2 = y + 1.5748  * cr;
  let g2 = y - 0.1873  * cb - 0.4681  * cr;
  let b2 = y + 1.8556  * cb;

  return select(vec3<f32>(r1, g1, b1), vec3<f32>(r2, g2, b2), drift > 0.5);
}

fn load_external_clamped(tex: texture_2d<f32>, src_px: vec2<u32>, src_dims: vec2<u32>) -> vec3<f32> {
  let cx = min(src_px.x, select(src_dims.x - 1u, 0u, src_dims.x == 0u));
  let cy = min(src_px.y, select(src_dims.y - 1u, 0u, src_dims.y == 0u));
  return textureLoad(tex, vec2<i32>(i32(cx), i32(cy)), 0).rgb;
}

fn out_px_to_src_px(out_px: vec2<u32>, src_dims: vec2<u32>, out_dims: vec2<u32>) -> vec2<u32> {
  if (out_dims.x == 0u || out_dims.y == 0u) { return vec2<u32>(0u, 0u); }
  let sx = u32((f32(out_px.x) + 0.5) * f32(src_dims.x) / f32(out_dims.x));
  let sy = u32((f32(out_px.y) + 0.5) * f32(src_dims.y) / f32(out_dims.y));
  return vec2<u32>(
    min(sx, select(src_dims.x - 1u, 0u, src_dims.x == 0u)),
    min(sy, select(src_dims.y - 1u, 0u, src_dims.y == 0u))
  );
}

fn load_video_at_output_px(tex: texture_2d<f32>, out_px: vec2<u32>, src_dims: vec2<u32>, out_dims: vec2<u32>) -> vec3<f32> {
  return load_external_clamped(tex, out_px_to_src_px(out_px, src_dims, out_dims), src_dims);
}

fn hash3(p3: vec3<u32>) -> f32 {
    var p = p3 * vec3<u32>(1664525u, 2125134261u, 1481546257u) + 1013904223u;
    p.x += p.y * p.z; p.y += p.z * p.x; p.z += p.x * p.y;
    p ^= p >> vec3<u32>(16u);
    p.x += p.y * p.z; p.y += p.z * p.x; p.z += p.x * p.y;
    return f32(p.x) / 4294967295.0;
}

// Per-16×16-block stochastic blend with previous output (same coords as `ghost_px`).
fn block_echo_blend(
  cur: vec3<f32>,
  ghost_px: vec2<u32>,
  out_dims: vec2<u32>,
  amt: f32,
  gid: vec3<u32>
) -> vec3<f32> {
  if (amt <= 0.0 || params.row4.z > 0.5) { return cur; }
  let echoBlockHash = hash3(vec3<u32>(gid.x, gid.y, 444u + u32(params.row2.y)));
  if (echoBlockHash < amt) {
    let gx = min(ghost_px.x, select(out_dims.x - 1u, 0u, out_dims.x == 0u));
    let gy = min(ghost_px.y, select(out_dims.y - 1u, 0u, out_dims.y == 0u));
    let prevSample = textureLoad(prevOutputTex, vec2<i32>(i32(gx), i32(gy)), 0).rgb;
    return mix(cur, prevSample, min(amt * 0.85, 0.92));
  }
  return cur;
}

// Evaluate cos((2i+1)*u*PI/16) using the workgroup LUT.
// Period = 32 integer steps; cos is symmetric so we only store half.
fn dct_cos(i: u32, u: u32) -> f32 {
  let k = (2u * i + 1u) * u % 32u;
  if (k < 8u)  { return  cosLUT[k]; }
  if (k < 16u) { return -cosLUT[16u - k]; }
  if (k < 24u) { return -cosLUT[k - 16u]; }
                 return  cosLUT[32u - k];
}

const PI = 3.14159265359;

@compute @workgroup_size(16, 16, 1)
fn compute_main(
  @builtin(global_invocation_id) global_id: vec3<u32>,
  @builtin(local_invocation_id)  local_id:  vec3<u32>,
  @builtin(workgroup_id)         group_id:  vec3<u32>
) {
  let out_dims = vec2<u32>(u32(params.row0.y), u32(params.row0.z));
  let src_dims = vec2<u32>(u32(params.row0.w), u32(params.row1.x));
  let x = local_id.x;
  let y = local_id.y;
  let cMode = u32(params.row1.y);

  // New effect params (row4)
  let chromaBleedAmt = params.row4.x;  // 0..1 → pixel offset up to ~30px
  let bitCrushAmt    = params.row4.y;  // 0..1 → crush depth
  let suppressTemporalHistory = params.row4.z > 0.5;
  let blockEchoAmt   = params.row4.w;  // 0..1 → echo blend strength
  let echoBeforeJpeg = params.row5.x > 0.5;

  // -----------------------------------------------------------------------
  // Phase 0: populate cosine LUT (8 threads, one entry each).
  // -----------------------------------------------------------------------
  if (y == 0u && x < 8u) {
    cosLUT[x] = cos(f32(x) * PI / 16.0);
  }

  // -----------------------------------------------------------------------
  // Phase 1: Lucas-Kanade spatial/temporal derivatives (datamosh only).
  // datamoshAmt is uniform → all threads take the same branch → valid for barriers.
  // -----------------------------------------------------------------------
  let datamoshAmt = select(params.row3.x, 0.0, suppressTemporalHistory);
  let tid = y * 16u + x;

  if (datamoshAmt > 0.0) {
    let out_px = global_id.xy;
    let px   = out_px_to_src_px(out_px, src_dims, out_dims);
    let px_R = out_px_to_src_px(vec2<u32>(out_px.x + 1u, out_px.y), src_dims, out_dims);
    let px_D = out_px_to_src_px(vec2<u32>(out_px.x, out_px.y + 1u), src_dims, out_dims);

    let curr_Y = rgb2ycbcr(load_external_clamped(inputTex, px,   src_dims)).x;
    let curr_R = rgb2ycbcr(load_external_clamped(inputTex, px_R, src_dims)).x;
    let curr_D = rgb2ycbcr(load_external_clamped(inputTex, px_D, src_dims)).x;
    let prev_Y = rgb2ycbcr(textureLoad(prevInputTex, vec2<i32>(px), 0).rgb).x;

    let Ix = curr_R - curr_Y;
    let Iy = curr_D - curr_Y;
    let It = curr_Y - prev_Y;

    lk_A[tid] = Ix * Ix;
    lk_B[tid] = Ix * Iy;
    lk_C[tid] = Iy * Iy;
    lk_D[tid] = -Ix * It;
    lk_E[tid] = -Iy * It;
  }

  // Guard barrier — only pay it when LK arrays were actually written.
  if (datamoshAmt > 0.0) { workgroupBarrier(); }

  // Phase 2: LK reduction + solve (thread 0 only).
  let useCustomFlow = params.row5.w > 0.5;
  if (datamoshAmt > 0.0 && tid == 0u) {
    if (useCustomFlow) {
      // Custom flow override: map normalised (−1…+1) to pixel displacement.
      // Reduced strength: 24 pixels max displacement per frame.
      block_mv = vec2<f32>(
        params.row5.y * 24.0,
        params.row5.z * 24.0,
      );
    } else {
      var sumA = 0.0; var sumB = 0.0; var sumC = 0.0;
      var sumD = 0.0; var sumE = 0.0;
      for (var i = 0u; i < 256u; i++) {
        sumA += lk_A[i]; sumB += lk_B[i]; sumC += lk_C[i];
        sumD += lk_D[i]; sumE += lk_E[i];
      }
      let det = sumA * sumC - sumB * sumB;
      if (det > 0.0001) {
        let u = (sumD * sumC - sumB * sumE) / det;
        let v = (sumA * sumE - sumD * sumB) / det;
        block_mv = vec2<f32>(u * 6.0, v * 6.0);
      } else {
        block_mv = vec2<f32>(0.0, 0.0);
      }
    }
  }

  // Guard barrier — only pay it when block_mv was written.
  if (datamoshAmt > 0.0) { workgroupBarrier(); }

  // -----------------------------------------------------------------------
  // Phase 3: Compute mosh offset from flow and/or smear.
  // -----------------------------------------------------------------------
  let smearAmt = select(params.row2.z, 0.0, suppressTemporalHistory);
  var mosh_offset = vec2<i32>(0, 0);
  var is_moshing  = false;

  // Horn-Schunck-style smear (one-sample-per-block approximation).
  if (smearAmt > 0.0) {
    let tl = vec2<u32>(group_id.x * 16u, group_id.y * 16u);
    let tC = out_px_to_src_px(tl, src_dims, out_dims);
    let tR = out_px_to_src_px(vec2<u32>(tl.x + 1u, tl.y), src_dims, out_dims);
    let tD = out_px_to_src_px(vec2<u32>(tl.x, tl.y + 1u), src_dims, out_dims);

    let tIx    = rgb2ycbcr(load_external_clamped(inputTex, tR, src_dims)).x
               - rgb2ycbcr(load_external_clamped(inputTex, tC, src_dims)).x;
    let tIy    = rgb2ycbcr(load_external_clamped(inputTex, tD, src_dims)).x
               - rgb2ycbcr(load_external_clamped(inputTex, tC, src_dims)).x;
    let tIt    = rgb2ycbcr(load_external_clamped(inputTex, tC, src_dims)).x
               - rgb2ycbcr(textureLoad(prevOutputTex, vec2<i32>(tl), 0).rgb).x;
    let tDenom = tIx * tIx + tIy * tIy + 0.01;

    if (smearAmt > 0.05 && abs(tIt) > (1.0 - smearAmt) * 0.5) {
      mosh_offset += vec2<i32>(i32(-tIt * tIx / tDenom * 32.0),
                               i32(-tIt * tIy / tDenom * 32.0));
      is_moshing = true;
    }
  }

  // Lucas-Kanade datamosh (per-block randomised acceptance).
  // When custom flow is active, all blocks mosh (hash bypass).
  if (datamoshAmt > 0.0) {
    let dmHash = hash3(vec3<u32>(group_id.x, group_id.y, u32(params.row2.y)));
    if (dmHash < datamoshAmt) {
      mosh_offset += vec2<i32>(i32(block_mv.x), i32(block_mv.y));
      is_moshing = true;
    }
  }

  // -----------------------------------------------------------------------
  // 1. Fetch luma pixel (with optional mosh displacement).
  // -----------------------------------------------------------------------
  let luma_px = vec2<u32>(
    u32(clamp(i32(global_id.x) - mosh_offset.x, 0i, i32(out_dims.x) - 1i)),
    u32(max(0, i32(global_id.y) - mosh_offset.y))
  );

  let resetMosh = params.row3.w > 0.5;
  var rgb = load_video_at_output_px(inputTex, luma_px, src_dims, out_dims);
  if (is_moshing && !resetMosh) {
    rgb = textureLoad(prevOutputTex, vec2<i32>(luma_px), 0).rgb;
  }
  if (blockEchoAmt > 0.0 && echoBeforeJpeg) {
    rgb = block_echo_blend(rgb, global_id.xy, out_dims, blockEchoAmt, group_id);
  }

  let ycbcr = rgb2ycbcr(rgb);
  blockY[y][x] = ycbcr.x * 255.0 - 128.0;

  // -----------------------------------------------------------------------
  // 2. Chroma — sampled from prevOutputTex only when actively moshing.
  //    Chroma Bleed: Cb shifted +bleedPx, Cr shifted -bleedPx in X.
  // -----------------------------------------------------------------------
  let bleedPx = i32(chromaBleedAmt * 30.0);  // 0..30 pixels max offset

  if (cMode == 0u) {
    // 4:4:4 — full chroma per pixel, with optional bleed
    let cbPx = vec2<u32>(
      u32(clamp(i32(global_id.x) + bleedPx, 0i, i32(out_dims.x) - 1i)),
      u32(max(0i, i32(global_id.y) - mosh_offset.y))
    );
    let crPx = vec2<u32>(
      u32(clamp(i32(global_id.x) - bleedPx, 0i, i32(out_dims.x) - 1i)),
      u32(max(0i, i32(global_id.y) - mosh_offset.y))
    );
    var cb_rgb = load_video_at_output_px(inputTex, cbPx, src_dims, out_dims);
    var cr_rgb = load_video_at_output_px(inputTex, crPx, src_dims, out_dims);
    if (is_moshing && !resetMosh) {
      cb_rgb = textureLoad(prevOutputTex, vec2<i32>(cbPx), 0).rgb;
      cr_rgb = textureLoad(prevOutputTex, vec2<i32>(crPx), 0).rgb;
    }
    if (blockEchoAmt > 0.0 && echoBeforeJpeg) {
      let gpx = global_id.xy;
      cb_rgb = block_echo_blend(cb_rgb, gpx, out_dims, blockEchoAmt, group_id);
      cr_rgb = block_echo_blend(cr_rgb, gpx, out_dims, blockEchoAmt, group_id);
    }
    let cb_ycc = rgb2ycbcr(cb_rgb);
    let cr_ycc = rgb2ycbcr(cr_rgb);
    blockCb[y][x] = cb_ycc.y * 255.0 - 128.0;
    blockCr[y][x] = cr_ycc.z * 255.0 - 128.0;

  } else if (cMode == 1u) {
    // 4:2:2 — subsample horizontally, with optional bleed
    if (x < 8u) {
      let ux = x * 2u;
      var sumCb = 0.0; var sumCr = 0.0;
      for (var dx = 0u; dx < 2u; dx++) {
        let base_x = i32(group_id.x * 16u + ux + dx) - mosh_offset.x;
        let cbX = clamp(base_x + bleedPx, 0i, i32(out_dims.x) - 1i);
        let crX = clamp(base_x - bleedPx, 0i, i32(out_dims.x) - 1i);
        let base_y = max(0i, i32(group_id.y * 16u + y) - mosh_offset.y);
        let cbPx2 = vec2<u32>(u32(cbX), u32(base_y));
        let crPx2 = vec2<u32>(u32(crX), u32(base_y));
        var cb_rgb = load_video_at_output_px(inputTex, cbPx2, src_dims, out_dims);
        var cr_rgb = load_video_at_output_px(inputTex, crPx2, src_dims, out_dims);
        if (is_moshing && !resetMosh) {
          cb_rgb = textureLoad(prevOutputTex, vec2<i32>(cbPx2), 0).rgb;
          cr_rgb = textureLoad(prevOutputTex, vec2<i32>(crPx2), 0).rgb;
        }
        if (blockEchoAmt > 0.0 && echoBeforeJpeg) {
          let gpx = vec2<u32>(group_id.x * 16u + ux + dx, group_id.y * 16u + y);
          cb_rgb = block_echo_blend(cb_rgb, gpx, out_dims, blockEchoAmt, group_id);
          cr_rgb = block_echo_blend(cr_rgb, gpx, out_dims, blockEchoAmt, group_id);
        }
        let cb_ycc = rgb2ycbcr(cb_rgb);
        let cr_ycc = rgb2ycbcr(cr_rgb);
        sumCb += cb_ycc.y * 255.0 - 128.0;
        sumCr += cr_ycc.z * 255.0 - 128.0;
      }
      blockCb[y][x] = sumCb * 0.5;
      blockCr[y][x] = sumCr * 0.5;
    }

  } else if (cMode == 2u) {
    // 4:2:0 — subsample both axes, with optional bleed
    if (x < 8u && y < 8u) {
      let ux = x * 2u; let uy = y * 2u;
      var sumCb = 0.0; var sumCr = 0.0;
      for (var dy = 0u; dy < 2u; dy++) {
        for (var dx = 0u; dx < 2u; dx++) {
          let base_x = i32(group_id.x * 16u + ux + dx) - mosh_offset.x;
          let cbX = clamp(base_x + bleedPx, 0i, i32(out_dims.x) - 1i);
          let crX = clamp(base_x - bleedPx, 0i, i32(out_dims.x) - 1i);
          let base_y = max(0i, i32(group_id.y * 16u + uy + dy) - mosh_offset.y);
          let cbPx2 = vec2<u32>(u32(cbX), u32(base_y));
          let crPx2 = vec2<u32>(u32(crX), u32(base_y));
          var cb_rgb = load_video_at_output_px(inputTex, cbPx2, src_dims, out_dims);
          var cr_rgb = load_video_at_output_px(inputTex, crPx2, src_dims, out_dims);
          if (is_moshing && !resetMosh) {
            cb_rgb = textureLoad(prevOutputTex, vec2<i32>(cbPx2), 0).rgb;
            cr_rgb = textureLoad(prevOutputTex, vec2<i32>(crPx2), 0).rgb;
          }
          if (blockEchoAmt > 0.0 && echoBeforeJpeg) {
            let gpx = vec2<u32>(group_id.x * 16u + ux + dx, group_id.y * 16u + uy + dy);
            cb_rgb = block_echo_blend(cb_rgb, gpx, out_dims, blockEchoAmt, group_id);
            cr_rgb = block_echo_blend(cr_rgb, gpx, out_dims, blockEchoAmt, group_id);
          }
          let cb_ycc = rgb2ycbcr(cb_rgb);
          let cr_ycc = rgb2ycbcr(cr_rgb);
          sumCb += cb_ycc.y * 255.0 - 128.0;
          sumCr += cr_ycc.z * 255.0 - 128.0;
        }
      }
      blockCb[y][x] = sumCb * 0.25;
      blockCr[y][x] = sumCr * 0.25;
    }

  } else {
    // Grayscale
    blockCb[y][x] = 0.0;
    blockCr[y][x] = 0.0;
  }

  // Synchronise: cosLUT + all block arrays must be visible to all threads.
  workgroupBarrier();

  // -----------------------------------------------------------------------
  // Precompute per-thread cosine tables to reduce dct_cos() call count
  // from 64 → 16 for each forward/inverse DCT.
  //
  //   fwd_cos[k]    = dct_cos(k, ox)  — forward DCT column cosines
  //   inv_cos_ox[k] = dct_cos(ox, k)  — inverse DCT column cosines (luma/4:4:4)
  //   a_norm[k]     = DC normalisation factor (0.707… for k==0, else 1.0)
  // -----------------------------------------------------------------------
  let qx = x / 8u; let qy = y / 8u;
  let ox = x % 8u; let oy = y % 8u;

  var fwd_cos:    array<f32, 8>;
  var inv_cos_ox: array<f32, 8>;
  var a_norm:     array<f32, 8>;
  for (var k = 0u; k < 8u; k++) {
    fwd_cos[k]    = dct_cos(k, ox);
    inv_cos_ox[k] = dct_cos(ox, k);
    a_norm[k]     = select(1.0, 0.70710678118, k == 0u);
  }

  // -----------------------------------------------------------------------
  // Quantisation scale (JPEG quality mapping).
  // -----------------------------------------------------------------------
  var scale = max(0.0001, 200.0 - 2.0 * params.row0.x);
  if (params.row0.x < 50.0)   { scale = 5000.0 / max(1.0, params.row0.x); }
  if (params.row0.x == 100.0) { scale = 0.0001; }

  let au = a_norm[ox];
  let av = a_norm[oy];

  // -----------------------------------------------------------------------
  // 3a. Forward DCT + quantise — luma
  // Hoisted: fwd_cos[i] pulled out of the j-loop (was computed 64× now 16×).
  // -----------------------------------------------------------------------
  var sumY = 0.0;
  for (var j = 0u; j < 8u; j++) {
    let cv  = dct_cos(j, oy);
    let row = qy * 8u + j;
    for (var i = 0u; i < 8u; i++) {
      sumY += blockY[row][qx * 8u + i] * (fwd_cos[i] * cv);
    }
  }
  let lumaIdx = oy * 8u + ox;
  let qL = max(1.0, floor((Q_Luma[lumaIdx] * scale + 50.0) / 100.0));
  var coeffY = round((0.25 * au * av * sumY) / qL) * qL;
  if (params.row6.x > 0.5 && (ox != 0u || oy != 0u)) { coeffY = -coeffY; }
  dctY[y][x] = coeffY;

  // -----------------------------------------------------------------------
  // 3b. Forward DCT + quantise — chroma (shares fwd_cos with luma).
  // -----------------------------------------------------------------------
  let validChroma = (cMode == 0u)
                 || (cMode == 1u && x < 8u)
                 || (cMode == 2u && x < 8u && y < 8u);
  if (validChroma) {
    var sumCb_d = 0.0; var sumCr_d = 0.0;
    for (var j = 0u; j < 8u; j++) {
      let cv  = dct_cos(j, oy);
      let row = qy * 8u + j;
      for (var i = 0u; i < 8u; i++) {
        let w = fwd_cos[i] * cv;
        sumCb_d += blockCb[row][qx * 8u + i] * w;
        sumCr_d += blockCr[row][qx * 8u + i] * w;
      }
    }
    let chromaIdx = oy * 8u + ox;
    let baseQC = Q_Chroma[chromaIdx];
    let lockAmt = params.row6.y;
    let blockHashC = hash3(vec3<u32>(group_id.x, group_id.y, u32(params.row2.y) + 777u));
    let lockedQC = blockHashC * blockHashC * 200.0 + 10.0;
    let effectiveQC = mix(baseQC, lockedQC, lockAmt);
    let qC = max(1.0, floor((effectiveQC * scale + 50.0) / 100.0));
    var coeffCb = round((0.25 * au * av * sumCb_d) / qC) * qC;
    var coeffCr = round((0.25 * au * av * sumCr_d) / qC) * qC;
    if (params.row6.x > 0.5 && (ox != 0u || oy != 0u)) {
      coeffCb = -coeffCb;
      coeffCr = -coeffCr;
    }
    dctCb[y][x] = coeffCb;
    dctCr[y][x] = coeffCr;
  } else {
    dctCb[y][x] = 0.0;
    dctCr[y][x] = 0.0;
  }

  workgroupBarrier();

  // -----------------------------------------------------------------------
  // Huffman Stage (Accurate Glitch Effect)
  // -----------------------------------------------------------------------
  let hDesync = params.row6.z;
  let hCorrupt = params.row6.w;
  let hShift = params.row7.x;
  if (hDesync > 0.0 || hCorrupt > 0.0 || hShift > 0.0) {
    let blockIdxInGroup = qy * 2u + qx;
    let tidInSubgroup = oy * 8u + ox;
    
    let totalGroupsX = (u32(params.row0.y) + 15u) / 16u;
    let globalWorkgroupId = group_id.y * totalGroupsX + group_id.x;
    let globalBlockIdx = globalWorkgroupId * 4u + blockIdxInGroup;
    let totalBlocks = (u32(params.row0.y) / 8u) * (u32(params.row0.z) / 8u);
    
    // 1. Parallel Bitstream Initialization (Threads 0-63 of subgroup)
    let blockBaseIdx = globalBlockIdx * 256u;
    let cbBlockBaseIdx = (globalBlockIdx + totalBlocks) * 256u;
    let crBlockBaseIdx = (globalBlockIdx + 2u * totalBlocks) * 256u;
    
    for (var w = tidInSubgroup; w < 256u; w += 64u) {
      encodedBitstream[blockBaseIdx + w] = 0u;
      if (cMode < 3u) {
        encodedBitstream[cbBlockBaseIdx + w] = 0u;
        encodedBitstream[crBlockBaseIdx + w] = 0u;
      }
    }
    
    workgroupBarrier(); // Wait for clearing to finish

    // 2. Encode Stage (Thread 0 only)
    if (tidInSubgroup == 0u) {
      var coeffs: array<f32, 64>;
      for (var i = 0u; i < 64u; i++) {
        let lx = ZigZag[i] % 8u; let ly = ZigZag[i] / 8u;
        coeffs[i] = dctY[qy * 8u + ly][qx * 8u + lx];
      }
      
      var writer: BitWriter;
      writer.byteOffset = 0u; writer.bitOffset = 0u;
      writer.blockBase = blockBaseIdx;
      
      var prev_dc = 0;
      encode_block(&writer, &coeffs, false, &prev_dc);
      bitstreamMetadata[globalBlockIdx].bitOffset = blockBaseIdx * 32u;
      bitstreamMetadata[globalBlockIdx].bitLength = writer.byteOffset * 8u + writer.bitOffset;
      
      if (cMode < 3u) {
        // Cb
        for (var i = 0u; i < 64u; i++) {
          let lx = ZigZag[i] % 8u; let ly = ZigZag[i] / 8u;
          coeffs[i] = dctCb[qy * 8u + ly][qx * 8u + lx];
        }
        var cb_writer: BitWriter;
        cb_writer.byteOffset = 0u; cb_writer.bitOffset = 0u;
        cb_writer.blockBase = cbBlockBaseIdx;
        var cb_prev_dc = 0;
        encode_block(&cb_writer, &coeffs, true, &cb_prev_dc);
        bitstreamMetadata[globalBlockIdx + totalBlocks].bitOffset = cbBlockBaseIdx * 32u;
        bitstreamMetadata[globalBlockIdx + totalBlocks].bitLength = cb_writer.byteOffset * 8u + cb_writer.bitOffset;

        // Cr
        for (var i = 0u; i < 64u; i++) {
          let lx = ZigZag[i] % 8u; let ly = ZigZag[i] / 8u;
          coeffs[i] = dctCr[qy * 8u + ly][qx * 8u + lx];
        }
        var cr_writer: BitWriter;
        cr_writer.byteOffset = 0u; cr_writer.bitOffset = 0u;
        cr_writer.blockBase = crBlockBaseIdx;
        var cr_prev_dc = 0;
        encode_block(&cr_writer, &coeffs, true, &cr_prev_dc);
        bitstreamMetadata[globalBlockIdx + 2u * totalBlocks].bitOffset = crBlockBaseIdx * 32u;
        bitstreamMetadata[globalBlockIdx + 2u * totalBlocks].bitLength = cr_writer.byteOffset * 8u + cr_writer.bitOffset;
      }
    }
    
    workgroupBarrier(); // Wait for encoding to finish

    // 3. Parallel Corruption and Shift Stage (All threads)
    if (hCorrupt > 0.0 || hShift > 0.0) {
      // Each block has 256 words; with 64 threads, each thread handles 4 words
      for (var w = tidInSubgroup; w < 256u; w += 64u) {
        // Shift and Corrupt Y
        if (hShift > 0.0) {
          let seedShiftY = hash3(vec3<u32>(globalBlockIdx, w, 444u + u32(params.row2.y)));
          if (seedShiftY < hShift) {
            encodedBitstream[blockBaseIdx + w] = encodedBitstream[blockBaseIdx + w] << 1u;
          }
        }
        if (hCorrupt > 0.0) {
          let seedY = hash3(vec3<u32>(globalBlockIdx, w, u32(params.row2.y)));
          if (seedY < hCorrupt) {
            encodedBitstream[blockBaseIdx + w] ^= (1u << u32(seedY * 32.0));
          }
        }
        
        // Corrupt Chroma
        if (cMode < 3u) {
          if (hShift > 0.0) {
            let seedShiftCb = hash3(vec3<u32>(globalBlockIdx + totalBlocks, w, 444u + u32(params.row2.y)));
            if (seedShiftCb < hShift) {
              encodedBitstream[cbBlockBaseIdx + w] = encodedBitstream[cbBlockBaseIdx + w] << 1u;
            }
          }
          if (hCorrupt > 0.0) {
            let seedCb = hash3(vec3<u32>(globalBlockIdx + totalBlocks, w, u32(params.row2.y)));
            if (seedCb < hCorrupt) {
              encodedBitstream[cbBlockBaseIdx + w] ^= (1u << u32(seedCb * 32.0));
            }
          }
          
          if (hShift > 0.0) {
            let seedShiftCr = hash3(vec3<u32>(globalBlockIdx + 2u * totalBlocks, w, 444u + u32(params.row2.y)));
            if (seedShiftCr < hShift) {
              encodedBitstream[crBlockBaseIdx + w] = encodedBitstream[crBlockBaseIdx + w] << 1u;
            }
          }
          if (hCorrupt > 0.0) {
            let seedCr = hash3(vec3<u32>(globalBlockIdx + 2u * totalBlocks, w, u32(params.row2.y)));
            if (seedCr < hCorrupt) {
              encodedBitstream[crBlockBaseIdx + w] ^= (1u << u32(seedCr * 32.0));
            }
          }
        }
      }
    }

    workgroupBarrier(); // Wait for corruption to finish

    // 4. Decode Stage (Thread 0 only)
    if (tidInSubgroup == 0u) {
      var reader: BitReader;
      reader.byteOffset = 0u;
      reader.bitOffset = u32(hDesync * 64.0);
      reader.blockBase = blockBaseIdx;
      
      var dec_coeffs: array<f32, 64>;
      var prev_dc = 0;
      decode_block(&reader, &dec_coeffs, false, &prev_dc);
      for (var i = 0u; i < 64u; i++) {
        let lx = ZigZag[i] % 8u; let ly = ZigZag[i] / 8u;
        dctY[qy * 8u + ly][qx * 8u + lx] = dec_coeffs[i];
      }
      
      if (cMode < 3u) {
        let validChromaForBlock = (cMode == 0u)
                               || (cMode == 1u && (blockIdxInGroup == 0u || blockIdxInGroup == 2u))
                               || (cMode == 2u && (blockIdxInGroup == 0u));
        if (validChromaForBlock) {
          // Cb
          reader.blockBase = cbBlockBaseIdx;
          reader.byteOffset = 0u;
          reader.bitOffset = u32(hDesync * 64.0);
          var cb_prev_dc = 0;
          decode_block(&reader, &dec_coeffs, true, &cb_prev_dc);
          for (var i = 0u; i < 64u; i++) {
            let lx = ZigZag[i] % 8u; let ly = ZigZag[i] / 8u;
            dctCb[qy * 8u + ly][qx * 8u + lx] = dec_coeffs[i];
          }
          
          // Cr
          reader.blockBase = crBlockBaseIdx;
          reader.byteOffset = 0u;
          reader.bitOffset = u32(hDesync * 64.0);
          var cr_prev_dc = 0;
          decode_block(&reader, &dec_coeffs, true, &cr_prev_dc);
          for (var i = 0u; i < 64u; i++) {
            let lx = ZigZag[i] % 8u; let ly = ZigZag[i] / 8u;
            dctCr[qy * 8u + ly][qx * 8u + lx] = dec_coeffs[i];
          }
        }
      }
    }
    workgroupBarrier();
  }

  // -----------------------------------------------------------------------
  // Glitch: zero AC coefficients, randomise DC.
  // -----------------------------------------------------------------------
  let is_glitch = hash3(vec3<u32>(group_id.x, group_id.y, u32(params.row2.y))) < params.row1.z;
  if (is_glitch) {
    if (ox != 0u || oy != 0u) {
      dctY[y][x]  = 0.0;
      dctCb[y][x] = 0.0;
      dctCr[y][x] = 0.0;
    } else {
      dctY[y][x] += (hash3(vec3<u32>(x, y, u32(params.row2.y))) - 0.5) * 800.0;
    }
  }

  // Data corrupt: negate / scale random coefficients.
  let is_corrupt = hash3(vec3<u32>(group_id.x, group_id.y, 111u + u32(params.row2.y))) < params.row2.w;
  if (is_corrupt && (ox != 0u || oy != 0u)) {
    let ch = hash3(vec3<u32>(x, y, 222u + u32(params.row2.y)));
    if (ch > 0.45) { dctY[y][x] = -dctY[y][x]; }
    if (ch > 0.80) { dctY[y][x] *= 3.0; }
    if (hash3(vec3<u32>(x, y, 333u + u32(params.row2.y))) > 0.6) {
      dctCb[y][x] = -dctCb[y][x] * 1.5;
      dctCr[y][x] = -dctCr[y][x] * 1.5;
    }
  }

  // -----------------------------------------------------------------------
  // Bit Crush: reduce DCT coefficient resolution to simulate low bit depth.
  // Maps amt 0→1 to steps: 1 (no crush) → ~256 (full crush, ~1 level).
  // This creates harsh quantization stairstepping distinct from JPEG blocking.
  // -----------------------------------------------------------------------
  if (bitCrushAmt > 0.0) {
    // step grows exponentially from 1 (no effect) to 512 (extreme)
    let crushStep = pow(2.0, bitCrushAmt * 9.0);  // 1 → 512
    dctY[y][x]  = floor(dctY[y][x]  / crushStep) * crushStep;
    dctCb[y][x] = floor(dctCb[y][x] / crushStep) * crushStep;
    dctCr[y][x] = floor(dctCr[y][x] / crushStep) * crushStep;
  }

  // -----------------------------------------------------------------------
  // DC Stepping: heavily quantize just the DC coefficient
  // -----------------------------------------------------------------------
  let dcStepAmt = params.row3.z;
  if (dcStepAmt > 0.0 && ox == 0u && oy == 0u) {
    let dcCrushStep = pow(2.0, dcStepAmt * 9.0);
    dctY[y][x]  = floor(dctY[y][x]  / dcCrushStep) * dcCrushStep;
    dctCb[y][x] = floor(dctCb[y][x] / dcCrushStep) * dcCrushStep;
    dctCr[y][x] = floor(dctCr[y][x] / dcCrushStep) * dcCrushStep;
  }

  // -----------------------------------------------------------------------
  // Phase Shift (Audacity Effect): Audio-style frequency amplitude modulation
  // -----------------------------------------------------------------------
  let phaseShiftAmt = params.row3.y;
  if (phaseShiftAmt > 0.0) {
    let idx = f32(oy * 8u + ox);
    // Shift phase via the slider value rather than animating over time
    let manualPhase = phaseShiftAmt * 12.56637; // 2 full cycles across the 0-100% slider range
    let wave = sin(idx * 0.4 + manualPhase);
    
    // Scale amplitude and add offset to create flanger/echo rippling
    let ampMod = 1.0 + wave * phaseShiftAmt * 2.0;
    
    // Maintain DC roughly to avoid complete blow-out
    let is_dc = select(0.0, 1.0, ox == 0u && oy == 0u);
    let finalMod = mix(ampMod, 1.0, is_dc * 0.8 * phaseShiftAmt);

    dctY[y][x]  *= finalMod;
    dctCb[y][x] *= finalMod;
    dctCr[y][x] *= finalMod;
  }

  workgroupBarrier();

  // -----------------------------------------------------------------------
  // 4. Inverse DCT with ringing amplification.
  // Hoisted: inv_cos_ox[i] and a_norm pulled out of inner loops.
  // -----------------------------------------------------------------------
  let rngAmp = params.row1.w;

  var invY = 0.0;
  for (var j = 0u; j < 8u; j++) {
    let a_j = a_norm[j];
    let cv  = dct_cos(oy, j);
    let row = qy * 8u + j;
    for (var i = 0u; i < 8u; i++) {
      let is_ac = select(1.0, 0.0, i == 0u && j == 0u);
      invY += dctY[row][qx * 8u + i]
            * (1.0 + is_ac * (rngAmp - 1.0))
            * a_norm[i] * a_j
            * (inv_cos_ox[i] * cv);
    }
  }

  var invCb = 0.0; var invCr = 0.0;

  if (cMode == 0u) {
    // 4:4:4 — same spatial coordinates as luma; reuse inv_cos_ox.
    for (var j = 0u; j < 8u; j++) {
      let a_j = a_norm[j];
      let cv  = dct_cos(oy, j);
      let row = qy * 8u + j;
      for (var i = 0u; i < 8u; i++) {
        let is_ac  = select(1.0, 0.0, i == 0u && j == 0u);
        let weight = (1.0 + is_ac * (rngAmp - 1.0)) * a_norm[i] * a_j * (inv_cos_ox[i] * cv);
        invCb += dctCb[row][qx * 8u + i] * weight;
        invCr += dctCr[row][qx * 8u + i] * weight;
      }
    }

  } else if (cMode == 1u) {
    // 4:2:2 — horizontal subsampling; column cosines use cx = x/2.
    let cx = x / 2u;
    var inv_cos_cx: array<f32, 8>;
    for (var k = 0u; k < 8u; k++) { inv_cos_cx[k] = dct_cos(cx, k); }

    for (var j = 0u; j < 8u; j++) {
      let a_j = a_norm[j];
      let cv  = dct_cos(oy, j);
      let row = qy * 8u + j;
      for (var i = 0u; i < 8u; i++) {
        let is_ac  = select(1.0, 0.0, i == 0u && j == 0u);
        let weight = (1.0 + is_ac * (rngAmp - 1.0)) * a_norm[i] * a_j * (inv_cos_cx[i] * cv);
        invCb += dctCb[row][i] * weight;
        invCr += dctCr[row][i] * weight;
      }
    }

  } else if (cMode == 2u) {
    // 4:2:0 — both axes subsampled; column cosines use cx, row cosines use cy.
    let cx = x / 2u; let cy = y / 2u;
    var inv_cos_cx: array<f32, 8>;
    for (var k = 0u; k < 8u; k++) { inv_cos_cx[k] = dct_cos(cx, k); }

    for (var j = 0u; j < 8u; j++) {
      let a_j = a_norm[j];
      let cv  = dct_cos(cy, j);
      for (var i = 0u; i < 8u; i++) {
        let is_ac  = select(1.0, 0.0, i == 0u && j == 0u);
        let weight = (1.0 + is_ac * (rngAmp - 1.0)) * a_norm[i] * a_j * (inv_cos_cx[i] * cv);
        invCb += dctCb[j][i] * weight;
        invCr += dctCr[j][i] * weight;
      }
    }
  }

  let finalY  = (0.25 * invY  + 128.0) / 255.0;
  let finalCb = (0.25 * invCb + 128.0) / 255.0;
  let finalCr = (0.25 * invCr + 128.0) / 255.0;

  var finalRGB = ycbcr2rgb_drift(vec3<f32>(finalY, finalCb, finalCr), params.row2.x);
  finalRGB = clamp(finalRGB, vec3<f32>(0.0), vec3<f32>(1.0));

  // Block echo after JPEG round-trip (DCT/quantize/IDCT).
  if (blockEchoAmt > 0.0 && !echoBeforeJpeg) {
    finalRGB = block_echo_blend(finalRGB, global_id.xy, out_dims, blockEchoAmt, group_id);
  }

  if (global_id.x < out_dims.x && global_id.y < out_dims.y) {
    textureStore(outputTex, global_id.xy, vec4<f32>(finalRGB, 1.0));
  }
}
