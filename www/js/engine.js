// The conversion engine for the phone app. Everything runs on the device.
// Images / PDF / Word / text use the browser's own tools; video + audio use ffmpeg (WebAssembly).
(function () {
  'use strict';
  const F = window.Formats, W = window.Writers;
  const extOf = n => (String(n).split('.').pop() || '').toLowerCase();
  const baseOf = n => String(n).replace(/\.[^.]+$/, '');
  const u8 = async b => new Uint8Array(await b.arrayBuffer());
  const canvasBlob = (c, t, q) => new Promise(r => c.toBlob(r, t, q));
  const mk = (name, data, type) => ({ name, blob: new Blob([data], { type: type || F.mime(extOf(name)) }) });
  const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });

  /* ================= ffmpeg (video / audio / a few image formats) ================= */
  const FF = {
    inst: null, loading: null, chain: Promise.resolve(), impl: null, status: () => {},
    async get() {
      if (this.inst) return this.inst;
      if (!this.loading) this.loading = this._load().catch(e => { this.loading = null; throw e; });
      return this.loading;
    },
    async _load() {
      this.status('Starting the video & audio engine (first time takes a moment)…');
      const base = new URL('lib/', location.href).href, wasm = base + 'core/ffmpeg-core.wasm', errs = [];
      // Attempt 1: modern module build. Attempt 2: classic build.
      try {
        const mod = await import(base + 'ffmpeg/esm/index.js'), ff = new mod.FFmpeg();
        await ff.load({ coreURL: base + 'core/esm/ffmpeg-core.js', wasmURL: wasm });
        return (this.inst = ff);
      } catch (e) { errs.push('module: ' + (e && e.message || e)); }
      try {
        await loadScript(base + 'ffmpeg/umd/ffmpeg.js');
        const man = await fetch(base + 'manifest.json').then(r => r.json()).catch(() => ({})), ff = new window.FFmpegWASM.FFmpeg();
        await ff.load({ coreURL: base + 'core/umd/ffmpeg-core.js', wasmURL: wasm, ...(man.umdWorker ? { classWorkerURL: base + 'ffmpeg/umd/' + man.umdWorker } : {}) });
        return (this.inst = ff);
      } catch (e) { errs.push('classic: ' + (e && e.message || e)); }
      throw new Error('The video & audio engine would not start (' + errs.join(' | ') + ')');
    },
    // inputs: [{name, data}], args: ffmpeg args, out: output file name (or null for probe)
    run({ inputs, args, out, onPct }) {
      const job = this.chain.then(() => this._run({ inputs, args, out, onPct }));
      this.chain = job.catch(() => {});
      return job;
    },
    async _run({ inputs, args, out, onPct }) {
      if (this.impl) return this.impl({ inputs, args, out, onPct });
      const ff = await this.get(), logs = [];
      const lh = e => logs.push(e.message), ph = e => { if (onPct && isFinite(e.progress)) onPct(Math.max(0, Math.min(.99, e.progress))); };
      ff.on('log', lh); ff.on('progress', ph);
      try {
        for (const i of inputs) await ff.writeFile(i.name, i.data);
        const code = await ff.exec(['-hide_banner', '-nostdin', ...args]);
        let data = null;
        if (out && code === 0) data = await ff.readFile(out);
        if (out && !data) throw new Error(logs.filter(Boolean).slice(-2).join(' ').slice(0, 220) || 'ffmpeg failed');
        return { data, log: logs.join('\n'), code };
      } finally {
        ff.off('log', lh); ff.off('progress', ph);
        for (const n of [...inputs.map(i => i.name), out]) if (n) { try { await ff.deleteFile(n); } catch {} }
      }
    },
    async available() { try { if (this.impl) return true; await this.get(); return true; } catch { return false; } }
  };

  async function probe(item) {
    const name = 'in.' + (item.ext || 'bin');
    const r = await FF.run({ inputs: [{ name, data: await u8(item.blob) }], args: ['-i', name], out: null });
    const m = r.log.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    return { duration: m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : 0, hasAudio: /Stream #[^\n]*Audio:/.test(r.log), hasVideo: /Stream #[^\n]*Video:/.test(r.log),
      ...(() => { const vl = (r.log.match(/Stream #[^\n]*Video:[^\n]*/) || [''])[0], sz = vl.match(/,\s*(\d{2,5})x(\d{2,5})/); return { width: sz ? +sz[1] : 0, height: sz ? +sz[2] : 0 }; })() };
  }
  async function ffConvert(item, args, outExt, onPct, inName) {
    const name = inName || 'in.' + item.ext, out = 'out.' + outExt;
    const r = await FF.run({ inputs: [{ name, data: await u8(item.blob) }], args: args(name, out), out, onPct });
    return r.data;
  }

  /* ---------- codec recipes ---------- */
  const H264 = { v: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'], a: ['-c:a', 'aac', '-b:a', '160k'] };
  const VIDEO = {
    mp4: { ...H264, x: ['-movflags', '+faststart'] }, m4v: { ...H264, x: ['-movflags', '+faststart'] }, mov: H264, mkv: H264, flv: H264,
    webm: { v: ['-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1'], a: ['-c:a', 'libopus', '-b:a', '128k'] },
    avi: { v: ['-c:v', 'mpeg4', '-q:v', '4'], a: ['-c:a', 'libmp3lame', '-q:a', '4'] },
    wmv: { v: ['-c:v', 'wmv2', '-b:v', '3M'], a: ['-c:a', 'wmav2', '-b:a', '192k'] }
  };
  const AUDIO = {
    mp3: ['-c:a', 'libmp3lame', '-q:a', '2'], wav: ['-c:a', 'pcm_s16le'], m4a: ['-c:a', 'aac', '-b:a', '192k'], aac: ['-c:a', 'aac', '-b:a', '192k'],
    ogg: ['-c:a', 'libvorbis', '-q:a', '5'], opus: ['-c:a', 'libopus', '-b:a', '128k'], flac: ['-c:a', 'flac'], aiff: ['-c:a', 'pcm_s16be'], wma: ['-c:a', 'wmav2', '-b:a', '192k']
  };
  const EVEN = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  const GIF_VF = "fps=12,scale='min(iw,480)':-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse";
  const LEVEL = { crf: [24, 28, 32], maxW: [1920, 1280, 854], abr: [128, 96, 64], jpgQ: [.82, .65, .45], webpQ: [.85, .7, .5], maxDim: [3000, 2048, 1280], colors: [256, 128, 64], pdfScale: [1.6, 1.2, .9], pdfQ: [.8, .62, .45] };

  async function toVideo(item, to, onPct, x = {}) {
    if (to === 'gif') return ffConvert(item, (i, o) => ['-i', i, ...(x.post || []), '-vf', GIF_VF, '-loop', '0', o], 'gif', onPct);
    const r = VIDEO[to], vf = [EVEN, ...(x.vf ? [x.vf] : [])].join(',');
    return ffConvert(item, (i, o) => ['-i', i, ...(x.post || []), '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, ...(x.vArgs || r.v), ...(x.aArgs || r.a), ...(r.x || []), o], to, onPct);
  }
  async function toAudio(item, to, onPct, x = {}) {
    return ffConvert(item, (i, o) => ['-i', i, ...(x.post || []), '-vn', '-map_metadata', '0', ...(x.aArgs || AUDIO[to]), o], to, onPct);
  }
  async function frameToImage(item, to, onPct) {
    const q = to === 'jpg' ? ['-q:v', '2'] : to === 'webp' ? ['-q:v', '90'] : [];
    return ffConvert(item, (i, o) => ['-i', i, '-frames:v', '1', ...q, '-update', '1', o], to, onPct);
  }

  /* ================= images ================= */
  async function decode(blob, ext) {
    try { return await createImageBitmap(blob); } catch {}
    try { // a plain <img> sometimes understands what createImageBitmap does not
      const url = URL.createObjectURL(blob);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      return img;
    } catch {}
    if (await FF.available()) { // e.g. TIFF
      const data = await ffConvert({ blob, ext }, (i, o) => ['-i', i, '-frames:v', '1', '-update', '1', o], 'png');
      return createImageBitmap(new Blob([data], { type: 'image/png' }));
    }
    throw new Error('This phone can’t open that kind of image');
  }
  const dims = b => ({ w: b.naturalWidth || b.width, h: b.naturalHeight || b.height });
  function paint(bmp, { white = false, maxSide = 0 } = {}) {
    const { w, h } = dims(bmp), k = maxSide ? Math.min(1, maxSide / Math.max(w, h)) : 1;
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const g = c.getContext('2d'); if (white) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
    g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height); return c;
  }
  const jpegBytes = async (c, q = .92) => u8(await canvasBlob(c, 'image/jpeg', q));

  async function imageTo(item, to, onPct) {
    const base = baseOf(item.name);
    if (['mp4', 'webm', 'mov'].includes(to)) return [mk(`${base}.${to}`, await toVideo(item, to, onPct))]; // animated GIF -> video
    const bmp = await decode(item.blob, item.ext), { w, h } = dims(bmp);
    if (to === 'png') return [mk(`${base}.png`, await canvasBlob(paint(bmp), 'image/png'))];
    if (to === 'jpg') return [mk(`${base}.jpg`, await canvasBlob(paint(bmp, { white: true }), 'image/jpeg', .92))];
    if (to === 'webp') return [mk(`${base}.webp`, await canvasBlob(paint(bmp), 'image/webp', .92))];
    if (to === 'bmp') return [mk(`${base}.bmp`, W.makeBmp(paint(bmp, { white: true })))];
    if (to === 'ico') { const c = paint(bmp, { maxSide: 256 }); return [mk(`${base}.ico`, W.makeIco(await u8(await canvasBlob(c, 'image/png')), c.width, c.height))]; }
    if (to === 'gif' || to === 'tiff') {
      const png = new Blob([await u8(await canvasBlob(paint(bmp), 'image/png'))], { type: 'image/png' });
      return [mk(`${base}.${to}`, await ffConvert({ blob: png, ext: 'png' }, (i, o) => ['-i', i, ...(to === 'tiff' ? ['-update', '1'] : []), o], to, onPct))];
    }
    if (to === 'pdf') return [mk(`${base}.pdf`, W.makePdf([{ jpeg: await jpegBytes(paint(bmp, { white: true })), w, h }]))];
    if (to === 'docx') return [mk(`${base}.docx`, W.makeDocx({ images: [await docxImage(bmp, item.ext)] }))];
    throw new Error(`can’t turn .${item.ext} into .${to}`);
  }
  async function docxImage(bmp, ext) {
    const { w, h } = dims(bmp), jpg = ['jpg', 'jpeg', 'jfif'].includes(ext);
    return jpg ? { bytes: await jpegBytes(paint(bmp, { white: true })), type: 'jpeg', w, h } : { bytes: await u8(await canvasBlob(paint(bmp), 'image/png')), type: 'png', w, h };
  }
  async function imagesToPdf(items) {
    const pages = [];
    for (const it of items) { const bmp = await decode(it.blob, it.ext), { w, h } = dims(bmp); pages.push({ jpeg: await jpegBytes(paint(bmp, { white: true })), w, h }); }
    return W.makePdf(pages);
  }

  /* ================= PDF (reading uses pdf.js, loaded only when needed) ================= */
  let pdfjsP;
  function pdfjs() {
    if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = window.pdfjsLib.GlobalWorkerOptions.workerSrc || 'lib/pdf.worker.min.js'; return Promise.resolve(window.pdfjsLib); }
    return pdfjsP || (pdfjsP = loadScript('lib/pdf.min.js').then(() => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js'; return window.pdfjsLib; }));
  }
  async function openPdf(item) { const lib = await pdfjs(); return lib.getDocument({ data: await u8(item.blob) }).promise; }
  async function renderPdfPage(pdf, n, scale) {
    const page = await pdf.getPage(n), base = page.getViewport({ scale: 1 }), s = Math.min(scale, 4096 / Math.max(base.width, base.height)), vp = page.getViewport({ scale: s });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    return { c, pw: base.width, ph: base.height };
  }
  async function pdfTo(item, to, onPct) {
    const pdf = await openPdf(item), n = pdf.numPages, base = baseOf(item.name), outs = [];
    if (to === 'txt') {
      let text = '';
      for (let i = 1; i <= n; i++) { const tc = await (await pdf.getPage(i)).getTextContent(); text += tc.items.map(t => t.str + (t.hasEOL ? '\n' : ' ')).join('') + (i < n ? '\n\n' : ''); onPct && onPct(i / n); }
      return [mk(`${base}.txt`, new TextEncoder().encode(text), 'text/plain')];
    }
    for (let i = 1; i <= n; i++) {
      const { c } = await renderPdfPage(pdf, i, 2);
      outs.push(mk(`${base}${n > 1 ? '-' + String(i).padStart(3, '0') : ''}.${to}`, await canvasBlob(c, to === 'jpg' ? 'image/jpeg' : 'image/png', .92)));
      onPct && onPct(i / n);
    }
    return outs;
  }
  async function pdfCompress(item, L, onPct) {
    const pdf = await openPdf(item), n = pdf.numPages, pages = [];
    for (let i = 1; i <= n; i++) {
      const { c, pw, ph } = await renderPdfPage(pdf, i, LEVEL.pdfScale[L]);
      pages.push({ jpeg: await jpegBytes(c, LEVEL.pdfQ[L]), w: c.width, h: c.height, pw, ph }); onPct && onPct(i / n);
    }
    const out = W.makePdf(pages);
    if (out.length >= item.blob.size) throw new Error('this PDF is already small — compressing would make it bigger, so it was left alone');
    return [mk(`${baseOf(item.name)} compressed.pdf`, out)];
  }
  async function pdfMerge(items) {
    if (!window.PDFLib) await loadScript('lib/pdf-lib.min.js');
    const out = await window.PDFLib.PDFDocument.create();
    for (const it of items) { const d = await window.PDFLib.PDFDocument.load(await u8(it.blob), { ignoreEncryption: true }); (await out.copyPages(d, d.getPageIndices())).forEach(p => out.addPage(p)); }
    return out.save();
  }

  /* ================= Word + text ================= */
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const PAGE_CSS = 'body{font:12pt/1.55 Georgia,"Times New Roman",serif;color:#111;margin:2em auto;max-width:42em;padding:0 1em}pre{white-space:pre-wrap;font:11pt/1.5 ui-monospace,Menlo,Consolas,monospace}';
  const wrapHtml = (body, title) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body>${body}</body></html>`;
  const paraText = p => p.runs.map(r => r.t).join('');
  async function canvasesToPdf(canvases) {
    const pages = []; for (const c of canvases) pages.push({ jpeg: await jpegBytes(c, .9), w: c.width, h: c.height, pw: 595, ph: 842 });
    return W.makePdf(pages);
  }
  async function docTo(item, to) {
    const base = baseOf(item.name), paras = await W.readDocx(await u8(item.blob));
    if (to === 'txt') return [mk(`${base}.txt`, new TextEncoder().encode(paras.map(paraText).join('\n')), 'text/plain')];
    if (to === 'html') {
      const body = paras.map(p => { const inner = p.runs.map(r => { let t = esc(r.t).replace(/\n/g, '<br>').replace(/\t/g, '&emsp;'); if (r.b) t = `<b>${t}</b>`; if (r.i) t = `<i>${t}</i>`; return t; }).join(''); const tag = p.heading ? `h${p.heading}` : 'p'; return `<${tag}>${inner || '&nbsp;'}</${tag}>`; }).join('\n');
      return [mk(`${base}.html`, new TextEncoder().encode(wrapHtml(body, base)), 'text/html')];
    }
    if (to === 'pdf') return [mk(`${base}.pdf`, await canvasesToPdf(W.renderPages(paras)))];
    throw new Error(`can’t turn .docx into .${to}`);
  }
  async function textTo(item, to) {
    const base = baseOf(item.name), raw = await item.blob.text(), isHtml = item.ext === 'html' || item.ext === 'htm';
    const plain = isHtml ? (() => { const d = new DOMParser().parseFromString(raw, 'text/html'); d.querySelectorAll('script,style').forEach(n => n.remove()); return d.body ? d.body.innerText || d.body.textContent : raw; })() : raw;
    if (to === 'html') { if (isHtml) throw new Error('already HTML'); return [mk(`${base}.html`, new TextEncoder().encode(wrapHtml(`<pre>${esc(raw)}</pre>`, base)), 'text/html')]; }
    if (to === 'pdf') return [mk(`${base}.pdf`, await canvasesToPdf(W.renderPages(plain.split(/\r?\n/).map(l => ({ runs: [{ t: l }], heading: 0 })), { mono: !isHtml })))];
    if (to === 'docx') return [mk(`${base}.docx`, W.makeDocx({ paras: plain.split(/\r?\n/).map(l => ({ runs: [{ t: l }] })) }))];
    throw new Error(`can’t turn .${item.ext} into .${to}`);
  }

  /* ================= the public operations ================= */
  async function convertOne(item, to, onPct) {
    to = F.norm(to); const kind = item.kind;
    if (item.ext === to || (to === 'jpg' && item.ext === 'jpeg')) throw new Error(`it is already a .${to} file`);
    if (!F.targetsFor(item.ext).includes(to)) throw new Error(`can’t turn a .${item.ext} into a .${to}`);
    const base = baseOf(item.name);
    if (kind === 'image') return imageTo(item, to, onPct);
    if (kind === 'video') {
      if (F.AUDIO_OUT.includes(to)) return [mk(`${base}.${to}`, await toAudio(item, to, onPct))];
      if (['png', 'jpg', 'webp'].includes(to)) return [mk(`${base}.${to}`, await frameToImage(item, to, onPct))];
      return [mk(`${base}.${to}`, await toVideo(item, to, onPct))];
    }
    if (kind === 'audio') return [mk(`${base}.${to}`, await toAudio(item, to, onPct))];
    if (kind === 'pdf') return pdfTo(item, to, onPct);
    if (kind === 'doc') return docTo(item, to);
    if (kind === 'text') return textTo(item, to);
    throw new Error(`.${item.ext} files aren’t supported`);
  }

  async function compressOne(item, level, onPct) {
    const L = Math.min(3, Math.max(1, level || 2)) - 1, ext = item.ext, base = baseOf(item.name), S = ' compressed';
    if (item.kind === 'image') {
      if (ext === 'gif') return [mk(`${base}${S}.gif`, await ffConvert(item, (i, o) => ['-i', i, '-vf', "fps=12,scale='min(640,iw)':-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse", '-loop', '0', o], 'gif', onPct))];
      if (ext === 'png' && await FF.available()) {
        const data = await ffConvert(item, (i, o) => ['-i', i, '-vf', `scale='min(${LEVEL.maxDim[L]},iw)':-2,split[a][b];[a]palettegen=max_colors=${LEVEL.colors[L]}[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`, '-update', '1', o], 'png', onPct);
        return [mk(`${base}${S}.png`, data)];
      }
      const bmp = await decode(item.blob, ext);
      if (ext === 'png') return [mk(`${base}${S}.png`, await canvasBlob(paint(bmp, { maxSide: LEVEL.maxDim[L] }), 'image/png'))];
      if (ext === 'webp') return [mk(`${base}${S}.webp`, await canvasBlob(paint(bmp, { maxSide: LEVEL.maxDim[L] }), 'image/webp', LEVEL.webpQ[L]))];
      return [mk(`${base}${S}.jpg`, await canvasBlob(paint(bmp, { white: true, maxSide: LEVEL.maxDim[L] }), 'image/jpeg', LEVEL.jpgQ[L]))];
    }
    if (item.kind === 'video') {
      const to = ['mp4', 'mov', 'mkv'].includes(ext) ? ext : 'mp4';
      return [mk(`${base}${S}.${to}`, await toVideo(item, to, onPct, { vf: `scale='min(${LEVEL.maxW[L]},iw)':-2`, vArgs: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(LEVEL.crf[L]), '-pix_fmt', 'yuv420p'], aArgs: ['-c:a', 'aac', '-b:a', LEVEL.abr[L] + 'k'] }))];
    }
    if (item.kind === 'audio') return [mk(`${base}${S}.mp3`, await toAudio(item, 'mp3', onPct, { aArgs: ['-c:a', 'libmp3lame', '-b:a', LEVEL.abr[L] + 'k'] }))];
    if (item.kind === 'pdf') return pdfCompress(item, L, onPct);
    throw new Error(`can’t compress .${ext} files`);
  }

  async function trimOne(item, { start = 0, end = 0, fast = true }, onPct) {
    const s = +start || 0, e = +end || 0, base = baseOf(item.name);
    if (e && e <= s) throw new Error('the end time must be after the start time');
    if (item.kind !== 'video' && item.kind !== 'audio') throw new Error('trim works on video and audio files');
    const times = ['-ss', String(s), ...(e ? ['-to', String(e)] : [])];
    if (fast) { // no re-encode: instant, but cuts at the nearest keyframe
      const to = item.ext;
      return [mk(`${base} trimmed.${to}`, await ffConvert(item, (i, o) => [...times, '-i', i, '-c', 'copy', '-avoid_negative_ts', 'make_zero', o], to, onPct))];
    }
    if (item.kind === 'video') { const to = VIDEO[item.ext] ? item.ext : 'mp4'; return [mk(`${base} trimmed.${to}`, await toVideo(item, to, onPct, { post: times }))]; }
    const to = AUDIO[item.ext] ? item.ext : 'mp3'; return [mk(`${base} trimmed.${to}`, await toAudio(item, to, onPct, { post: times }))];
  }

  async function mergeAll(items, onPct) {
    if (items.length < 2) throw new Error('pick at least two files to merge');
    const kinds = new Set(items.map(i => i.kind));
    if (kinds.size > 1) throw new Error('merge needs files of the same type (all PDFs, all images, all videos or all audio)');
    const kind = [...kinds][0], first = items[0], base = baseOf(first.name);
    if (kind === 'pdf') return [mk(`${base} merged.pdf`, await pdfMerge(items))];
    if (kind === 'image') return [mk(`${base} merged.pdf`, await imagesToPdf(items))];
    if (kind !== 'video' && kind !== 'audio') throw new Error('can’t merge these files');
    const infos = []; for (const it of items) infos.push(await probe(it));
    const inputs = [], ins = []; for (let i = 0; i < items.length; i++) { const n = `in${i}.${items[i].ext}`; inputs.push({ name: n, data: await u8(items[i].blob) }); ins.push('-i', n); }
    if (kind === 'audio') {
      const to = AUDIO[first.ext] ? first.ext : 'mp3', out = 'out.' + to;
      const fc = items.map((_, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=stereo[a${i}]`).join(';') + ';' + items.map((_, i) => `[a${i}]`).join('') + `concat=n=${items.length}:v=0:a=1[a]`;
      const r = await FF.run({ inputs, args: [...ins, '-filter_complex', fc, '-map', '[a]', ...AUDIO[to], out], out, onPct });
      return [mk(`${base} merged.${to}`, r.data)];
    }
    const withAudio = infos.every(i => i.hasAudio), W0 = infos[0].width || 1280, H0 = infos[0].height || 720, w = W0 - (W0 % 2), h = H0 - (H0 % 2), out = 'out.mp4';
    const parts = items.map((_, i) => `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]` + (withAudio ? `;[${i}:a]aresample=44100,aformat=channel_layouts=stereo[a${i}]` : ''));
    const cat = items.map((_, i) => `[v${i}]` + (withAudio ? `[a${i}]` : '')).join('') + `concat=n=${items.length}:v=1:a=${withAudio ? 1 : 0}[v]` + (withAudio ? '[a]' : '');
    const r = await FF.run({ inputs, args: [...ins, '-filter_complex', parts.join(';') + ';' + cat, '-map', '[v]', ...(withAudio ? ['-map', '[a]'] : []), ...H264.v, ...(withAudio ? H264.a : []), '-movflags', '+faststart', out], out, onPct });
    return [mk(`${base} merged.mp4`, r.data)];
  }

  window.Engine = { FF, decode, paint, convertOne, compressOne, trimOne, mergeAll, probe, mk, baseOf, extOf };
})();
