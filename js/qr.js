/* CONECTAcamp — gerador de QR Code (sem dependências)
   Modo byte (UTF-8), correção de erro nível M, versões 1 a 10 (até 213 bytes).
   Uso:  var q = QR.encode('texto');   // { size, modules[y][x] (true = escuro) }
         QR.svg('texto', { margin: 2 }) // string <svg> pronta para usar
   Baseado no algoritmo da especificação ISO/IEC 18004. */
(function (root) {
  'use strict';

  var ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]; /* nível M, por versão */
  var NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  var MAX_VERSION = 10;

  function utf8(str) {
    var out = [], i, c;
    var s = unescape(encodeURIComponent(String(str)));
    for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); out.push(c); }
    return out;
  }

  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(ver) { return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver]; }

  /* Reed-Solomon em GF(256), polinômio 0x11D */
  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z;
  }
  function rsDivisor(degree) {
    var result = [], i, j;
    for (i = 0; i < degree; i++) result.push(0);
    result[degree - 1] = 1;
    var root = 1;
    for (i = 0; i < degree; i++) {
      for (j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 2);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    var result = divisor.map(function () { return 0; });
    data.forEach(function (b) {
      var factor = b ^ result.shift();
      result.push(0);
      divisor.forEach(function (coef, i) { result[i] ^= gfMul(coef, factor); });
    });
    return result;
  }

  function bitsToCodewords(bits, ver) {
    var cap = dataCodewords(ver) * 8, i;
    for (i = 0; i < 4 && bits.length < cap; i++) bits.push(0);          /* terminador */
    while (bits.length % 8) bits.push(0);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) { for (i = 7; i >= 0; i--) bits.push((pad >>> i) & 1); }
    var cw = [];
    for (i = 0; i < bits.length; i += 8) { var v = 0; for (var k = 0; k < 8; k++) v = (v << 1) | bits[i + k]; cw.push(v); }
    return cw;
  }

  function addEccAndInterleave(data, ver) {
    var nb = NUM_BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver];
    var raw = Math.floor(rawModules(ver) / 8);
    var shortCount = nb - raw % nb, shortLen = Math.floor(raw / nb);
    var div = rsDivisor(eccLen), blocks = [], k = 0, i;
    for (i = 0; i < nb; i++) {
      var dat = data.slice(k, k + shortLen - eccLen + (i < shortCount ? 0 : 1));
      k += dat.length;
      var ecc = rsRemainder(dat, div);
      if (i < shortCount) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var out = [];
    for (i = 0; i < blocks[0].length; i++) {
      blocks.forEach(function (block, j) { if (i !== shortLen - eccLen || j >= shortCount) out.push(block[i]); });
    }
    return out;
  }

  function alignPositions(ver) {
    if (ver === 1) return [];
    var n = Math.floor(ver / 7) + 2, size = ver * 4 + 17;
    var step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    var res = [6];
    for (var pos = size - 7; res.length < n; pos -= step) res.splice(1, 0, pos);
    return res;
  }

  function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

  function build(ver, codewords) {
    var size = ver * 4 + 17, modules = [], isFn = [], y, x;
    for (y = 0; y < size; y++) { modules.push(new Array(size).fill(false)); isFn.push(new Array(size).fill(false)); }
    function setFn(px, py, dark) { modules[py][px] = dark; isFn[py][px] = true; }

    for (var i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = cx + dx, yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var ap = alignPositions(ver), n = ap.length;
    for (i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) setFn(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }

    function formatBits(mask) {
      var data = (0 << 3) | mask;                  /* nível M = 00 */
      var rem = data;
      for (var q = 0; q < 10; q++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var bits = ((data << 10) | rem) ^ 0x5412, t;
      for (t = 0; t <= 5; t++) setFn(8, t, getBit(bits, t));
      setFn(8, 7, getBit(bits, 6)); setFn(8, 8, getBit(bits, 7)); setFn(7, 8, getBit(bits, 8));
      for (t = 9; t < 15; t++) setFn(14 - t, 8, getBit(bits, t));
      for (t = 0; t < 8; t++) setFn(size - 1 - t, 8, getBit(bits, t));
      for (t = 8; t < 15; t++) setFn(8, size - 15 + t, getBit(bits, t));
      setFn(8, size - 8, true);
    }
    formatBits(0);
    if (ver >= 7) {
      var rem = ver;
      for (var q = 0; q < 12; q++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vb = (ver << 12) | rem;
      for (var t = 0; t < 18; t++) {
        var a = size - 11 + (t % 3), b = Math.floor(t / 3);
        setFn(a, b, getBit(vb, t)); setFn(b, a, getBit(vb, t));
      }
    }

    /* dados em zigue-zague */
    var bi = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var jj = 0; jj < 2; jj++) {
          var xx = right - jj, upward = ((right + 1) & 2) === 0, yy = upward ? size - 1 - vert : vert;
          if (!isFn[yy][xx] && bi < codewords.length * 8) { modules[yy][xx] = getBit(codewords[bi >>> 3], 7 - (bi & 7)); bi++; }
        }
      }
    }

    function applyMask(mask) {
      for (var yy2 = 0; yy2 < size; yy2++) for (var xx2 = 0; xx2 < size; xx2++) {
        var inv;
        switch (mask) {
          case 0: inv = (xx2 + yy2) % 2 === 0; break;
          case 1: inv = yy2 % 2 === 0; break;
          case 2: inv = xx2 % 3 === 0; break;
          case 3: inv = (xx2 + yy2) % 3 === 0; break;
          case 4: inv = (Math.floor(xx2 / 3) + Math.floor(yy2 / 2)) % 2 === 0; break;
          case 5: inv = xx2 * yy2 % 2 + xx2 * yy2 % 3 === 0; break;
          case 6: inv = (xx2 * yy2 % 2 + xx2 * yy2 % 3) % 2 === 0; break;
          default: inv = ((xx2 + yy2) % 2 + xx2 * yy2 % 3) % 2 === 0;
        }
        if (!isFn[yy2][xx2] && inv) modules[yy2][xx2] = !modules[yy2][xx2];
      }
    }
    function penalty() {
      var score = 0, r, c, run, dark = 0;
      for (r = 0; r < size; r++) {
        run = 1;
        for (c = 1; c < size; c++) { if (modules[r][c] === modules[r][c - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else run = 1; }
      }
      for (c = 0; c < size; c++) {
        run = 1;
        for (r = 1; r < size; r++) { if (modules[r][c] === modules[r - 1][c]) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else run = 1; }
      }
      for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++) {
        var v = modules[r][c];
        if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) score += 3;
      }
      for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (modules[r][c]) dark++;
      score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
      return score;
    }
    var best = 0, bestScore = Infinity;
    for (var m = 0; m < 8; m++) {
      applyMask(m); formatBits(m);
      var s = penalty();
      if (s < bestScore) { bestScore = s; best = m; }
      applyMask(m);                                   /* desfaz (a máscara é um XOR) */
    }
    applyMask(best); formatBits(best);
    return { size: size, modules: modules, version: ver, mask: best };
  }

  function encode(text) {
    var bytes = utf8(text), ver, bits = [], i;
    for (ver = 1; ver <= MAX_VERSION; ver++) {
      var ccBits = ver < 10 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
    }
    if (ver > MAX_VERSION) throw new Error('Texto grande demais para o QR Code.');
    var cc = ver < 10 ? 8 : 16;
    [0, 1, 0, 0].forEach(function (b) { bits.push(b); });                      /* modo byte */
    for (i = cc - 1; i >= 0; i--) bits.push((bytes.length >>> i) & 1);
    bytes.forEach(function (b) { for (var k = 7; k >= 0; k--) bits.push((b >>> k) & 1); });
    var cw = bitsToCodewords(bits, ver);
    return build(ver, addEccAndInterleave(cw, ver));
  }

  function svg(text, opts) {
    opts = opts || {};
    var q = encode(text), m = opts.margin == null ? 2 : opts.margin, n = q.size + m * 2, d = '', x, y;
    for (y = 0; y < q.size; y++) for (x = 0; x < q.size; x++) if (q.modules[y][x]) d += 'M' + (x + m) + ' ' + (y + m) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges" role="img" aria-label="' + (opts.label || 'QR Code do voucher') + '">' +
      '<rect width="' + n + '" height="' + n + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  root.QR = { encode: encode, svg: svg };
})(window);
