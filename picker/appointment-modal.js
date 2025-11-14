(function(){
  // ---------- Shortcuts ----------
  const qs  = (s, r=document)=>r.querySelector(s);
  const qsa = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const el  = (tag, cls)=>{ const n=document.createElement(tag); if(cls) n.className=cls; return n; };
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

  // ---------- Styles for modal (scoped) ----------
  const css = `
  :root{ --ink:#0b1220; --muted:#6b7280; --line:rgba(0,0,0,.08); --dk:#111827;
         --glass:rgba(255,255,255,.34); --ylw:#FDE047; --grn:#22C55E; }
  .apx{ position:fixed; inset:0; display:none; place-items:center; padding:2vmin; z-index:10 }
  .apx-box{ width:min(92vmin,700px); height:min(92vmin,700px); /* ~600–680 visible on laptops */
    border-radius:28px; background:var(--glass); border:1px solid rgba(255,255,255,.8);
    box-shadow:0 28px 80px rgba(10,15,30,.18), inset 0 1px 0 rgba(255,255,255,.72);
    backdrop-filter: blur(36px) saturate(1.12); -webkit-backdrop-filter: blur(36px) saturate(1.12);
    display:grid; grid-template-rows:56px 1fr 68px; overflow:hidden; transform:scale(.985); opacity:0; animation:apxIn .35s ease .05s forwards; }
  @keyframes apxIn{ to{ transform:scale(1); opacity:1 } }

  /* Header */
  .apx-hd{ display:flex; align-items:center; gap:10px; padding:10px 12px; position:relative }
  .apx-ttl{ font-weight:900; letter-spacing:-.01em; font-size:15px }
  .apx-x{ margin-left:auto; appearance:none; width:32px; height:32px; border-radius:999px; border:1px solid var(--line); background:rgba(255,255,255,.9); display:grid; place-items:center; cursor:pointer }

  /* Tempo strip — very gentle start, ramps, snaps back to 50% */
  .apx-tempo{ position:absolute; left:12px; right:12px; bottom:6px; height:8px; border-radius:999px; background:rgba(0,0,0,.06); overflow:hidden }
  .apx-tempo__edge{ position:absolute; inset:0; transform-origin:left center; width:50%; background:linear-gradient(90deg,var(--ylw),#A3E635,var(--grn)); filter:saturate(1.05) brightness(1.02) }

  /* Stage */
  .apx-st{ position:relative; display:grid; place-items:center }
  .apx-step{ position:absolute; inset:0; display:grid; place-items:center; padding:22px; opacity:0; transform:translateY(8px); pointer-events:none; transition:opacity .25s ease, transform .35s cubic-bezier(.2,1,.2,1); overflow:auto }
  .apx-step.show{ opacity:1; transform:none; pointer-events:auto }
  .apx-c{ width:min(92%,600px); display:grid; gap:16px; text-align:center }
  .apx-h{ margin:0; font-weight:900; font-size:clamp(20px,3vmin,28px) }
  .apx-p{ margin:0; color:var(--muted); font-weight:700; font-size:15px }

  /* Hero image (used to be crown icon) */
  .apx-heroIcon{ width:150px; height:150px; object-fit:contain; display:block; margin:0 auto 4px; }

  /* Option grids */
  .apx-grid{ display:flex; flex-wrap:wrap; gap:10px; justify-content:center; align-items:stretch; }
  .apx-opt{ appearance:none; border:1px solid rgba(0,0,0,.06); background:#fff; border-radius:12px; padding:12px 16px; font-weight:900; cursor:pointer; display:inline-flex; align-items:center; gap:8px; justify-content:center; font-size:15px; line-height:1; white-space:nowrap; height:46px }
  .apx-opt i{ font-size:18px }
  .apx-opt:hover{ transform:translateY(-1px) }
  .apx-opt[aria-pressed="true"]{ color:#0f172a; box-shadow:0 0 0 3px rgba(0,0,0,.06) inset; border-color:#0f172a }

  /* Soft palette per group */
  .apx-grid[data-group="niche"] .apx-opt:nth-child(1){ background:rgba(122,92,255,.12) }
  .apx-grid[data-group="niche"] .apx-opt:nth-child(2){ background:rgba(0,227,170,.12) }
  .apx-grid[data-group="niche"] .apx-opt:nth-child(3){ background:rgba(0,158,235,.12) }
  .apx-grid[data-group="niche"] .apx-opt:nth-child(4){ background:rgba(255,195,0,.16) }
  .apx-grid[data-group="niche"] .apx-opt:nth-child(5){ background:rgba(255,107,44,.14) }
  .apx-grid[data-group="niche"] .apx-opt:nth-child(6){ background:rgba(0,0,0,.05) }
  .apx-grid[data-group="niche"] .apx-opt:nth-child(7){ background:rgba(0,227,170,.16) }

  .apx-grid[data-group="spend"] .apx-opt{ background:rgba(0,0,0,.04) }
  .apx-grid[data-group="goal"] .apx-opt:nth-child(1){ background:rgba(0,227,170,.12) }
  .apx-grid[data-group="goal"] .apx-opt:nth-child(2){ background:rgba(255,195,0,.16) }
  .apx-grid[data-group="goal"] .apx-opt:nth-child(3){ background:rgba(122,92,255,.12) }
  .apx-grid[data-group="goal"] .apx-opt:nth-child(4){ background:rgba(0,158,235,.12) }
  .apx-grid[data-group="timeline"] .apx-opt:nth-child(1){ background:rgba(255,107,44,.14) }
  .apx-grid[data-group="timeline"] .apx-opt:nth-child(2){ background:rgba(0,227,170,.12) }
  .apx-grid[data-group="timeline"] .apx-opt:nth-child(3){ background:rgba(0,0,0,.05) }
  .apx-grid[data-group="timeline"] .apx-opt:nth-child(4){ background:rgba(122,92,255,.12) }

  /* Inputs */
  .apx-f{ display:grid; gap:8px }
  .apx-label{ font-size:13px; color:#6b7280; font-weight:800; text-align:left }
  .apx-input{ width:100%; padding:12px 13px; border:1px solid rgba(0,0,0,.06); border-radius:12px; background:#fff; font-weight:800; font-size:15px }
  .apx-hintline{ font-size:12.5px; color:#6b7280 }

  /* Calendar */
  .apx-cal2{ display:grid; grid-template-columns: 1fr 1fr; gap:16px; width:min(92%,620px); margin:0 auto }
  .cal, .times{ background:#ffffffd9; border:1px solid rgba(0,0,0,.06); border-radius:14px; padding:12px }
  .cal{ display:grid; gap:10px }
  .cal-hd{ display:flex; align-items:center; justify-content:space-between; gap:8px }
  .cal-ttl{ font-weight:900 }
  .cal-nav{ display:flex; gap:6px }
  .cal-btn{ appearance:none; border:1px solid rgba(0,0,0,.08); background:#fff; border-radius:10px; padding:6px 8px; cursor:pointer; font-weight:900 }
  .cal-grid{ display:grid; grid-template-columns:repeat(7,1fr); gap:6px }
  .cal-wd{ font-size:12px; color:#6b7280; font-weight:900; text-align:center }
  .cal-cell{ appearance:none; border:1px solid rgba(0,0,0,.06); background:#fff; border-radius:10px; padding:10px 0; text-align:center; font-weight:900; cursor:pointer }
  .cal-cell.muted{ opacity:.4 }
  .cal-cell.sel{ background:var(--dk); color:#fff; border-color:var(--dk) }

  .times{ display:grid; gap:10px }
  .times-hd{ display:flex; align-items:center; justify-content:space-between }
  .times-date{ font-weight:900 }
  .times-grid{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; max-height:360px; overflow:auto; padding-right:4px }
  .apx-time{ appearance:none; border:1px solid rgba(0,0,0,.08); background:#fff; border-radius:10px; padding:10px; font-weight:900; cursor:pointer; text-align:center }
  .apx-time[disabled]{ opacity:.35; cursor:not-allowed }
  .apx-time.sel{ background:var(--dk); color:#fff; border-color:var(--dk) }

  /* Footer */
  .apx-ft{ display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-top:1px solid rgba(0,0,0,.06) }
  .apx-hint{ font-size:14px; color:#6b7280; font-weight:800 }
  .apx-row{ display:flex; gap:10px }
  .apx-btn{ appearance:none; border:1px solid rgba(0,0,0,.06); background:#fff; border-radius:12px; padding:12px 14px; font-weight:900; cursor:pointer; font-size:15px }
  .apx-btn.primary{ background:var(--dk); color:#fff; border-color:var(--dk) }
  .apx-btn[disabled]{ opacity:.55; cursor:not-allowed }

  /* Review */
  .apx-review{ text-align:left; width:min(92%,600px); margin:0 auto; background:#ffffffd9; border:1px solid rgba(0,0,0,.06); border-radius:14px; padding:16px; font-size:16.5px }
  .apx-review div{ padding:6px 4px }
  .apx-review strong{ display:inline-block; width:160px }
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  // ---------- Overlay skeleton ----------
  const overlay = el('div','apx'); overlay.id = 'apxOverlay';
  overlay.innerHTML = `
    <div class="apx-box" role="dialog" aria-modal="true">
      <header class="apx-hd">
        <div class="apx-ttl">Book a quick slot <span style="opacity:.6">(≈ 1 min)</span></div>
        <button class="apx-x" id="apxClose" aria-label="Close">
          <i class="ri-close-line"></i>
        </button>
        <div class="apx-tempo" aria-hidden="true">
          <div class="apx-tempo__edge" id="apxTempo"></div>
        </div>
      </header>
      <main class="apx-st" id="apxStage"></main>
      <footer class="apx-ft">
        <div class="apx-hint" id="apxHint">Step 1 of 7 — super quick</div>
        <div class="apx-row">
          <button class="apx-btn" id="apxBack" disabled>Back</button>
          <button class="apx-btn primary" id="apxNext">Next</button>
        </div>
      </footer>
    </div>`;
  document.body.appendChild(overlay);

  // ---------- Public API ----------
  window.apxOpen = apxOpen;
  function apxOpen(){ overlay.style.display='grid'; startTempo(); initCalendar(); setStep(0); }

  // ---------- Step templates ----------
  const opt = (iconClass,label,val,withIcon=true)=>{
    const icon = withIcon ? `<i class="${iconClass}"></i>` : '';
    return `<button class="apx-opt" data-val="${val}">${icon}<span>${label}</span></button>`;
  };
  const step = (idx, inner, shown)=>`<section class="apx-step${shown?' show':''}" data-step="${idx}">${inner}</section>`;

  // --- CHANGED HERO: uses image instead of crown icon ---
  const hero = () => `
    <div class='apx-c'>
      <img src="/hero.png" class="apx-heroIcon" alt="Hero" />
      <h3 class='apx-h'>Walk in with an unfair advantage</h3>
      <p class='apx-p'><strong>Give me 60–90 seconds now,</strong> and I’ll tune the strategy before we meet—so your call is all signal and you leave with a plan.</p>
    </div>`;

  const grid = (title, sub, group, items)=>{
    const opts = items.map(([val,label,icon,withIcon=true])=> opt(icon,label,val,withIcon)).join('');
    return `<div class='apx-c'>
      <h3 class='apx-h'>${title}</h3>
      ${sub?`<p class='apx-p'>${sub}</p>`:''}
      <div class='apx-grid' data-group='${group}'>${opts}</div>
    </div>`;
  };

  const contact = () => `
    <div class='apx-c'>
      <h3 class='apx-h'>Contact</h3>
      <p class='apx-p'>So I can send the calendar invite—no spam, scout’s honor.</p>
      <div class='apx-f'>
        <label class='apx-label' for='apxName'>Full name</label>
        <input id='apxName' class='apx-input' placeholder='Jane Doe' autocomplete='name'>
      </div>
      <div class='apx-f'>
        <label class='apx-label' for='apxNick'>Nickname <span class='apx-hintline'>— how do friends call you? (we’re friends, right?)</span></label>
        <input id='apxNick' class='apx-input' placeholder='Jane'>
      </div>
      <div class='apx-f'>
        <label class='apx-label' for='apxEmail'>Email (confirmation)</label>
        <input id='apxEmail' class='apx-input' placeholder='you@example.com' autocomplete='email'>
      </div>
    </div>`;

  const calendar = () => `
    <div class='apx-c'>
      <h3 class='apx-h'>Pick date & time</h3>
      <p class='apx-p'>Slots are <strong>30 minutes</strong>. Choose a date on the left, then a time on the right.</p>
      <div class='apx-cal2'>
        <div class='cal'>
          <div class='cal-hd'>
            <div class='cal-ttl' id='calTitle'>Month</div>
            <div class='cal-nav'>
              <button class='cal-btn' id='calPrev' aria-label='Previous month'>&lt;</button>
              <button class='cal-btn' id='calNext' aria-label='Next month'>&gt;</button>
            </div>
          </div>
          <div class='cal-grid' id='calWeekdays'></div>
          <div class='cal-grid' id='calDays'></div>
        </div>
        <div class='times'>
          <div class='times-hd'><div class='times-date' id='timesDate'>Select a date</div></div>
          <div class='times-grid' id='apxTimes'></div>
        </div>
      </div>
    </div>`;

  // Mount steps
  const stageEl = qs('#apxStage');
  stageEl.innerHTML = [
    step(0, hero(), true),
    step(1, grid('Business type','Pick the closest so I pull the right playbook.','niche',[
      ['ecom','E-commerce','ri-shopping-bag-3-line'],
      ['saas','SaaS / App','ri-apps-2-line'],
      ['service','Local / Services','ri-tools-line'],
      ['content','Creator / Education','ri-clapperboard-line'],
      ['experts','Experts','ri-focus-3-line'],
      ['advisors','Advisors','ri-loop-right-line'],
      ['consultants','Consultants','ri-bar-chart-2-line']
    ])),
    step(2, grid('Monthly ad spend','Media + tools (FB/IG/TikTok/Google, etc.)','spend',[
      ['<2k','Under $2K','',false],
      ['2–5k','$2K–$5K','',false],
      ['5–20k','$5K–$20K','',false],
      ['>20k','$20K+','',false]
    ])),
    step(3, grid('Primary goal','What moves the needle fastest?','goal',[
      ['acq','Acquire cheaper','ri-focus-2-line'],
      ['ret','Increase repeat','ri-refresh-line'], 
      ['arpu','Raise AOV/ARPU','ri-line-chart-line'],
      ['sys','Fix tracking','ri-bug-line']
    ])),
    step(4, grid('Timeline','When do you want to start?','timeline',[
      ['urgent','ASAP','ri-flashlight-line'],
      ['soon','Within 30 days','ri-calendar-check-line'],
      ['later','Exploring','ri-search-line'],
      ['audit','Audit only','ri-clipboard-line']
    ])),
    step(5, contact()),
    step(6, calendar()),
    step(7, `<div class='apx-c'><h3 class='apx-h'>Review</h3><div id='apxReview' class='apx-review'></div><p class='apx-p'>Looks good? Tap <strong>Finish</strong> and I’ll send the invite.</p></div>`),
    step(8, `<div class='apx-c'><h3 class='apx-h'>Booked <i class='ri-emotion-happy-line'></i></h3><p class='apx-p'>Invite sent. If I’m late, coffee on me. (I’m not late.)</p></div>`)
  ].join('');

  // ---------- Wire controls ----------
  const nextBtn  = qs('#apxNext');
  const backBtn  = qs('#apxBack');
  const hintEl   = qs('#apxHint');
  const closeBtn = qs('#apxClose');
  const tempoBar = qs('#apxTempo');
  const reviewEl = qs('#apxReview');

  closeBtn?.addEventListener('click', ()=> overlay.style.display='none');
  overlay.addEventListener('click', (e)=>{ if (e.target===overlay) overlay.style.display='none'; });

  let cur = 0; const LAST_FORM = 7; // review at 7, booked at 8
  const data = { niche:null, spend:null, goal:null, timeline:null, name:'', nick:'', email:'', dateISO:null, timeLabel:null };

  function setStep(n){
    const steps = qsa('.apx-step');
    cur = Math.max(0, Math.min(n, steps.length-1));
    steps.forEach((s,i)=> s.classList.toggle('show', i===cur));
    backBtn.disabled = cur===0;
    nextBtn.textContent = (cur>=LAST_FORM) ? 'Finish' : 'Next';
    const hints = ['Step 1 of 7 — super quick','Step 2 — niche','Step 3 — spend','Step 4 — goal','Step 5 — timeline','Step 6 — contact','Step 7 — date & time','Review','Booked'];
    hintEl.textContent = hints[cur]||'';
    if (cur===7) renderReview();
  }
  nextBtn.addEventListener('click', ()=>{
    if (!validate(cur)) return;
    if (cur===LAST_FORM){ submit(); setStep(8); return; }
    setStep(cur+1);
  });
  backBtn.addEventListener('click', ()=> setStep(cur-1));

  // Option selects
  qs('#apxStage').addEventListener('click', (e)=>{
    const btn = e.target.closest('.apx-opt'); if (!btn) return;
    const groupEl = btn.parentElement; const group = groupEl?.dataset.group; const val = btn.dataset.val; if(!group||!val) return;
    qsa('.apx-opt', groupEl).forEach(b=> b.setAttribute('aria-pressed','false'));
    btn.setAttribute('aria-pressed','true');
    data[group] = val;
  });

  function validateEmail(v){ return /.+@.+\..+/.test(v); }
  function nudge(el){ if(!el) return; el.style.transition='transform .12s ease'; el.style.transform='translateY(-2px)'; setTimeout(()=> el.style.transform='translateY(0)', 120); el.focus?.(); }

  function validate(i){
    switch(i){
      case 0: return true;
      case 1: return !!data.niche || (nudge(qs('[data-group="niche"]')), false);
      case 2: return !!data.spend || (nudge(qs('[data-group="spend"]')), false);
      case 3: return !!data.goal  || (nudge(qs('[data-group="goal"]')), false);
      case 4: return !!data.timeline || (nudge(qs('[data-group="timeline"]')), false);
      case 5:
        data.name = (qs('#apxName')?.value||'').trim();
        data.nick = (qs('#apxNick')?.value||'').trim();
        data.email= (qs('#apxEmail')?.value||'').trim();
        if(!data.name){ nudge(qs('#apxName')); return false; }
        if(!validateEmail(data.email)){ nudge(qs('#apxEmail')); return false; }
        return true;
      case 6:
        if(!data.dateISO){ nudge(qs('#calDays')); return false; }
        if(!data.timeLabel){ nudge(qs('#apxTimes')); return false; }
        return true;
      case 7: return true;
      default: return true;
    }
  }

  // ---------- Tempo loop (extra slow start; ramp then instant snap) ----------
  let raf=null; let t=0.5; // starts at 50%
  function startTempo(){ cancelAnimationFrame(raf); t=0.5; ramp(); }
  function ramp(){
    const dt = 1/60; // frame
    const remaining = 1 - t;
    const speed = clamp(remaining*0.35, 0.0025, 0.10); 
    t += speed * dt;
    if (t >= 0.999){ t = 0.5; tempoBar.style.width = '50%'; }
    else { tempoBar.style.width = (t*100)+'%'; }
    raf = requestAnimationFrame(ramp);
  }

  // ---------- Calendar ----------
  let calMonth = null;
  function initCalendar(){
    // Weekdays
    const wd = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const wdn = qs('#calWeekdays'); wdn.innerHTML=''; wd.forEach(x=>{ const d=el('div','cal-wd'); d.textContent=x; wdn.appendChild(d); });
    // Current month
    const now=new Date(); calMonth = { year: now.getFullYear(), month: now.getMonth() };
    buildMonth();
    // Nav: limit to current + next month
    qs('#calPrev').addEventListener('click', ()=>{
      const n=new Date(); if(calMonth.year===n.getFullYear() && calMonth.month===n.getMonth()) return;
      const m=new Date(calMonth.year,calMonth.month-1,1); calMonth={year:m.getFullYear(),month:m.getMonth()}; buildMonth();
    });
    qs('#calNext').addEventListener('click', ()=>{
      const lim=new Date(); lim.setMonth(lim.getMonth()+1);
      const cur=new Date(calMonth.year,calMonth.month,1);
      if(cur.getFullYear()>lim.getFullYear() || (cur.getFullYear()===lim.getFullYear() && cur.getMonth()>=lim.getMonth())) return;
      const m=new Date(calMonth.year,calMonth.month+1,1); calMonth={year:m.getFullYear(),month:m.getMonth()}; buildMonth();
    });
  }

  function buildMonth(){
    qs('#calTitle').textContent = new Date(calMonth.year, calMonth.month, 1).toLocaleString(undefined,{month:'long', year:'numeric'});
    const grid = qs('#calDays'); grid.innerHTML='';
    const first = new Date(calMonth.year, calMonth.month, 1);
    const startIdx = (first.getDay()||7) - 1; 
    const daysInMonth = new Date(calMonth.year, calMonth.month+1, 0).getDate();
    const prevDays = new Date(calMonth.year, calMonth.month, 0).getDate();

    const cells = 42; const now=new Date();
    for(let i=0;i<cells;i++){
      const cell = el('button','cal-cell');
      let dayNum, d; let muted=false;
      if(i<startIdx){ dayNum = prevDays - startIdx + i + 1; d = new Date(calMonth.year, calMonth.month-1, dayNum); muted=true; }
      else if(i>=startIdx+daysInMonth){ dayNum = i - (startIdx+daysInMonth) + 1; d = new Date(calMonth.year, calMonth.month+1, dayNum); muted=true; }
      else { dayNum = i-startIdx+1; d = new Date(calMonth.year, calMonth.month, dayNum); }
      cell.textContent = String(dayNum);
      if(muted) cell.classList.add('muted');
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const cmp   = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const past = cmp < today;
      if(past){ cell.disabled = true; cell.style.opacity = .35; cell.style.cursor='not-allowed'; }
      cell.addEventListener('click', ()=> selectDateCell(cell, d));
      if(!past && sameDay(d, now) && d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear()){
        selectDateCell(cell, d);
      }
      grid.appendChild(cell);
    }
  }

  function selectDateCell(cell, dateObj){
    qsa('.cal-cell.sel').forEach(x=> x.classList.remove('sel'));
    cell.classList.add('sel');
    data.dateISO = dateObj.toISOString().split('T')[0];
    qs('#timesDate').textContent = dateObj.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
    buildTimes(dateObj);
  }

  function buildTimes(dateObj){
    const tEl = qs('#apxTimes'); tEl.innerHTML='';
    const now = new Date(); const today = sameDay(dateObj, now);
    for (let h=9; h<=17; h++){
      for (let m=0; m<60; m+=30){
        const t = new Date(dateObj); t.setHours(h,m,0,0);
        const label = t.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
        const b = el('button','apx-time'); b.textContent = label;
        const disabled = today && t < now;
        if (disabled){ b.disabled = true; }
        b.addEventListener('click', ()=> selectTimeBtn(b, label));
        tEl.appendChild(b);
      }
    }
  }
  function selectTimeBtn(btn,label){ qsa('.apx-time.sel').forEach(x=> x.classList.remove('sel')); btn.classList.add('sel'); data.timeLabel = label; }
  function sameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }

  // ---------- Review + Submit ----------
  function renderReview(){
    if (!reviewEl) return;
    const rows = [
      ['Business', map('niche',{ecom:'E-commerce',saas:'SaaS / App',service:'Local / Services',content:'Creator / Education',experts:'Experts',advisors:'Advisors',consultants:'Consultants'})],
      ['Spend',    map('spend',{'<2k':'Under $2K','2–5k':'$2K–$5K','5–20k':'$5K–$20K','>20k':'$20K+'}) + ' / month'],
      ['Goal',     map('goal',{acq:'Acquire cheaper',ret:'Increase repeat',arpu:'Raise AOV/ARPU',sys:'Fix tracking'})],
      ['Timeline', map('timeline',{urgent:'ASAP',soon:'Within 30 days',later:'Exploring',audit:'Audit only'})],
      ['Name', data.name + (data.nick?` (${data.nick})`:'')],
      ['Email', data.email],
      ['When',  data.dateISO && data.timeLabel ? `${data.dateISO} @ ${data.timeLabel} (30m)` : '—']
    ];
    reviewEl.innerHTML = rows.map(([k,v])=>`<div><strong>${k}:</strong> ${esc(v)}</div>`).join('');
  }
  function map(k,m){ return (m && m[data[k]]) || data[k] || '—'; }
  function esc(s){ return String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
  function submit(){ console.log('📨 Appointment payload', {...data}); }

})();
