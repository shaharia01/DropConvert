(function () {
  'use strict';
  const F = window.Formats, E = window.Engine, $ = s => document.querySelector(s);
  const h = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    for (const k in (props || {})) { const v = props[k]; if (k === 'style') Object.assign(e.style, v); else if (k === 'text') e.textContent = v; else e[k] = v; }
    kids.flat(9).forEach(c => { if (c != null && c !== false) e.append(c); });
    return e;
  };
  const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const svg = d => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = d; return s; };

  let files = [], tab = 'convert', level = 2, results = [], busy = false, nextId = 1, urls = [], token = 0;
  const trimState = { start: '', end: '', fast: false };
  const selected = () => files.filter(f => f.sel);

  /* ---------- toast + progress ---------- */
  let toastT;
  function toast(msg, ms = 3800) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }
  function prog(label, pct) {
    $('#prog').classList.add('on'); $('#progLabel').textContent = label; const bar = $('#prog .bar');
    if (pct == null) { bar.classList.add('ind'); $('#progPct').textContent = ''; }
    else { bar.classList.remove('ind'); $('#progBar').style.width = Math.round(pct * 100) + '%'; $('#progPct').textContent = Math.round(pct * 100) + '%'; }
  }
  const progOff = () => $('#prog').classList.remove('on');
  E.FF.status = msg => prog(msg, null);

  /* ---------- files ---------- */
  function addFiles(list) {
    for (const f of list) { const name = f.name || 'file', ext = E.extOf(name); files.push({ id: nextId++, name, ext, kind: F.kindOf(ext), blob: f, size: f.size, sel: true }); }
    render();
  }
  function renderFiles() {
    const box = $('#files'); box.innerHTML = '';
    files.forEach((f, i) => {
      const cb = h('input', { type: 'checkbox', checked: f.sel, onchange: () => { f.sel = cb.checked; renderFiles(); renderWork(); } });
      box.append(h('div', { className: 'file' + (f.sel ? ' sel' : '') }, cb, h('span', { className: 'nm', text: f.name }), h('span', { className: 'sz', text: fmtSize(f.size) }),
        h('span', { className: 'badge', text: f.kind === 'other' ? f.ext || '?' : f.kind }), h('button', { className: 'x', text: '✕', title: 'Remove', onclick: () => { files.splice(i, 1); render(); } })));
    });
  }
  $('#pick').onclick = () => $('#file').click();
  $('#file').onchange = e => { const l = [...e.target.files]; e.target.value = ''; if (l.length) addFiles(l); };

  /* ---------- results ---------- */
  const thumbFor = r => {
    const ext = E.extOf(r.name), t = h('div', { className: 'thumb', text: ext });
    if (r.blob.type.startsWith('image/') && !['tiff', 'ico'].includes(ext)) { const im = h('img', { className: 'thumb', alt: '' }); im.onerror = () => im.replaceWith(t); im.src = r.url = URL.createObjectURL(r.blob); return im; }
    return t;
  };
  function addResult(out, src, showWas) {
    let name = out.name; const taken = n => results.some(r => r.kind === 'ok' && r.name === n);
    if (taken(name)) { const i = name.lastIndexOf('.'), b = name.slice(0, i), e = name.slice(i); let k = 1; while (taken(`${b} (${k})${e}`)) k++; name = `${b} (${k})${e}`; }
    results.unshift({ id: nextId++, kind: 'ok', name, blob: out.blob, was: showWas && src ? src.size : 0 });
  }
  const addError = (srcName, e) => results.unshift({ id: nextId++, kind: 'err', text: (srcName ? srcName + ': ' : '') + (e && e.message || e) });
  function renderResults() {
    const box = $('#results'); box.innerHTML = '';
    if (!results.length) return;
    box.append(h('div', { className: 'rhead' }, h('h2', { text: 'Results' }), h('button', { className: 'btn small', text: 'Clear', onclick: () => { results.forEach(r => r.url && URL.revokeObjectURL(r.url)); results = []; renderResults(); } })));
    results.forEach(r => {
      if (r.kind === 'err') { box.append(h('div', { className: 'res err' }, h('div', { className: 'thumb', text: '!' }), h('div', { className: 'rinfo' }, h('div', { className: 't', text: 'Couldn’t finish' }), h('div', { className: 's', text: r.text })),
        h('button', { className: 'x', text: '✕', onclick: () => { results = results.filter(x => x !== r); renderResults(); } }))); return; }
      const save = h('button', { className: 'btn small primary', text: 'Save' }), share = h('button', { className: 'btn small', text: 'Share' });
      save.onclick = async () => { save.disabled = true; try { toast(await IO.save(r.name, r.blob), 5000); } catch (e) { toast('Couldn’t save there (' + (e && e.message || e) + '). Use Share instead and pick Files or Drive.', 7000); } save.disabled = false; };
      share.onclick = async () => { share.disabled = true; try { await IO.share(r.name, r.blob); } catch (e) { if (!/cancel|abort/i.test(String(e && (e.name + e.message)))) toast('Couldn’t share: ' + (e && e.message || e), 6000); } share.disabled = false; };
      box.append(h('div', { className: 'res' }, thumbFor(r), h('div', { className: 'rinfo' }, h('div', { className: 't', text: r.name }), h('div', { className: 's', text: fmtSize(r.blob.size) + (r.was ? ` · was ${fmtSize(r.was)}` : '') })), h('div', { className: 'rbtns' }, save, share)));
    });
  }

  /* ---------- running jobs ---------- */
  async function runTasks(tasks, showWas, extra) {
    if (busy || !tasks.length) return;
    busy = true; document.body.classList.add('busy'); let made = 0;
    try {
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i], lab = (tasks.length > 1 ? `(${i + 1}/${tasks.length}) ` : '') + t.label;
        prog(lab, 0);
        try { const outs = await t.run(p => prog(lab, (i + p) / tasks.length)); outs.forEach(o => addResult(o, t.src, showWas)); made += outs.length; }
        catch (e) { console.error(e); addError(t.src ? t.src.name : '', e); }
      }
    } finally { busy = false; document.body.classList.remove('busy'); progOff(); renderResults(); }
    toast(made ? (made === 1 ? 'Done ✓ — tap Save or Share below' : `Done ✓ — ${made} files ready below`) : 'That didn’t work — see the message below');
    setTimeout(() => { const r = $('#results'); r.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80);
  }

  /* ---------- tabs ---------- */
  const TABS = [
    ['convert', 'Convert', '<path d="M7 7h11l-3-3M17 17H6l3 3"/>'],
    ['compress', 'Compress', '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>'],
    ['trim', 'Trim', '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>'],
    ['merge', 'Merge', '<path d="M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5"/>'],
    ['crop', 'Crop', '<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>'],
    ['bg', 'Background', '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.5"/><path d="m21 15-5-5L5 21"/>']
  ];
  function renderNav() {
    const nav = $('#nav'); nav.innerHTML = '';
    TABS.forEach(([id, label, icon]) => nav.append(h('button', { className: id === tab ? 'on' : '', onclick: () => { tab = id; renderNav(); renderWork(); $('#main').scrollTo({ top: 0 }); } }, svg(icon), h('span', { text: label }))));
  }
  const needFiles = (msg = 'Add some files above first.') => h('div', { className: 'muted', text: msg });
  function render() { renderFiles(); renderWork(); }
  function renderWork() {
    urls.forEach(u => URL.revokeObjectURL(u)); urls = []; token++;
    const w = $('#work'); w.innerHTML = ''; const sel = selected();
    ({ convert: convertPanel, compress: compressPanel, trim: trimPanel, merge: mergePanel, crop: cropPanel, bg: bgPanel })[tab](w, sel);
  }
  const logoLine = (w, sel) => { if (sel.some(f => f.kind === 'video' || f.kind === 'audio')) w.append(h('div', { className: 'muted', text: 'Video and audio are converted by an engine built into the app. Long videos can take several minutes on a phone — keep the app open while it works.' })); };

  /* ---------- convert ---------- */
  function convertPanel(w, sel) {
    w.append(h('h2', { text: 'Convert to…' }));
    if (!sel.length) { w.append(needFiles()); return; }
    const valid = new Set(sel.flatMap(f => F.targetsFor(f.ext)));
    F.GROUPS.forEach(([title, fmts]) => {
      const list = fmts.filter(x => valid.has(x)); if (!list.length) return;
      w.append(h('div', { className: 'group' }, h('div', { className: 'muted', text: title }),
        h('div', { className: 'row' }, list.map(to => h('button', { className: 'chip', text: to.toUpperCase(), onclick: () => { const ok = sel.filter(f => F.targetsFor(f.ext).includes(to)), skipped = sel.length - ok.length; runTasks(ok.map(f => ({ label: `${f.name} → ${to.toUpperCase()}`, src: f, run: p => E.convertOne(f, to, p) })), false, skipped ? ` (skipped ${skipped} that can’t become ${to.toUpperCase()})` : ''); } })))));
    });
    if (!valid.size) w.append(h('div', { className: 'muted', text: 'These file types aren’t supported yet.' }));
    logoLine(w, sel);
    w.append(h('div', { className: 'muted', text: 'Your originals are never changed. Converted files appear under Results, where you can save or share them.' }));
  }

  /* ---------- compress ---------- */
  function compressPanel(w, sel) {
    w.append(h('h2', { text: 'Compress' }));
    if (!sel.length) { w.append(needFiles()); return; }
    w.append(h('div', { className: 'row' }, h('label', { text: 'Strength' }), [['Light', 1], ['Balanced', 2], ['Strong', 3]].map(([l, v]) => h('button', { className: 'chip' + (level === v ? ' on' : ''), text: l, onclick: () => { level = v; renderWork(); } }))));
    const cn = sel.filter(f => ['image', 'video', 'audio', 'pdf'].includes(f.kind)).length;
    if (!cn) { w.append(needFiles('None of the ticked files can be compressed (photos, videos, audio and PDFs can).')); return; }
    w.append(h('button', { className: 'btn primary', text: `Compress ${cn} file${cn > 1 ? 's' : ''}`, onclick: () => { const ok = sel.filter(f => ['image', 'video', 'audio', 'pdf'].includes(f.kind)), skipped = sel.length - ok.length; runTasks(ok.map(f => ({ label: `Compressing ${f.name}`, src: f, run: p => E.compressOne(f, level, p) })), true, skipped ? ` (skipped ${skipped} that can\u2019t be compressed)` : ''); } }));
    logoLine(w, sel);
    w.append(h('div', { className: 'muted', text: 'Photos are resized and re-encoded, videos become smaller MP4s, audio becomes MP3. PDFs are rebuilt from page images (text can no longer be selected).' }));
  }

  /* ---------- trim ---------- */
  function trimPanel(w, sel) {
    w.append(h('h2', { text: 'Trim video or audio' }));
    const f = sel.find(x => x.kind === 'video' || x.kind === 'audio');
    if (!f) { w.append(needFiles('Tick a video or audio file above.')); return; }
    const url = URL.createObjectURL(f.blob); urls.push(url);
    const media = h(f.kind === 'video' ? 'video' : 'audio', { src: url, controls: true, playsInline: true }), s = h('input', { type: 'number', min: 0, step: 0.1, inputMode: 'decimal', value: trimState.start, placeholder: '0' }), e = h('input', { type: 'number', min: 0, step: 0.1, inputMode: 'decimal', value: trimState.end, placeholder: 'end of file' });
    s.oninput = () => trimState.start = s.value; e.oninput = () => trimState.end = e.value;
    const now = inp => () => { inp.value = media.currentTime.toFixed(2); inp.oninput(); };
    const fast = h('input', { type: 'checkbox', checked: trimState.fast, onchange: () => trimState.fast = fast.checked });
    w.append(h('div', { className: 'stage' }, media),
      h('div', { className: 'row' }, h('label', { text: 'Start (s)' }), s, h('button', { className: 'chip', text: 'Start = now', onclick: now(s) })),
      h('div', { className: 'row' }, h('label', { text: 'End (s)' }), e, h('button', { className: 'chip', text: 'End = now', onclick: now(e) })),
      h('label', { className: 'switch' }, fast, h('span', { text: 'Fast mode (instant, but may start a few seconds early)' })),
      h('button', { className: 'btn primary', text: 'Trim', onclick: () => runTasks([{ label: `Trimming ${f.name}`, src: f, run: p => E.trimOne(f, { start: s.value, end: e.value, fast: fast.checked }, p) }]) }));
  }

  /* ---------- merge ---------- */
  function mergePanel(w, sel) {
    w.append(h('h2', { text: 'Merge into one file' }));
    if (sel.length < 2) { w.append(needFiles('Tick two or more files of the same kind (PDFs, photos, videos or audio).')); return; }
    w.append(h('div', { className: 'muted', text: 'Order matters — use the arrows. Photos are merged into one PDF.' }));
    sel.forEach((f, i) => {
      const swap = j => { const a = files.indexOf(f), b = files.indexOf(sel[j]); [files[a], files[b]] = [files[b], files[a]]; render(); };
      w.append(h('div', { className: 'file' }, h('span', { text: i + 1 + '.' }), h('span', { className: 'nm', text: f.name }), h('button', { className: 'x', text: '↑', onclick: () => i > 0 && swap(i - 1) }), h('button', { className: 'x', text: '↓', onclick: () => i < sel.length - 1 && swap(i + 1) })));
    });
    logoLine(w, sel);
    w.append(h('button', { className: 'btn primary', text: `Merge ${sel.length} files`, onclick: () => runTasks([{ label: `Merging ${sel.length} files`, src: sel[0], run: p => E.mergeAll(selected(), p) }]) }));
  }

  /* ---------- crop ---------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dims = b => ({ w: b.naturalWidth || b.width, h: b.naturalHeight || b.height });
  const pngBlob = c => new Promise(r => c.toBlob(r, 'image/png'));
  async function cropPanel(w, sel) {
    w.append(h('h2', { text: 'Crop a photo' }));
    const f = sel.find(x => x.kind === 'image'); if (!f) { w.append(needFiles('Tick a photo above.')); return; }
    const my = token; w.append(h('div', { className: 'muted', text: 'Loading…' }));
    let img; try { img = await E.decode(f.blob, f.ext); } catch (e) { if (my === token) { w.innerHTML = ''; w.append(h('h2', { text: 'Crop a photo' }), needFiles('Could not open that photo.')); } return; }
    if (my !== token) return; w.innerHTML = ''; w.append(h('h2', { text: 'Crop a photo' }));
    const { w: IW, h: IH } = dims(img); let ratio = 0, sel_ = { x: 0, y: 0, w: IW, h: IH };
    const cv = h('canvas'), g = cv.getContext('2d'), maxW = Math.min((w.clientWidth || 340) - 30, 700), maxH = innerHeight * 0.45, s = Math.min(maxW / IW, maxH / IH, 1);
    cv.width = Math.max(1, Math.round(IW * s)); cv.height = Math.max(1, Math.round(IH * s));
    const draw = () => {
      g.clearRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
      const k = IW / cv.width, x = sel_.x / k, y = sel_.y / k, ww = sel_.w / k, hh = sel_.h / k;
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 0, cv.width, y); g.fillRect(0, y + hh, cv.width, cv.height - y - hh); g.fillRect(0, y, x, hh); g.fillRect(x + ww, y, cv.width - x - ww, hh);
      g.strokeStyle = '#22d3ee'; g.lineWidth = 2; g.strokeRect(x, y, ww, hh); g.fillStyle = '#22d3ee';
      [[x, y], [x + ww, y], [x, y + hh], [x + ww, y + hh]].forEach(([cx, cy]) => g.fillRect(cx - 8, cy - 8, 16, 16));
    };
    const pt = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * IW / r.width, y: (e.clientY - r.top) * IH / r.height }; };
    const fromAnchor = (a, c) => {
      c = { x: clamp(c.x, 0, IW), y: clamp(c.y, 0, IH) }; let ww = c.x - a.x, hh = c.y - a.y;
      if (ratio) { const sx = ww < 0 ? -1 : 1, sy = hh < 0 ? -1 : 1; let aw = Math.abs(ww), ah = aw / ratio; if (ah > Math.abs(hh)) { ah = Math.abs(hh); aw = ah * ratio; } const mw = sx > 0 ? IW - a.x : a.x, mh = sy > 0 ? IH - a.y : a.y; if (aw > mw) { aw = mw; ah = aw / ratio; } if (ah > mh) { ah = mh; aw = ah * ratio; } ww = sx * aw; hh = sy * ah; }
      sel_ = { x: Math.min(a.x, a.x + ww), y: Math.min(a.y, a.y + hh), w: Math.abs(ww), h: Math.abs(hh) };
    };
    const fit = () => { if (!ratio) { sel_ = { x: 0, y: 0, w: IW, h: IH }; return; } let ww = IW, hh = ww / ratio; if (hh > IH) { hh = IH; ww = hh * ratio; } sel_ = { x: (IW - ww) / 2, y: (IH - hh) / 2, w: ww, h: hh }; };
    let mode = null, anchor = null, grab = null;
    cv.onpointerdown = e => {
      cv.setPointerCapture(e.pointerId); const p = pt(e), tol = 30 * IW / cv.getBoundingClientRect().width;
      const cs = [[sel_.x, sel_.y], [sel_.x + sel_.w, sel_.y], [sel_.x, sel_.y + sel_.h], [sel_.x + sel_.w, sel_.y + sel_.h]], hit = cs.findIndex(([cx, cy]) => Math.abs(p.x - cx) < tol && Math.abs(p.y - cy) < tol);
      if (hit >= 0) { mode = 'resize'; anchor = { x: cs[3 - hit][0], y: cs[3 - hit][1] }; }
      else if (p.x > sel_.x && p.x < sel_.x + sel_.w && p.y > sel_.y && p.y < sel_.y + sel_.h) { mode = 'move'; grab = { dx: p.x - sel_.x, dy: p.y - sel_.y }; }
      else { mode = 'resize'; anchor = p; sel_ = { x: p.x, y: p.y, w: 0, h: 0 }; }
    };
    cv.onpointermove = e => { if (!mode) return; const p = pt(e); if (mode === 'move') { sel_.x = clamp(p.x - grab.dx, 0, IW - sel_.w); sel_.y = clamp(p.y - grab.dy, 0, IH - sel_.h); } else fromAnchor(anchor, p); draw(); };
    cv.onpointerup = cv.onpointercancel = () => { mode = null; };
    const ar = h('div', { className: 'row' }, h('label', { text: 'Shape' }));
    [['Free', 0], ['1:1', 1], ['16:9', 16 / 9], ['9:16', 9 / 16], ['4:3', 4 / 3], ['3:4', 3 / 4]].forEach(([l, v]) => ar.append(h('button', { className: 'chip' + (v === 0 ? ' on' : ''), text: l, onclick: e => { ar.querySelectorAll('.chip').forEach(c => c.classList.remove('on')); e.currentTarget.classList.add('on'); ratio = v; fit(); draw(); } })));
    const go = h('button', { className: 'btn primary', text: 'Save cropped copy', onclick: async () => {
      const ww = Math.max(1, Math.round(sel_.w)), hh = Math.max(1, Math.round(sel_.h)), o = h('canvas'); o.width = ww; o.height = hh;
      o.getContext('2d').drawImage(img, sel_.x, sel_.y, sel_.w, sel_.h, 0, 0, ww, hh);
      addResult({ name: `${E.baseOf(f.name)} Cropped.png`, blob: await pngBlob(o) }); renderResults(); toast('Cropped ✓ — tap Save or Share below'); setTimeout(() => $('#results').scrollIntoView({ behavior: 'smooth' }), 80);
    } });
    w.append(h('div', { className: 'stage' }, cv), h('div', { className: 'muted', text: 'Drag the corners, drag inside to move, or drag on the photo to start a new box.' }), ar, go); fit(); draw();
  }

  /* ---------- background ---------- */
  const PRESETS = [['#ffb23f', '#ff5f4a', '#e8407a'], ['#7b6cf0', '#4facfe', '#00f2fe'], ['#11998e', '#38ef7d', '#b8f5c8'], ['#fc5c7d', '#6a82fb', '#6a82fb'], ['#f6d365', '#fda085', '#fda085'], ['#0f0c29', '#302b63', '#24243e'], ['#ffffff', '#e9ecf5', '#dfe3f0'], ['#232526', '#414345', '#232526']];
  function renderBg(img, o, sc = 1) {
    const { w, h: ih } = dims(img), m = Math.max(w, ih), pad = Math.round(m * o.pad / 100), c = h('canvas');
    c.width = Math.max(1, Math.round((w + pad * 2) * sc)); c.height = Math.max(1, Math.round((ih + pad * 2) * sc));
    const g = c.getContext('2d'), p = PRESETS[o.preset], gr = g.createLinearGradient(0, 0, c.width, c.height); gr.addColorStop(0, p[0]); gr.addColorStop(.5, p[1]); gr.addColorStop(1, p[2]); g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
    g.scale(sc, sc); const r = Math.min(o.radius * m / 100, w / 2, ih / 2);
    g.save(); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = o.shadow * m / 50 * sc; g.shadowOffsetY = o.shadow * m / 100 * sc; g.beginPath(); g.roundRect(pad, pad, w, ih, r); g.fillStyle = '#fff'; g.fill(); g.restore();
    g.save(); g.beginPath(); g.roundRect(pad, pad, w, ih, r); g.clip(); g.drawImage(img, pad, pad); g.restore(); return c;
  }
  async function bgPanel(w, sel) {
    w.append(h('h2', { text: 'Put a photo on a background' }));
    const f = sel.find(x => x.kind === 'image'); if (!f) { w.append(needFiles('Tick a photo above.')); return; }
    const my = token; w.append(h('div', { className: 'muted', text: 'Loading…' }));
    let img; try { img = await E.decode(f.blob, f.ext); } catch (e) { if (my === token) { w.innerHTML = ''; w.append(h('h2', { text: 'Put a photo on a background' }), needFiles('Could not open that photo.')); } return; }
    if (my !== token) return; w.innerHTML = ''; w.append(h('h2', { text: 'Put a photo on a background' }));
    const o = { preset: 0, pad: 10, radius: 2, shadow: 3 }, prev = h('canvas', { style: { maxWidth: '100%', maxHeight: '42vh' } }), { w: IW, h: IH } = dims(img);
    const paint = () => { const pad = Math.round(Math.max(IW, IH) * o.pad / 100), sc = Math.min(1, 900 / (Math.max(IW, IH) + pad * 2)), c = renderBg(img, o, sc); prev.width = c.width; prev.height = c.height; prev.getContext('2d').drawImage(c, 0, 0); };
    const sw = h('div', { className: 'row' }, h('label', { text: 'Colors' }));
    PRESETS.forEach((p, i) => { const s = h('div', { className: 'sw' + (i === 0 ? ' on' : '') }); s.style.background = `linear-gradient(135deg,${p.join(',')})`; s.onclick = () => { sw.querySelectorAll('.sw').forEach(x => x.classList.remove('on')); s.classList.add('on'); o.preset = i; paint(); }; sw.append(s); });
    const slider = (label, key, min, max, step) => { const r = h('input', { type: 'range', min, max, step, value: o[key] }); r.oninput = () => { o[key] = +r.value; paint(); }; return h('div', { className: 'row' }, h('label', { text: label }), r); };
    const go = h('button', { className: 'btn primary', text: 'Save with background', onclick: async () => {
      go.disabled = true; try { addResult({ name: `${E.baseOf(f.name)} Background.png`, blob: await pngBlob(renderBg(img, o, 1)) }); renderResults(); toast('Done ✓ — tap Save or Share below'); setTimeout(() => $('#results').scrollIntoView({ behavior: 'smooth' }), 80); } catch (e) { toast('That photo is too big to put on a background: ' + e.message); } go.disabled = false;
    } });
    w.append(h('div', { className: 'stage' }, prev), sw, slider('Padding', 'pad', 0, 30, 1), slider('Corners', 'radius', 0, 10, .5), slider('Shadow', 'shadow', 0, 10, .5), go); paint();
  }

  window.__app = { addFiles, get results() { return results; }, get files() { return files; }, runTasks };
  renderNav(); render();
})();
