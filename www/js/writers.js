// Small file writers/readers that need no libraries: PDF (from JPEG pages), DOCX, BMP, ICO, ZIP,
// plus a text-to-page renderer used for Word/text -> PDF.
(function () {
  'use strict';
  const enc = new TextEncoder(), dec = new TextDecoder('utf-8');
  const concat = parts => { let n = 0; parts.forEach(p => n += p.length); const o = new Uint8Array(n); let k = 0; parts.forEach(p => { o.set(p, k); k += p.length; }); return o; };
  const xmlEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // XML 1.0 can't hold most control characters; strip them so Word never says "corrupt".
  const xmlSafe = s => xmlEsc(String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, ''));

  /* ---------- CRC32 + ZIP ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  const u16 = v => new Uint8Array([v & 255, (v >>> 8) & 255]);
  const u32 = v => new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);

  function makeZip(entries) { // [{name, data:Uint8Array}] stored (no compression)
    const parts = [], central = []; let off = 0;
    for (const e of entries) {
      const name = enc.encode(e.name), crc = crc32(e.data);
      const local = concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(e.data.length), u32(e.data.length), u16(name.length), u16(0), name]);
      central.push(concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(e.data.length), u32(e.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), name]));
      parts.push(local, e.data); off += local.length + e.data.length;
    }
    const cd = concat(central);
    return concat([...parts, cd, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(off), u16(0)]);
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This phone can’t open Word files (no decompression support)');
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  async function readZip(bytes) { // -> Map(name -> () => Promise<Uint8Array>)
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let e = -1; for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('Not a valid .docx file');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const map = new Map();
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nl)); p += 46 + nl + el + cl;
      map.set(name, async () => {
        const lnl = dv.getUint16(lo + 26, true), lel = dv.getUint16(lo + 28, true), s = lo + 30 + lnl + lel, raw = bytes.subarray(s, s + csize);
        return method === 0 ? raw : method === 8 ? inflateRaw(raw) : Promise.reject(new Error('Unsupported zip method'));
      });
    }
    return map;
  }

  /* ---------- PDF: pages made of JPEG images ---------- */
  // pages: [{jpeg:Uint8Array, w, h (image pixels), pw, ph (page size in points; optional)}]
  function makePdf(pages) {
    const parts = [], off = []; let len = 0;
    const push = d => { const b = typeof d === 'string' ? enc.encode(d) : d; parts.push(b); len += b.length; };
    const obj = (n, fn) => { off[n] = len; push(`${n} 0 obj\n`); fn(); push('\nendobj\n'); };
    const N = pages.length, total = 2 + N * 3;
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    obj(1, () => push('<</Type/Catalog/Pages 2 0 R>>'));
    obj(2, () => push(`<</Type/Pages/Kids[${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}]/Count ${N}>>`));
    pages.forEach((p, i) => {
      const pg = 3 + i * 3, im = pg + 1, ct = pg + 2;
      const s = p.pw ? 1 : Math.min(1, 1000 / Math.max(p.w, p.h)), pw = +(p.pw || p.w * s).toFixed(2), ph = +(p.ph || p.h * s).toFixed(2);
      obj(pg, () => push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pw} ${ph}]/Resources<</XObject<</Im0 ${im} 0 R>>>>/Contents ${ct} 0 R>>`));
      obj(im, () => { push(`<</Type/XObject/Subtype/Image/Width ${p.w}/Height ${p.h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${p.jpeg.length}>>\nstream\n`); push(p.jpeg); push('\nendstream'); });
      const c = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
      obj(ct, () => push(`<</Length ${c.length}>>\nstream\n${c}\nendstream`));
    });
    const xref = len;
    push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
    for (let i = 1; i <= total; i++) push(String(off[i]).padStart(10, '0') + ' 00000 n \n');
    push(`trailer\n<</Size ${total + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`);
    return concat(parts);
  }

  /* ---------- BMP (24-bit) and ICO (PNG inside) ---------- */
  function makeBmp(canvas) {
    const w = canvas.width, h = canvas.height, px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const row = (w * 3 + 3) & ~3, size = 54 + row * h, out = new Uint8Array(size), dv = new DataView(out.buffer);
    out[0] = 0x42; out[1] = 0x4D; dv.setUint32(2, size, true); dv.setUint32(10, 54, true); dv.setUint32(14, 40, true);
    dv.setInt32(18, w, true); dv.setInt32(22, h, true); dv.setUint16(26, 1, true); dv.setUint16(28, 24, true); dv.setUint32(34, row * h, true); dv.setUint32(38, 2835, true); dv.setUint32(42, 2835, true);
    for (let y = 0; y < h; y++) {
      let o = 54 + (h - 1 - y) * row;
      for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; out[o++] = px[i + 2]; out[o++] = px[i + 1]; out[o++] = px[i]; }
    }
    return out;
  }
  function makeIco(png, w, h) {
    const head = new Uint8Array(22), dv = new DataView(head.buffer);
    dv.setUint16(2, 1, true); dv.setUint16(4, 1, true);
    head[6] = w >= 256 ? 0 : w; head[7] = h >= 256 ? 0 : h; dv.setUint16(10, 1, true); dv.setUint16(12, 32, true); dv.setUint32(14, png.length, true); dv.setUint32(18, 22, true);
    return concat([head, png]);
  }

  /* ---------- DOCX ---------- */
  // paras: [{runs:[{t,b,i}], heading:0..3}] and/or images: [{bytes, type:'png'|'jpeg', w, h}]
  function makeDocx({ paras = [], images = [] }) {
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
    let body = '';
    for (const p of paras) {
      const style = p.heading ? `<w:pPr><w:pStyle w:val="Heading${p.heading}"/></w:pPr>` : '';
      const runs = (p.runs && p.runs.length ? p.runs : [{ t: '' }]).map(r => {
        const pr = (r.b ? '<w:b/>' : '') + (r.i ? '<w:i/>' : '');
        const parts = String(r.t).split('\t').map(x => `<w:t xml:space="preserve">${xmlSafe(x)}</w:t>`).join('<w:tab/>');
        return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}${parts}</w:r>`;
      }).join('');
      body += `<w:p>${style}${runs}</w:p>`;
    }
    const files = [], rels = [], types = new Set();
    images.forEach((im, i) => {
      const k = Math.min(1, 600 / im.w, 900 / im.h), cx = Math.round(im.w * k * 9525), cy = Math.round(im.h * k * 9525), id = i + 1;
      const ext = im.type === 'jpeg' ? 'jpg' : 'png'; types.add(ext);
      files.push({ name: `word/media/image${id}.${ext}`, data: im.bytes });
      rels.push(`<Relationship Id="rIdImg${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${id}.${ext}"/>`);
      if (i > 0) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      body += `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}.${ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    });
    if (!body) body = '<w:p/>';
    const T = s => enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s);
    const heads = [1, 2, 3].map(n => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="${[40, 32, 26][n - 1]}"/></w:rPr></w:style>`).join('');
    return makeZip([
      { name: '[Content_Types].xml', data: T(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${types.has('png') ? '<Default Extension="png" ContentType="image/png"/>' : ''}${types.has('jpg') ? '<Default Extension="jpg" ContentType="image/jpeg"/>' : ''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`) },
      { name: '_rels/.rels', data: T('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
      { name: 'word/_rels/document.xml.rels', data: T(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSty" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels.join('')}</Relationships>`) },
      { name: 'word/styles.xml', data: T(`<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heads}</w:styles>`) },
      { name: 'word/document.xml', data: T(`<w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`) },
      ...files
    ]);
  }

  // Read paragraphs (with bold/italic and headings) out of a .docx
  async function readDocx(bytes) {
    const z = await readZip(bytes), f = z.get('word/document.xml');
    if (!f) throw new Error('This doesn’t look like a Word document');
    const doc = new DOMParser().parseFromString(dec.decode(await f()), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not read this Word file');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', out = [];
    const on = el => { if (!el) return false; const v = el.getAttributeNS(W, 'val'); return v !== '0' && v !== 'false'; };
    const para = p => {
      const runs = []; let heading = 0;
      const ps = p.getElementsByTagNameNS(W, 'pStyle')[0];
      if (ps) { const m = /^(?:Heading|Title)(\d?)/i.exec(ps.getAttributeNS(W, 'val') || ''); if (m) heading = Math.min(3, +m[1] || 1); }
      for (const r of p.getElementsByTagNameNS(W, 'r')) {
        const rp = r.getElementsByTagNameNS(W, 'rPr')[0], b = rp && on(rp.getElementsByTagNameNS(W, 'b')[0]), i = rp && on(rp.getElementsByTagNameNS(W, 'i')[0]);
        let t = ''; for (const c of r.childNodes) { const n = c.localName; if (n === 't') t += c.textContent; else if (n === 'tab') t += '\t'; else if (n === 'br' || n === 'cr') t += '\n'; }
        if (t) runs.push({ t, b: !!b, i: !!i });
      }
      return { runs, heading };
    };
    const body = doc.getElementsByTagNameNS(W, 'body')[0];
    const walk = node => { for (const c of node.childNodes) {
      if (c.localName === 'p') out.push(para(c));
      else if (c.localName === 'tbl') for (const tr of c.getElementsByTagNameNS(W, 'tr')) {
        const cells = [...tr.getElementsByTagNameNS(W, 'tc')].map(tc => [...tc.getElementsByTagNameNS(W, 'p')].map(p => para(p).runs.map(r => r.t).join('')).join(' '));
        out.push({ runs: [{ t: cells.join('\t') }], heading: 0 });
      } else if (c.localName === 'sdt') { const k = c.getElementsByTagNameNS(W, 'sdtContent')[0]; if (k) walk(k); }
    } };
    walk(body);
    return out;
  }

  /* ---------- text -> page images (so Word/text -> PDF works on a phone) ---------- */
  // paras: [{runs:[{t,b,i}], heading}], returns array of canvases (A4 at 2x)
  function renderPages(paras, { mono = false } = {}) {
    const S = 2, PW = 595 * S, PH = 842 * S, M = 56 * S, maxW = PW - 2 * M;
    const family = mono ? 'ui-monospace, Menlo, Consolas, "Courier New", monospace' : 'Georgia, "Times New Roman", serif';
    const pages = []; let cv, g, y;
    const newPage = () => { cv = document.createElement('canvas'); cv.width = PW; cv.height = PH; g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, PW, PH); g.fillStyle = '#111'; g.textBaseline = 'alphabetic'; y = M; pages.push(cv); };
    newPage();
    const fontOf = (r, size) => `${r.i ? 'italic ' : ''}${r.b ? 'bold ' : ''}${size}px ${family}`;
    for (const p of paras) {
      const size = (p.heading ? [0, 20, 16, 13.5][p.heading] : mono ? 10 : 11) * S, lh = size * (mono ? 1.35 : 1.5);
      // tokens: words + whitespace, each keeps its run style
      const toks = [];
      for (const r of (p.runs.length ? p.runs : [{ t: '' }])) {
        const font = fontOf({ b: r.b || p.heading, i: r.i }, size);
        String(r.t).split(/(\s+)/).forEach(w => { if (w) toks.push({ w, font }); });
      }
      const lines = []; let line = [], x = 0;
      const flush = () => { lines.push(line); line = []; x = 0; };
      for (const tk of toks) {
        if (tk.w.includes('\n')) { tk.w.split('\n').forEach((part, i, a) => { if (part) { g.font = tk.font; const w = g.measureText(part).width; line.push({ ...tk, w: part, width: w }); x += w; } if (i < a.length - 1) flush(); }); continue; }
        g.font = tk.font; const isSpace = /^\s+$/.test(tk.w), text = isSpace ? tk.w.replace(/\t/g, '    ') : tk.w, w = g.measureText(text).width;
        if (!isSpace && x + w > maxW && line.length) flush();
        if (!isSpace && w > maxW) { // very long word: split by characters
          let buf = ''; for (const ch of text) { g.font = tk.font; if (g.measureText(buf + ch).width > maxW - x && buf) { line.push({ ...tk, w: buf, width: g.measureText(buf).width }); flush(); buf = ''; } buf += ch; }
          if (buf) { line.push({ ...tk, w: buf, width: g.measureText(buf).width }); x += g.measureText(buf).width; } continue;
        }
        if (isSpace && !line.length) continue;
        line.push({ ...tk, w: text, width: w }); x += w;
      }
      if (line.length || !lines.length) lines.push(line);
      if (p.heading) y += size * 0.4;
      for (const ln of lines) {
        if (y + lh > PH - M) newPage();
        let cx = M; for (const t of ln) { g.font = t.font; g.fillText(t.w, cx, y + size); cx += t.width; }
        y += lh;
      }
      y += (mono ? 0 : size * 0.45);
    }
    return pages;
  }

  window.Writers = { makeZip, readZip, makePdf, makeBmp, makeIco, makeDocx, readDocx, renderPages, crc32, xmlEsc, concat };
})();
