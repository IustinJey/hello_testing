/* Recorder Modal — Glassmorphism (v1.5)
   - apxRecorderOpen()
   - Modes: Video+Audio (default) or Audio-only
   - Actions: Record / Stop / Retake / Delete / Download / Send (stub)
   - Robustness:
     • Finite state machine (LIVE → RECORDING → PROCESSING → PREVIEW → LIVE)
     • Button debouncing + state guards, safe-stream/recorder teardown
     • Mode-switch while recording prompts + safe stop
     • Track-ended/permission errors handled with recoverable ERROR state
     • Close/visibilitychange during recording = safe stop + cleanup
     • Preview always hides/stops live camera; Retake reliably reopens camera
*/

(function(){
  const qs=(s,r=document)=>r.querySelector(s);
  const qsa=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const el=(t,c)=>{const n=document.createElement(t); if(c) n.className=c; return n;};

  // ===== Styles (same as v1.3) =====
  const css = `
  :root{ --ink:#0b1220; --muted:#6b7280; --line:rgba(0,0,0,.08); --dk:#111827; --glass:rgba(255,255,255,.36); }
  .recx{ position:fixed; inset:0; display:none; place-items:center; padding:2vmin; z-index:30 }
  .recx-box{ width:min(92vmin,720px); height:min(92vmin,720px);
    border-radius:28px; background:var(--glass); border:1px solid rgba(255,255,255,.8);
    box-shadow:0 28px 80px rgba(10,15,30,.18), inset 0 1px 0 rgba(255,255,255,.72);
    backdrop-filter: blur(40px) saturate(1.12); -webkit-backdrop-filter: blur(40px) saturate(1.12);
    display:grid; grid-template-rows:56px 1fr 72px; overflow:hidden;
    transform:scale(.985); opacity:0; animation:recxIn .35s ease .05s forwards; }
  @keyframes recxIn{ to{ transform:scale(1); opacity:1 } }

  .recx-hd{ display:flex; align-items:center; gap:10px; padding:10px 12px; position:relative }
  .recx-ttl{ font-weight:900; letter-spacing:-.01em; font-size:15px }
  .recx-x{ margin-left:auto; appearance:none; width:32px; height:32px; border-radius:999px;
    border:1px solid var(--line); background:#fff; display:grid; place-items:center; cursor:pointer }

  .recx-st{ position:relative; padding:12px; overflow:hidden; }
  .panel{
    height:100%;
    width:min(92%,640px);
    margin:0 auto;
    display:grid;
    grid-template-rows: auto 1fr auto; /* top controls / preview / playback */
    gap:12px;
  }

  .toprow{ display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap }
  .seg{ display:inline-flex; border:1px solid var(--line); border-radius:12px; background:#fff; padding:4px }
  .seg button{ appearance:none; border:none; background:transparent; padding:8px 10px; border-radius:10px; font-weight:900; cursor:pointer; display:flex; align-items:center; gap:8px }
  .seg button[aria-pressed="true"]{ background:#0f172a; color:#fff }
  .meta{ flex:1 1 auto; min-width:180px; display:flex; gap:12px; align-items:center; justify-content:flex-end; color:#6b7280; font-weight:800; font-size:13px }

  .surfaceWrap{ display:grid; align-items:center; justify-items:center; min-height:0 }
  .surface{
    position:relative; border-radius:18px; overflow:hidden;
    background:#000; border:1px solid rgba(0,0,0,.08);
    width:100%; max-height:100%; aspect-ratio:16/9;
    display:grid; place-items:center;
  }
  video.recx-vid, audio.recx-aud{ width:100%; height:100%; object-fit:contain; display:block; background:#000 }
  .mic-only{ display:grid; place-items:center; color:#111827; background:#fff; width:100%; height:100% }
  .mic-only .icon{ font-size:64px; }
  .badge{ position:absolute; right:12px; top:12px; background:#ffffffcc; border:1px solid var(--line);
    border-radius:999px; padding:6px 10px; font-weight:900; font-size:12.5px; letter-spacing:.2px }

  .playback{ display:none; width:100% }
  .playback video, .playback audio{ width:100% }

  .recx-ft{ padding:0; border-top:1px solid var(--line); background:transparent; display:block }
  .segbar{
    display:grid; grid-template-columns: repeat(6, 1fr);
    width:100%; height:100%;
    background:#fff; border-top:1px solid var(--line);
    border-radius:0 0 28px 28px; overflow:hidden;
  }
  .btn{ appearance:none; border:0; border-right:1px solid var(--line);
    background:#fff; padding:14px 10px; font-weight:900; cursor:pointer;
    display:inline-flex; align-items:center; justify-content:center; gap:8px; line-height:1; user-select:none }
  .btn:last-child{ border-right:0 }
  .btn.primary{ background:#111827; color:#fff }
  .btn.red{ background:#b91c1c; color:#fff }
  .btn[disabled]{ opacity:.55; cursor:not-allowed }

  @media (max-width:560px){
    .recx-box{ width:96vmin; height:96vmin }
    .segbar{ grid-template-columns: repeat(3, 1fr); grid-auto-rows:1fr }
  }
  `;
  document.head.appendChild(Object.assign(document.createElement('style'),{textContent:css}));

  // ===== DOM =====
  const overlay = el('div','recx'); overlay.id = 'recxOverlay';
  overlay.innerHTML = `
    <div class="recx-box" role="dialog" aria-modal="true">
      <header class="recx-hd">
        <div class="recx-ttl"><i class="ri-voiceprint-line" style="margin-right:6px"></i> Record a quick reply</div>
        <button class="recx-x" id="recxClose" aria-label="Close"><i class="ri-close-line"></i></button>
      </header>

      <main class="recx-st">
        <div class="panel">
          <div class="toprow">
            <div class="seg" role="tablist" aria-label="Capture mode">
              <button id="modeVA" role="tab" aria-selected="true" aria-pressed="true"><i class="ri-movie-line"></i> Video + Audio</button>
              <button id="modeA"  role="tab" aria-selected="false" aria-pressed="false"><i class="ri-mic-line"></i> Audio only</button>
            </div>
            <div class="meta" id="metaInfo" aria-live="polite"></div>
          </div>

          <div class="surfaceWrap" id="surfaceWrap">
            <div class="surface" id="surface">
              <video id="liveVideo" class="recx-vid" playsinline muted autoplay></video>
              <div id="micCard" class="mic-only" style="display:none">
                <div style="display:grid; justify-items:center; gap:8px">
                  <i class="icon ri-mic-2-line"></i>
                  <div style="font-weight:900">Audio-only</div>
                </div>
              </div>
              <div class="badge" id="stateBadge">Idle</div>
            </div>
          </div>

          <div class="playback" id="playbackArea">
            <video id="playbackVideo" class="recx-vid" controls style="display:none"></video>
            <audio id="playbackAudio" class="recx-aud" controls style="display:none"></audio>
          </div>
        </div>
      </main>

      <footer class="recx-ft">
        <div class="segbar">
          <button class="btn primary" id="btnRecord"><i class="ri-record-circle-line"></i> Record</button>
          <button class="btn red" id="btnStop" disabled><i class="ri-stop-circle-line"></i> Stop</button>
          <button class="btn" id="btnRetake" disabled><i class="ri-restart-line"></i> Retake</button>
          <button class="btn" id="btnDelete" disabled><i class="ri-delete-bin-line"></i> Delete</button>
          <button class="btn" id="btnDownload" disabled><i class="ri-download-2-line"></i> Download</button>
          <button class="btn primary" id="btnSend" disabled><i class="ri-send-plane-2-line"></i> Send</button>
        </div>
      </footer>
    </div>
  `;
  document.body.appendChild(overlay);

  // ===== State machine =====
  const STATE = { LIVE:'live', RECORDING:'rec', PROCESSING:'proc', PREVIEW:'prev', ERROR:'err', CLOSED:'closed' };
  let state = STATE.LIVE;
  let busy = false; // simple mutex to block re-entrant ops

  // Media fields
  let mode = 'video';   // 'video' | 'audio'
  let stream = null;
  let recorder = null;
  let chunks = [];
  let blob = null;
  let blobUrl = null;
  let mime = '';
  let recStart = 0;
  let ticker = null;

  // Elements
  const surfaceWrap   = qs('#surfaceWrap');
  const liveVideo     = qs('#liveVideo');
  const micCard       = qs('#micCard');
  const playbackArea  = qs('#playbackArea');
  const playbackVideo = qs('#playbackVideo');
  const playbackAudio = qs('#playbackAudio');
  const metaInfo      = qs('#metaInfo');
  const stateBadge    = qs('#stateBadge');

  const btnRecord   = qs('#btnRecord');
  const btnStop     = qs('#btnStop');
  const btnRetake   = qs('#btnRetake');
  const btnDelete   = qs('#btnDelete');
  const btnDownload = qs('#btnDownload');
  const btnSend     = qs('#btnSend');
  const modeVA      = qs('#modeVA');
  const modeA       = qs('#modeA');

  // ===== Helpers =====
  const once = (fn)=>{ let inFlight=false; return async (...a)=>{ if(inFlight) return; inFlight=true; try{ await fn(...a);} finally{ inFlight=false; } }; };
  function setBadge(txt){ stateBadge.textContent = txt; }
  function fmtBytes(n){ if(n==null) return ''; const u=['B','KB','MB','GB']; let i=0; while(n>=1024&&i<u.length-1){n/=1024;i++;} return `${n.toFixed(n<10&&i>0?1:0)} ${u[i]}`; }
  function fmtTime(sec){ sec=Math.max(0,Math.floor(sec)); const m=Math.floor(sec/60), s=sec%60; return `${m}:${String(s).padStart(2,'0')}`; }
  function revokeBlob(){ if(blobUrl){ URL.revokeObjectURL(blobUrl); blobUrl=null; } }
  function clearBlob(){
    revokeBlob(); blob=null; chunks=[];
    playbackVideo.removeAttribute('src'); playbackVideo.style.display='none';
    playbackAudio.removeAttribute('src'); playbackAudio.style.display='none';
    playbackArea.style.display='none';
  }
  function stopStream(){
    if (!stream) return;
    try{ stream.getTracks().forEach(t=>t.stop()); }catch{}
    stream=null;
    if (liveVideo) liveVideo.srcObject=null;
  }
  function stopRecorderSync(){
    try{ if(recorder && recorder.state==='recording'){ recorder.stop(); } }catch{}
    recorder=null;
    if (ticker){ clearInterval(ticker); ticker=null; }
  }
  function updateMeta(extra=''){
    const parts=[];
    parts.push(mode==='video'?'Mode: Video+Audio':'Mode: Audio-only');
    if (state===STATE.RECORDING){
      const t=(performance.now()-recStart)/1000;
      parts.push(`Rec: ${fmtTime(t)}`);
    }
    if (blob) parts.push(`Size: ${fmtBytes(blob.size)}`);
    if (extra) parts.push(extra);
    metaInfo.textContent = parts.join('  •  ');
  }
  function chooseMime(){
    const candidates = mode==='video'
      ? ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']
      : ['audio/webm;codecs=opus','audio/webm'];
    mime = candidates.find(t=> MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    return mime;
  }
  function setButtons(){
    // default all disabled, then enable per state
    const D = (b, on)=>{ b.disabled = !on; };
    switch(state){
      case STATE.LIVE:
        D(btnRecord,true); D(btnStop,false); D(btnRetake,false); D(btnDelete,false); D(btnDownload,false); D(btnSend,false);
        break;
      case STATE.RECORDING:
        D(btnRecord,false); D(btnStop,true); D(btnRetake,false); D(btnDelete,false); D(btnDownload,false); D(btnSend,false);
        break;
      case STATE.PROCESSING:
        D(btnRecord,false); D(btnStop,false); D(btnRetake,false); D(btnDelete,false); D(btnDownload,false); D(btnSend,false);
        break;
      case STATE.PREVIEW:
        D(btnRecord,false); D(btnStop,false); D(btnRetake,true); D(btnDelete,true); D(btnDownload,!!blob); D(btnSend,!!blob);
        break;
      case STATE.ERROR:
        D(btnRecord,true); D(btnStop,false); D(btnRetake,false); D(btnDelete,!!blob); D(btnDownload,!!blob); D(btnSend,false);
        break;
      default:
        D(btnRecord,false); D(btnStop,false); D(btnRetake,false); D(btnDelete,false); D(btnDownload,false); D(btnSend,false);
    }
  }
  function showLive(show){
    surfaceWrap.style.display = show ? 'grid' : 'none';
    playbackArea.style.display = show ? 'none' : (blob ? 'block' : 'none');
  }

  // ===== Stream setup =====
  async function ensureStream(){
    if (busy) return;
    busy = true;
    try{
      stopRecorderSync();
      stopStream();
      clearBlob();
      showLive(true);
      setBadge('Idle');
      state = STATE.LIVE; setButtons(); updateMeta();

      const constraints = mode==='video'
        ? { video:{width:{ideal:1280},height:{ideal:720}}, audio:true }
        : { audio:true };

      try{
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      }catch(err){
        console.error('getUserMedia failed', err);
        state = STATE.ERROR; setBadge('No camera/mic'); setButtons();
        updateMeta('Permissions needed — allow access then Retake/Record.');
        return;
      }

      // track-ended resilience (device unplugged / permission toggled)
      for (const t of stream.getTracks()){
        t.onended = ()=> {
          if (state===STATE.RECORDING) stopRecorderSync();
          stopStream();
          state = STATE.ERROR; setBadge('Input lost'); setButtons();
          updateMeta('Device disconnected. Click Retake or switch mode.');
        };
      }

      if (mode==='video'){
        micCard.style.display='none';
        liveVideo.style.display='block';
        liveVideo.srcObject = stream;
        try{ await liveVideo.play(); }catch{ /* autoplay may fail; noop */ }
      }else{
        liveVideo.pause(); liveVideo.style.display='none';
        micCard.style.display='grid';
      }
    } finally { busy = false; }
  }

  // ===== Recording flow =====
  async function startRecording(){
    if (state!==STATE.LIVE || busy) return;
    busy = true;
    try{
      clearBlob();
      chooseMime();
      try{
        recorder = new MediaRecorder(stream, mime?{mimeType:mime}:{});
      }catch(err){
        console.error('MediaRecorder error', err);
        state = STATE.ERROR; setBadge('Unsupported'); setButtons();
        updateMeta('Recording not supported in this browser.');
        return;
      }

      chunks = [];
      recorder.ondataavailable = e=>{ if(e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = onStop;
      recorder.start();
      recStart = performance.now();

      state = STATE.RECORDING; setBadge('Recording'); setButtons();
      if (ticker) clearInterval(ticker);
      ticker = setInterval(()=> updateMeta(), 250);
      updateMeta();
    } finally { busy = false; }
  }

  async function stopRecording(){
    if (state!==STATE.RECORDING || busy) return;
    busy = true;
    try{
      state = STATE.PROCESSING; setBadge('Processing…'); setButtons();
      if (ticker){ clearInterval(ticker); ticker=null; }
      try{ recorder.stop(); }catch{}
    } finally { busy = false; }
  }

  function onStop(){
    try{
      blob = new Blob(chunks, {type: mime || (mode==='video'?'video/webm':'audio/webm')});
      revokeBlob();
      blobUrl = URL.createObjectURL(blob);

      stopStream();                 // kill live stream
      showLive(false);              // hide live, show playback

      if (mode==='video'){
        playbackAudio.style.display='none';
        playbackVideo.style.display='block';
        playbackVideo.src = blobUrl;
        playbackVideo.play().catch(()=>{});
      }else{
        playbackVideo.style.display='none';
        playbackAudio.style.display='block';
        playbackAudio.src = blobUrl;
        playbackAudio.play().catch(()=>{});
      }

      state = STATE.PREVIEW; setBadge('Recorded'); setButtons(); updateMeta();
    }catch(err){
      console.error('onStop error', err);
      state = STATE.ERROR; setBadge('Save failed'); setButtons();
      updateMeta('Could not finalize recording.');
    }finally{
      recorder=null;
    }
  }

  const retake = once(async ()=>{
    // Works from PREVIEW or ERROR
    clearBlob();
    await ensureStream();
  });

  const delRecording = once(async ()=>{
    clearBlob();
    setBadge(state===STATE.PREVIEW ? 'Deleted' : 'Idle');
    // stay in PREVIEW? we just cleared; go to ERROR/LIVE appropriately
    if (stream){ state = STATE.LIVE; showLive(true); }
    else { state = STATE.LIVE; await ensureStream(); }
    setButtons(); updateMeta();
  });

  function download(){
    if (!blob) return;
    const a = document.createElement('a');
    const ext = (mode==='video' ? 'webm' : 'webm');
    a.href = blobUrl; a.download = `reply.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function sendStub(){
    if (!blob) return;
    // Hook to backend:
    // const form = new FormData(); form.append('file', blob, `reply.${mode==='video'?'webm':'webm'}`);
    // await fetch('/upload', { method:'POST', body: form });
    console.log('🚀 Ready to send', { bytes: blob.size, type: blob.type, mode });
    setBadge('Queued'); updateMeta();
  }

  // ===== Public API =====
  window.apxRecorderOpen = async function(){
    overlay.style.display='grid';
    // default select
    modeVA.setAttribute('aria-pressed','true'); modeVA.setAttribute('aria-selected','true');
    modeA.setAttribute('aria-pressed','false'); modeA.setAttribute('aria-selected','false');
    await ensureStream();
  };

  // ===== Events & guards =====
  qs('#recxClose').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e)=>{ if (e.target===overlay) closeModal(); });

  function closeModal(){
    // stop recording if needed, cleanup
    stopRecorderSync();
    stopStream();
    clearBlob();
    overlay.style.display='none';
    state = STATE.CLOSED;
  }

  // Mode switches (guard against recording)
  modeVA.addEventListener('click', async ()=>{
    if (mode==='video') return;
    if (state===STATE.RECORDING){
      if (!confirm('Stop recording and switch to Video + Audio?')) return;
      await stopRecording();
    }
    mode='video';
    modeVA.setAttribute('aria-pressed','true'); modeVA.setAttribute('aria-selected','true');
    modeA.setAttribute('aria-pressed','false'); modeA.setAttribute('aria-selected','false');
    await ensureStream(); setButtons(); updateMeta();
  });

  modeA.addEventListener('click', async ()=>{
    if (mode==='audio') return;
    if (state===STATE.RECORDING){
      if (!confirm('Stop recording and switch to Audio-only?')) return;
      await stopRecording();
    }
    mode='audio';
    modeA.setAttribute('aria-pressed','true'); modeA.setAttribute('aria-selected','true');
    modeVA.setAttribute('aria-pressed','false'); modeVA.setAttribute('aria-selected','false');
    await ensureStream(); setButtons(); updateMeta();
  });

  // Controls (debounced)
  btnRecord.addEventListener('click', once(startRecording));
  btnStop.addEventListener('click', once(stopRecording));
  btnRetake.addEventListener('click', retake);
  btnDelete.addEventListener('click', delRecording);
  btnDownload.addEventListener('click', download);
  btnSend.addEventListener('click', sendStub);

  // Auto-stop if user switches tab (prevents “ghost” capture)
  document.addEventListener('visibilitychange', ()=>{
    if (document.hidden && state===STATE.RECORDING) stopRecording();
  });

  // HTTPS heads-up
  if (location.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(location.hostname)) {
    console.warn('Media capture requires HTTPS in most browsers.');
  }
})();
