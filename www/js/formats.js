// Which file types exist and what each can be turned into (same rules as the desktop app).
(function () {
  const EXT = {
    image: ['png','jpg','jpeg','jfif','webp','bmp','tif','tiff','gif','ico','avif'],
    video: ['mp4','m4v','mov','mkv','avi','webm','wmv','flv','mpg','mpeg','3gp','ts','mts','m2ts','ogv'],
    audio: ['mp3','wav','m4a','aac','ogg','opus','flac','aiff','aif','wma','amr'],
    pdf:   ['pdf'],
    doc:   ['docx'],
    text:  ['txt','md','markdown','html','htm','csv','log','json']
  };
  const IMAGE_OUT = ['png','jpg','webp','bmp','tiff','ico','gif'];
  const VIDEO_OUT = ['mp4','webm','mov','mkv','avi','m4v','wmv','flv','gif'];
  const AUDIO_OUT = ['mp3','wav','m4a','aac','ogg','opus','flac','aiff','wma'];
  const GROUPS = [
    ['Images', ['png','jpg','webp','bmp','tiff','ico','gif']],
    ['Video', ['mp4','webm','mov','mkv','avi','m4v','wmv','flv']],
    ['Audio', ['mp3','wav','m4a','aac','ogg','opus','flac','aiff','wma']],
    ['Documents', ['pdf','docx','txt','html']]
  ];
  const MIME = {
    png:'image/png', jpg:'image/jpeg', webp:'image/webp', gif:'image/gif', bmp:'image/bmp', tiff:'image/tiff', ico:'image/x-icon',
    mp4:'video/mp4', m4v:'video/mp4', webm:'video/webm', mov:'video/quicktime', mkv:'video/x-matroska', avi:'video/x-msvideo', wmv:'video/x-ms-wmv', flv:'video/x-flv',
    mp3:'audio/mpeg', wav:'audio/wav', m4a:'audio/mp4', aac:'audio/aac', ogg:'audio/ogg', opus:'audio/ogg', flac:'audio/flac', aiff:'audio/aiff', wma:'audio/x-ms-wma',
    pdf:'application/pdf', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt:'text/plain', html:'text/html'
  };
  const clean = e => String(e || '').toLowerCase().replace(/^\./, '');
  function kindOf(ext) {
    ext = clean(ext);
    for (const k of Object.keys(EXT)) if (EXT[k].includes(ext)) return k;
    return 'other';
  }
  const norm = to => { to = clean(to); return to === 'jpeg' ? 'jpg' : to === 'tif' ? 'tiff' : to; };
  function targetsFor(ext) {
    const kind = kindOf(ext); ext = norm(ext);
    let t = [];
    if (kind === 'image') { t = [...IMAGE_OUT, 'pdf', 'docx']; if (ext === 'gif') t.push('mp4', 'webm', 'mov'); }
    else if (kind === 'video') t = [...VIDEO_OUT, ...AUDIO_OUT, 'png', 'jpg', 'webp'];
    else if (kind === 'audio') t = [...AUDIO_OUT];
    else if (kind === 'pdf') t = ['png', 'jpg', 'txt'];
    else if (kind === 'doc') t = ['pdf', 'txt', 'html'];
    else if (kind === 'text') t = ['pdf', 'docx', 'html'];
    return t.filter(x => x !== ext && x !== (ext === 'jfif' ? 'jpg' : ''));
  }
  window.Formats = { EXT, IMAGE_OUT, VIDEO_OUT, AUDIO_OUT, GROUPS, MIME, kindOf, norm, targetsFor, clean,
    mime: e => MIME[clean(e)] || 'application/octet-stream' };
})();
