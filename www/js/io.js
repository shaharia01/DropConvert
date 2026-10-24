// Saving and sharing results. On the phone this uses native plugins; in a browser it falls back to a normal download.
(function () {
  'use strict';
  const Cap = window.Capacitor;
  const native = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
  const plug = n => (Cap && ((Cap.Plugins && Cap.Plugins[n]) || (Cap.registerPlugin && Cap.registerPlugin(n)))) || null;
  const b64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('could not read the file')); r.readAsDataURL(blob); });
  const safe = n => n.replace(/[\\/:*?"<>|]/g, '_');

  function browserDownload(name, blob) {
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  // Write a blob into the app's cache in 3 MB pieces (so big videos don't choke the bridge). Returns the file:// uri.
  async function toCache(name, blob) {
    const FS = plug('Filesystem'), path = `tmp/${Date.now()}-${safe(name)}`, CH = 3 * 1024 * 1024;
    for (let off = 0, first = true; off < blob.size || first; off += CH, first = false) {
      const data = await b64(blob.slice(off, off + CH));
      if (first) await FS.writeFile({ path, data, directory: 'CACHE', recursive: true });
      else await FS.appendFile({ path, data, directory: 'CACHE' });
    }
    const { uri } = await FS.getUri({ path, directory: 'CACHE' });
    return { uri, path };
  }
  const cleanup = async path => { try { await plug('Filesystem').deleteFile({ path, directory: 'CACHE' }); } catch {} };

  async function save(name, blob) {
    if (!native) { browserDownload(name, blob); return 'Downloaded'; }
    const { uri, path } = await toCache(name, blob);
    try {
      const SF = plug('SaveFile');
      if (!SF) throw new Error('the save helper is missing');
      await SF.copyToDownloads({ uri, name: safe(name), mime: blob.type || 'application/octet-stream' });
      return 'Saved to Downloads › DropConvert (open the Files app)';
    } finally { cleanup(path); }
  }
  async function share(name, blob) {
    if (native) {
      const { uri, path } = await toCache(name, blob);
      try { await plug('Share').share({ title: name, files: [uri], dialogTitle: 'Send or save ' + name }); }
      finally { setTimeout(() => cleanup(path), 60000); }
      return;
    }
    const f = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name }); return; }
    browserDownload(name, blob);
  }
  window.IO = { save, share, native };
})();
