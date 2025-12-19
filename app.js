/* =========================
   app.js（完全版）
   ========================= */

/* ===== 状態 ===== */
let players = JSON.parse(localStorage.getItem("iv_players") || "[]");
let matches = JSON.parse(localStorage.getItem("iv_matches") || "[]");
let manualMode = false;
let dualMode = false;
let lastCreateCount = 0;
const sessionStartTs = Date.now();
let selectedNames = new Set();

/* 主催者固定モード */
let hostName = localStorage.getItem("iv_hostName") || "";
let hostMode = localStorage.getItem("iv_hostMode") === "1";

/* ハンターのみローテ（登録順） */
const HUNTER_ROT_KEY = "iv_hunterOnlyRotIdx";
let hunterOnlyRotIdx = parseInt(localStorage.getItem(HUNTER_ROT_KEY) || "0", 10);
if (!Number.isFinite(hunterOnlyRotIdx) || hunterOnlyRotIdx < 0) hunterOnlyRotIdx = 0;

/* ===== テーマ ===== */
const THEME_KEY = "iv_theme";
function applyTheme(mode){
  const root = document.documentElement;
  if(mode === 'light'){ root.setAttribute('data-theme','light'); }
  else if(mode === 'dark'){ root.setAttribute('data-theme','dark'); }
  else{ root.removeAttribute('data-theme'); mode = 'auto'; }
  localStorage.setItem(THEME_KEY, mode);
  const label = mode==='auto' ? '🌓 Auto' : (mode==='light'?'☀️ Light':'🌙 Dark');
  const sub   = mode==='auto' ? 'OS設定に追従' : (mode==='light'?'ライト固定':'ダーク固定');
  const btnTop = document.getElementById('themeBtnTop');
  const btnDock= document.getElementById('themeBtnDock');
  const lblTop = document.getElementById('themeLabelTop');
  if(btnTop) btnTop.textContent = label;
  if(btnDock) btnDock.textContent = label;
  if(lblTop) lblTop.textContent = sub;
}
function cycleTheme(){
  const cur = localStorage.getItem(THEME_KEY) || 'auto';
  const next = cur==='auto' ? 'light' : cur==='light' ? 'dark' : 'auto';
  applyTheme(next);
}

/* ===== 保存 ===== */
function save(){
  localStorage.setItem("iv_players", JSON.stringify(players));
  localStorage.setItem("iv_matches", JSON.stringify(matches));
  localStorage.setItem("iv_hostName", hostName || "");
  localStorage.setItem("iv_hostMode", hostMode ? "1" : "0");
  localStorage.setItem(HUNTER_ROT_KEY, String(hunterOnlyRotIdx));
}

/* ===== 初回マイグレーション ===== */
(function migrate(){
  const now = Date.now();
  let changed = false;
  for(const p of players){
    if(!("joinTs" in p)){ p.joinTs = now; changed = true; }
    if(!("lastTs" in p)){ p.lastTs = null; changed = true; }
    if(!("pref" in p)){ p.pref = "either"; changed = true; }
    if(!("active" in p)){ p.active = true; changed = true; }
    if(!("sCount" in p)){ p.sCount = 0; changed = true; }
    if(!("hCount" in p)){ p.hCount = 0; changed = true; }
    if(!("sAdj" in p)){ p.sAdj = 0; changed = true; }
    if(!("hAdj" in p)){ p.hAdj = 0; changed = true; }

    /* 旧データに survivor-only / hunter-only が入ってない場合も許容 */
    const ok = new Set(["either","survivor","hunter","survivor-only","hunter-only"]);
    if(!ok.has(p.pref)){ p.pref = "either"; changed = true; }
  }
  if(changed) save();
})();

/* ===== util ===== */
const $ = sel => document.querySelector(sel);
function escapeHtml(s){return String(s).replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function tsToString(ts){const d=new Date(ts),z=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`}
function prefLabel(p){
  if(p==='survivor') return 'サバ希望';
  if(p==='hunter') return 'ハンター希望';
  if(p==='survivor-only') return 'サバイバーのみ';
  if(p==='hunter-only') return 'ハンターのみ';
  return '希望なし';
}

/* ===== iOS/通知判定 ===== */
function isIOS(){
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return iOS;
}
function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function notificationsSupported(){
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return false;
  if (isIOS() && !isStandalone()) return false;
  return true;
}
function openIOSGuide(){
  const d = document.getElementById('iosGuide');
  if (d && typeof d.showModal === 'function') d.showModal();
  else alert('Safari → 共有 → 「ホーム画面に追加」でPWA化してください。PWA内で「通知を有効化」を押すと使えます。');
}

/* ===== 再計算 ===== */
function recomputeCountsFromMatches(rebuildTiming=false){
  players.forEach(p=>{ p.sCount=0; p.hCount=0; if(rebuildTiming) p.lastTs=null; });
  const idx = new Map(players.map((p,i)=>[p.name,i]));
  const sorted = matches.slice().sort((a,b)=>(a.ts||0)-(b.ts||0));
  for(const m of sorted){
    const t = m.ts || Date.now();
    const hi = idx.get(m.hunter);
    if(hi!=null){ players[hi].hCount++; if(rebuildTiming) players[hi].lastTs = t; }
    for(const s of (m.survivors||[])){
      const si = idx.get(s);
      if(si!=null){ players[si].sCount++; if(rebuildTiming) players[si].lastTs = t; }
    }
  }
  for(const p of players){
    p.sCount = Math.max(0, p.sCount + (p.sAdj||0));
    p.hCount = Math.max(0, p.hCount + (p.hAdj||0));
  }
}

/* ===== 参加者操作 ===== */
function addPlayer(){
  const name = ($("#nameInput").value||"").trim();
  const pref = $("#prefInput").value || "either";
  if(!name) return;
  if(players.some(p=>p.name===name)){ alert("同名の参加者がすでにいます"); return; }
  const now = Date.now();
  players.push({ name, sCount:0, hCount:0, sAdj:0, hAdj:0, pref, active:true, joinTs:now, lastTs:null });
  $("#nameInput").value="";
  recomputeCountsFromMatches(false);
  save(); render();
}
function toggleActive(i){ players[i].active=!players[i].active; save(); render(); }

/* 手動編集 */
function editName(i, val){
  const v = (val||"").trim(); if(!v) return;
  if(players.some((p,pi)=>pi!==i && p.name===v)){alert("同名は使えません"); render(); return;}
  const old = players[i].name; players[i].name = v;
  if(selectedNames.has(old)){ selectedNames.delete(old); selectedNames.add(v); }
  for(const m of matches){
    if(m.hunter===old) m.hunter=v;
    m.survivors = m.survivors.map(s=>s===old?v:s);
  }
  if(hostName === old){ hostName = v; }
  recomputeCountsFromMatches(true); save(); render();
}
function editPref(i, val){ players[i].pref = val; save(); render(); }
function incS(i){ players[i].sAdj = (players[i].sAdj||0) + 1; recomputeCountsFromMatches(false); save(); renderTablesOnly(); }
function decS(i){ players[i].sAdj = (players[i].sAdj||0) - 1; recomputeCountsFromMatches(false); save(); renderTablesOnly(); }
function incH(i){ players[i].hAdj = (players[i].hAdj||0) + 1; recomputeCountsFromMatches(false); save(); renderTablesOnly(); }
function decH(i){ players[i].hAdj = (players[i].hAdj||0) - 1; recomputeCountsFromMatches(false); save(); renderTablesOnly(); }

/* 主催者モード */
function toggleHostMode(){
  hostMode = $("#hostModeToggle").checked;
  if(hostMode && (!hostName || !players.some(p=>p.name===hostName))){
    alert("主催者をドロップダウンから選択してください。");
    hostMode = false;
    $("#hostModeToggle").checked = false;
  }
  save();
}
function setHost(name){
  hostName = name || "";
  if(!hostName){
    hostMode = false;
    const chk = $("#hostModeToggle");
    if(chk) chk.checked = false;
  }
  save();
  renderHostControls();
}

function removePlayer(i){
  const p = players[i]; if(!p) return;
  if(!confirm(`「${p.name}」を完全削除します。\n・名簿から削除\n・関与する試合を履歴から削除\n・残り履歴から回数/待機情報を再計算`)) return;
  const removed = p.name;
  players.splice(i,1);
  selectedNames.delete(removed);
  if(hostName === removed){
    hostName = "";
    hostMode = false;
  }
  cleanupMatchesAndRecompute();
}

/* 一括削除 */
function toggleSelect(i){
  const name = players[i].name;
  if(selectedNames.has(name)) selectedNames.delete(name); else selectedNames.add(name);
  updateSelectionUI();
}
function toggleSelectAll(flag){
  if(flag){ selectedNames = new Set(players.map(p=>p.name)); }
  else { selectedNames.clear(); }
  updateSelectionUI();
}
function selectRecentAdded(){
  const newly = players.filter(p=>p.joinTs >= sessionStartTs).map(p=>p.name);
  if(newly.length===0){ alert("このセッションで追加されたメンバーはいません"); return; }
  newly.forEach(n=>selectedNames.add(n));
  updateSelectionUI();
}
function bulkDeleteSelected(){
  if(selectedNames.size===0){ alert("一括削除するメンバーが選択されていません"); return; }
  const names = Array.from(selectedNames);
  const preview = names.slice(0,20).join("、 ") + (names.length>20 ? " ほか…" : "");
  if(!confirm(`選択した ${names.length} 名を完全削除します。\n（履歴からも該当試合を削除し、再計算します）\n\n対象: ${preview}`)) return;
  const removeSet = new Set(names);
  players = players.filter(p=>!removeSet.has(p.name));
  if(hostName && !players.some(p=>p.name===hostName)){
    hostName = "";
    hostMode = false;
  }
  selectedNames.clear();
  $("#masterSelect").checked = false;
  cleanupMatchesAndRecompute();
}
function cleanupMatchesAndRecompute(){
  const alive = new Set(players.map(x=>x.name));
  matches = matches.filter(m=>{
    if(!alive.has(m.hunter)) return false;
    if(!Array.isArray(m.survivors) || m.survivors.length!==4) return false;
    for(const s of m.survivors) if(!alive.has(s)) return false;
    return true;
  });
  recomputeCountsFromMatches(true); save(); render();
}
function updateSelectionUI(){
  $("#selCount").textContent = selectedNames.size;
  $("#masterSelect").checked = selectedNames.size>0 && selectedNames.size===players.length;
  renderTablesOnly();
}

/* 2試合同時 */
function toggleDual(){ dualMode = $("#dualToggle").checked; $("#dualToggleDock").checked = dualMode; updateDualHint(); render(); }
function toggleDualDock(){ dualMode = $("#dualToggleDock").checked; $("#dualToggle").checked = dualMode; updateDualHint(); render(); }
function updateDualHint(){
  const actives = players.filter(p=>p.active).length;
  const hint = $("#dualHint");
  if(dualMode){
    if(actives>=10) hint.innerHTML = `<span class="notice">2試合同時：有効（アクティブ ${actives}）</span>`;
    else hint.innerHTML = `<span class="warn">アクティブが10人未満のため実行時は1試合のみ（現在 ${actives}）</span>`;
  }else hint.textContent = "現在は1試合モードです";
}

/* ===== 抽選ロジック ===== */
function priorityOrder(list){
  const now = Date.now();
  function key(p){
    const a = p.sCount + p.hCount;
    let newcomerBoost = 0;
    if(a===0){
      const win = 15*60*1000;
      const dt = Math.max(0, Math.min(win, now - p.joinTs));
      newcomerBoost = 1 - (dt/win);
    }
    const refTs = p.lastTs!=null ? p.lastTs : p.joinTs;
    const waitScore = (now - refTs) / (10*60*1000);
    return {a, newcomerBoost, waitScore, name:p.name, joinTs:p.joinTs};
  }
  return list.slice().sort((a,b)=>{
    const ka=key(a), kb=key(b);
    if(ka.a !== kb.a) return ka.a - kb.a;
    if(ka.newcomerBoost !== kb.newcomerBoost) return kb.newcomerBoost - ka.newcomerBoost;
    if(ka.waitScore !== kb.waitScore) return kb.waitScore - ka.waitScore;
    return ka.name.localeCompare(kb.name);
  });
}

/* ハンターのみローテ用：アクティブな hunter-only を登録順で返す */
function getActiveHunterOnlyByJoin(){
  return players
    .filter(p=>p.active && p.pref==='hunter-only')
    .slice()
    .sort((a,b)=>(a.joinTs||0)-(b.joinTs||0) || a.name.localeCompare(b.name));
}

/* ハンターのみローテ表示 */
function renderHunterOnlyQueue(){
  const box = document.getElementById("hunterOnlyQueue");
  if(!box) return;
  const arr = getActiveHunterOnlyByJoin();
  if(arr.length===0){
    box.textContent = "（ハンターのみのアクティブ参加者はいません）";
    return;
  }
  const idx = arr.length ? (hunterOnlyRotIdx % arr.length) : 0;
  const next = arr[idx]?.name;

  const items = arr.map((p,i)=>{
    const isNext = (p.name===next);
    return `<span class="chip" style="margin:2px 6px 2px 0; ${isNext ? 'border-color:var(--primary);' : ''}">
      ${escapeHtml(p.name)}${isNext ? '（次）' : ''}
    </span>`;
  }).join("");

  box.innerHTML = `
    <div class="muted" style="font-size:12px;margin-bottom:6px">次の候補： <b>${escapeHtml(next)}</b></div>
    <div>${items}</div>
  `;
}

/* ロール割当（希望/平均化/ハンターのみ制約） */
function assignRoles(pool){
  const now = Date.now();
  const activePool = pool.slice();

  /* サバ不足判定：サバ役に使える人数が足りないなら hunter-only もサバに解禁 */
  const survivorEligible = (p)=> (p.pref !== 'hunter-only');
  const survivorEligibleCount = activePool.filter(survivorEligible).length;

  const allowHunterOnlyAsSurvivor = (survivorEligibleCount < 4);

  function hunterLack(p){
    const a = p.sCount + p.hCount;
    let s = (a/5) - p.hCount;

    if(p.pref==='hunter') s += 0.25;
    if(p.pref==='survivor') s -= 0.15;
    if(p.pref==='survivor-only') s -= 999;     /* 原則ハンター禁止 */
    if(p.pref==='hunter-only') s += 999;       /* 原則ハンター最優先 */

    if(a===0) s += 0.15;
    return s + Math.random()*0.001;
  }

  function survivorLack(p){
    const a = p.sCount + p.hCount;
    let s = (a*4/5) - p.sCount;

    if(p.pref==='survivor') s += 0.25;
    if(p.pref==='hunter') s -= 0.15;
    if(p.pref==='hunter-only'){
      /* 原則サバ禁止。ただしサバ不足の時だけ候補にする */
      s += (allowHunterOnlyAsSurvivor ? 0.05 : -999);
    }
    if(p.pref==='survivor-only') s += 0.35;

    if(a===0) s += 0.15;
    return s + Math.random()*0.001;
  }

  /* ① ハンター決定：hunter-only が複数なら登録順ローテを優先 */
  const hunterOnlyInPool = activePool
    .filter(p=>p.pref==='hunter-only')
    .slice()
    .sort((a,b)=>(a.joinTs||0)-(b.joinTs||0) || a.name.localeCompare(b.name));

  let hunter;

  if(hunterOnlyInPool.length >= 1){
    const allActiveHunterOnly = getActiveHunterOnlyByJoin();
    if(allActiveHunterOnly.length > 0){
      const start = hunterOnlyRotIdx % allActiveHunterOnly.length;
      let picked = null;

      /* ローテ順に pool 内に居る人を探す */
      for(let k=0;k<allActiveHunterOnly.length;k++){
        const cand = allActiveHunterOnly[(start + k) % allActiveHunterOnly.length];
        if(hunterOnlyInPool.some(p=>p.name===cand.name)){
          picked = cand;
          hunterOnlyRotIdx = (start + k + 1) % allActiveHunterOnly.length; /* 次へ */
          break;
        }
      }
      if(picked){
        hunter = activePool.find(p=>p.name===picked.name) || hunterOnlyInPool[0];
      }else{
        hunter = hunterOnlyInPool[0];
      }
    }else{
      hunter = hunterOnlyInPool[0];
    }
  }else{
    hunter = activePool.slice().sort((a,b)=>hunterLack(b)-hunterLack(a))[0];
  }

  /* ② サバ決定 */
  const others = activePool.filter(p=>p!==hunter);

  let survivors = others
    .slice()
    .sort((a,b)=>survivorLack(b)-survivorLack(a))
    .filter(p=> allowHunterOnlyAsSurvivor ? true : p.pref!=='hunter-only')
    .slice(0,4);

  /* 万一4人未満なら、残りから埋める（最後の安全弁） */
  if(survivors.length < 4){
    const remain = others.filter(p=>!survivors.includes(p));
    for(const p of remain){
      if(survivors.length>=4) break;
      survivors.push(p);
    }
  }

  return { hunter, survivors };
}

/* 主催者考慮込み 1試合構築 */
function buildOneMatch(act){
  if(act.length < 5) return null;

  const hostEnabled = hostMode && hostName && act.some(p=>p.name===hostName);
  const prio = priorityOrder(act);

  let pool;

  if(!hostEnabled){
    pool = prio.slice(0,5);
  }else{
    const hostP = prio.find(p=>p.name===hostName);
    const others = prio.filter(p=>p.name!==hostName);
    if(!hostP || others.length < 4) return null;
    pool = [hostP, ...others.slice(0,4)];
  }

  const res = assignRoles(pool);
  const now = Date.now();
  return { ts: now, hunter: res.hunter.name, survivors: res.survivors.map(p=>p.name) };
}

function pickNext(){
  const activePlayers = players.filter(p=>p.active);
  const actCount = activePlayers.length;
  updateDualHint();

  if(!dualMode || actCount < 10){
    const m = buildOneMatch(activePlayers);
    if(!m){ alert("アクティブ参加者が5人以上必要です"); return; }
    matches.push(m);
    lastCreateCount = 1;
  }else{
    const prio = priorityOrder(activePlayers);
    if(prio.length < 10){ alert("アクティブが10人未満です"); return; }

    const hostEnabled = hostMode && hostName && prio.some(p=>p.name===hostName);
    let poolA, poolB;

    if(hostEnabled){
      const hostP = prio.find(p=>p.name===hostName);
      const others = prio.filter(p=>p!==hostP);
      if(others.length < 9){
        const firstTen = prio.slice(0,10);
        poolA = [firstTen[0], firstTen[2], firstTen[4], firstTen[6], firstTen[8]];
        poolB = [firstTen[1], firstTen[3], firstTen[5], firstTen[7], firstTen[9]];
      }else{
        poolA = [hostP, ...others.slice(0,4)];
        poolB = others.slice(4,9);
      }
    }else{
      const firstTen = prio.slice(0,10);
      poolA = [firstTen[0], firstTen[2], firstTen[4], firstTen[6], firstTen[8]];
      poolB = [firstTen[1], firstTen[3], firstTen[5], firstTen[7], firstTen[9]];
    }

    const mA = assignRoles(poolA);
    const mB = assignRoles(poolB);
    const now = Date.now();
    matches.push({ ts: now,   hunter: mA.hunter.name, survivors: mA.survivors.map(p=>p.name) });
    matches.push({ ts: now+1, hunter: mB.hunter.name, survivors: mB.survivors.map(p=>p.name) });
    lastCreateCount = 2;
  }

  recomputeCountsFromMatches(true); save(); render();

  const last = matches[matches.length-1];
  const second = matches[matches.length-2];
  const isDual = second && Math.abs((last.ts||0)-(second.ts||0))<=2000;
  notifyLatestLineup(isDual ? [second, last] : last);
}

function undoLastMatch(){
  const n = Math.min(matches.length, Math.max(1, lastCreateCount||1));
  if(n<=0) return;
  for(let i=0;i<n;i++) matches.pop();
  lastCreateCount = 0;
  recomputeCountsFromMatches(true); save();
  $("#lastMatchA").textContent="直前の試合を取り消しました";
  $("#lastMatchB").style.display="none";
  renderTablesOnly();
  broadcastOverlayState();
}

/* 手動登録 */
function toggleManual(){ manualMode = $("#manualToggle").checked; $("#manualPanel").style.display = manualMode ? "block" : "none"; render(); }
function fillManualSelectors(){
  const opts = players.map(p=>`<option>${escapeHtml(p.name)}</option>`).join("");
  $("#manualHunter").innerHTML = `<option value="">未選択</option>${opts}`;
  ["#manualS1","#manualS2","#manualS3","#manualS4"].forEach(sel=>{ $(sel).innerHTML = `<option value="">未選択</option>${opts}`; });
}
function addManualMatch(){
  const h = $("#manualHunter").value;
  const s1=$("#manualS1").value, s2=$("#manualS2").value, s3=$("#manualS3").value, s4=$("#manualS4").value;
  const surv=[s1,s2,s3,s4];
  if(!h || surv.some(v=>!v)){ alert("ハンター1名、サバイバー4名を選択してください"); return; }
  const set = new Set([h,...surv]); if(set.size!==5){ alert("同一人物は選べません"); return; }
  matches.push({ ts: Date.now(), hunter: h, survivors: surv });
  lastCreateCount = 1;

  /* 手動追加でもローテは進めない（登録順ローテは「確定抽選でハンターのみをハンターに割り当てた時」優先） */
  recomputeCountsFromMatches(true); save(); render();
  broadcastOverlayState();
  const m = matches[matches.length-1]; if (m) notifyLatestLineup(m);
}
function deleteMatch(idx){
  if(!confirm("この試合を履歴から削除しますか？\n（回数は履歴から再計算＋手動調整値適用）")) return;
  matches.splice(idx,1);
  recomputeCountsFromMatches(true); save(); render();
  broadcastOverlayState();
}

/* ===== レンダリング ===== */
function render(){
  renderTablesOnly();
  updateDualHint();
  updateLastMatchView();
  renderHistory();
  renderHostControls();
  renderHunterOnlyQueue();
  if(manualMode) fillManualSelectors();
  $("#year").textContent = new Date().getFullYear();
  $("#selCount").textContent = selectedNames.size;
  $("#dualToggleDock").checked = dualMode;
  $("#dualToggle").checked = dualMode;
  broadcastOverlayState();
}
function renderHostControls(){
  const sel = $("#hostSelect");
  const chk = $("#hostModeToggle");
  if(!sel || !chk) return;
  if(hostName && !players.some(p=>p.name===hostName)){
    hostName = "";
    hostMode = false;
  }
  let options = `<option value="">主催者未指定</option>`;
  players.forEach(p=>{
    const selected = (p.name === hostName) ? ' selected' : '';
    options += `<option value="${escapeHtml(p.name)}"${selected}>${escapeHtml(p.name)}</option>`;
  });
  sel.innerHTML = options;
  chk.checked = hostMode && !!hostName;
}
function renderTablesOnly(){
  const tbody = $("#playerTbody"); tbody.innerHTML="";
  const now = Date.now();
  players.forEach((p,i)=>{
    const a = p.sCount + p.hCount;
    const refTs = p.lastTs!=null ? p.lastTs : p.joinTs;
    const waitMin = Math.floor(Math.max(0, now - refTs) / 60000);
    const newcomer = (p.sCount+p.hCount)===0 ? `<span class="chip">NEW</span>` : "";
    const isHost = (p.name === hostName);

    const nameCell = manualMode
      ? `<input type="text" value="${escapeHtml(p.name)}" style="min-width:160px" onblur="editName(${i}, this.value)">`
      : `<span>${escapeHtml(p.name)}</span>${isHost ? ' <span class="chip">HOST</span>' : ''}`;

    const manualControlsS = `
      <div class="row" style="justify-content:flex-end;gap:4px">
        <button class="btn tiny" onclick="decS(${i})">サバ−</button>
        <span>${p.sCount}</span>
        <button class="btn tiny" onclick="incS(${i})">サバ＋</button>
      </div>`;
    const manualControlsH = `
      <div class="row" style="justify-content:flex-end;gap:4px">
        <button class="btn tiny" onclick="decH(${i})">ハン−</button>
        <span>${p.hCount}</span>
        <button class="btn tiny" onclick="incH(${i})">ハン＋</button>
      </div>`;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td data-label="選択"><input type="checkbox" ${selectedNames.has(p.name)?"checked":""} onchange="toggleSelect(${i})" aria-label="選択" /></td>
      <td data-label="名前（✓=アクティブ）">
        <label class="row" style="gap:6px">
          <input type="checkbox" ${p.active?"checked":""} onchange="toggleActive(${i})" aria-label="アクティブ切替">
          ${nameCell}
          ${newcomer}
        </label>
        <div class="muted" style="font-size:12px;margin-left:26px">待機：約${waitMin}分</div>
      </td>
      <td class="num" data-label="サバ">${manualMode? manualControlsS : p.sCount}</td>
      <td class="num" data-label="ハン">${manualMode? manualControlsH : p.hCount}</td>
      <td class="num" data-label="合計"><b>${a}</b></td>
      <td data-label="希望">
        ${manualMode
          ? `<select onchange="editPref(${i}, this.value)" aria-label="希望選択">
               <option value="either" ${p.pref==='either'?'selected':''}>希望なし</option>
               <option value="survivor" ${p.pref==='survivor'?'selected':''}>サバ希望</option>
               <option value="hunter" ${p.pref==='hunter'?'selected':''}>ハンター希望</option>
               <option value="survivor-only" ${p.pref==='survivor-only'?'selected':''}>サバイバーのみ</option>
               <option value="hunter-only" ${p.pref==='hunter-only'?'selected':''}>ハンターのみ</option>
             </select>`
          : escapeHtml(prefLabel(p.pref))}
      </td>
      <td data-label="操作"><button class="btn btn-danger tiny" onclick="removePlayer(${i})">削除</button></td>
    `;
    tbody.appendChild(row);
  });

  const activeCount = players.filter(p=>p.active).length;
  $("#stats").textContent = `アクティブ: ${activeCount} / 登録: ${players.length}`;
  $("#historyCount").textContent = String(matches.length);
  $("#selCount").textContent = selectedNames.size;
  $("#masterSelect").checked = selectedNames.size>0 && selectedNames.size===players.length;
}
function updateLastMatchView(){
  const a = $("#lastMatchA");
  const b = $("#lastMatchB");
  if(!matches.length){
    a.textContent="まだ試合はありません";
    b.style.display="none"; return;
  }
  const last = matches[matches.length-1];
  const second = matches[matches.length-2];
  const showTwo = second && Math.abs((last.ts||0) - (second.ts||0)) <= 2000;
  function htmlFor(m){
    return `
      <div class="lastTitle">${tsToString(m.ts)}</div>
      <div><span class="tag tag-red">HUNTER</span> <b>${escapeHtml(m.hunter)}</b></div>
      <div style="margin-top:4px"><span class="tag">SURVIVORS</span> <b>${m.survivors.map(escapeHtml).join("、 ")}</b></div>
    `;
  }
  a.innerHTML = htmlFor(last);
  if(showTwo){ b.style.display = "block"; b.innerHTML = htmlFor(second); }
  else{ b.style.display = "none"; }
}
function renderHistory(){
  const list = $("#historyList"); list.innerHTML="";
  for(let i=matches.length-1;i>=0;i--){
    const m = matches[i];
    const card = document.createElement("div");
    card.className = "last";
    card.style.borderStyle = "solid";
    card.innerHTML = `
      <div class="muted" style="font-size:12px">${tsToString(m.ts)}</div>
      <div style="margin-top:2px"><span class="tag tag-red">HUNTER</span> <b>${escapeHtml(m.hunter)}</b></div>
      <div style="margin-top:2px"><span class="tag">SURVIVORS</span> <b>${m.survivors.map(escapeHtml).join("、 ")}</b></div>
      ${manualMode ? `<div style="margin-top:6px"><button class="btn btn-danger tiny" onclick="deleteMatch(${i})">この試合を削除</button></div>` : ``}
    `;
    list.appendChild(card);
  }
}

/* ===== CSV ===== */
function exportCSV(){
  const header=["name","active","survivor_count","hunter_count","pref","joinTs","lastTs","sAdj","hAdj"];
  const lines=[header.join(",")];
  players.forEach(p=>{
    const row=[csvEsc(p.name),p.active?1:0,p.sCount,p.hCount,p.pref,p.joinTs||"",p.lastTs||"",p.sAdj||0,p.hAdj||0].join(",");
    lines.push(row);
  });
  const blob=new Blob(["\uFEFF"+lines.join("\n")],{type:"text/csv"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=`identityv_players_${new Date().toISOString().slice(0,10)}.csv`;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),800);
}
function csvEsc(t){t=String(t);return /[",\n]/.test(t)?'"'+t.replaceAll('"','""')+'"':t}

/* ===== 初期化 ===== */
window.addEventListener("DOMContentLoaded", ()=>{
  applyTheme(localStorage.getItem(THEME_KEY) || 'auto');
  recomputeCountsFromMatches(true);
  $("#manualToggle").checked = manualMode;
  $("#dualToggle").checked = dualMode;
  $("#dualToggleDock").checked = dualMode;
  render();
  $("#year").textContent = new Date().getFullYear();

  try{
    const nbtn = document.getElementById('notifyBtn');
    const ibtn = document.getElementById('iosGuideBtn');
    if (notificationsSupported()){
      if (nbtn) nbtn.style.display = '';
      if (ibtn) ibtn.style.display = 'none';
    }else{
      if (nbtn) nbtn.style.display = 'none';
      if (ibtn) ibtn.style.display = isIOS() ? '' : 'none';
      const m = document.getElementById('miniLineup');
      if (m) m.textContent = '（通知非対応：確定するとここに最新メンバーが表示されます）';
    }
  }catch(_e){}
});

/* ===== 配信用オーバーレイ ===== */
const overlayChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('iv_overlay') : null;

function getOverlayMatches(){
  if(!matches || matches.length===0) return [];
  const last = matches[matches.length-1];
  const second = matches[matches.length-2];
  const two = second && Math.abs((last.ts||0)-(second.ts||0))<=2000;
  return two ? [second,last] : [last];
}
function broadcastOverlayState(){
  if(!overlayChannel) return;
  const items = getOverlayMatches().map(m=>({ ts:m.ts, hunter:m.hunter, survivors:m.survivors }));
  overlayChannel.postMessage({type:'state', payload:{ t:Date.now(), items }});
}
function openOverlay(){
  const url = new URL(location.href);
  url.searchParams.set('overlay','1');
  window.open(url.toString(), 'overlay', 'width=1200,height=340,noopener,noreferrer');
}

(function initOverlayMode(){
  const params = new URLSearchParams(location.search);
  if(params.get('overlay')!=='1') return;

  if(params.get('transparent')==='1'){
    document.documentElement.classList.add('transparent-bg');
    document.body.classList.add('transparent-bg');
  }
  const themeParam = (params.get('theme')||'').toLowerCase();
  if(themeParam==='light' || themeParam==='dark'){
    document.documentElement.setAttribute('data-theme', themeParam);
  }else{
    document.documentElement.removeAttribute('data-theme');
  }
  const scale = parseFloat(params.get('scale') || '1');
  const hideTitle = params.get('title') === '0';

  document.body.innerHTML = `
    <div id="ovRoot" class="overlay-root" style="transform:scale(${isFinite(scale)?scale:1}); transform-origin: top center;">
      <div id="ovWrap" class="overlay-split"></div>
    </div>
  `;
  document.title = '対戦リスト（配信用）';

  function refreshMatchesFromStorage(){
    try{ matches = JSON.parse(localStorage.getItem('iv_matches') || '[]'); }catch(_e){}
  }
  function renderOverlayFromLocal(){
    refreshMatchesFromStorage();
    const items = getOverlayMatches();
    renderOverlay(items);
  }
  function renderOverlay(items){
    const wrap = document.getElementById('ovWrap');
    if(!wrap) return;
    wrap.innerHTML = '';
    if(!items || items.length===0){
      const d = document.createElement('div');
      d.className = 'overlay-card';
      d.innerHTML = `<div class="overlay-title">対戦リスト</div><div class="overlay-time">まだ試合がありません</div>`;
      wrap.appendChild(d);
      return;
    }
    items.forEach((m,i)=>{
      const card = document.createElement('div');
      card.className = 'overlay-card';
      const titleHtml = hideTitle ? '' : `<div class="overlay-title">対戦リスト ${items.length>1 ? (i===0?'A':'B') : ''}</div>`;
      card.innerHTML = `
        ${titleHtml}
        <div class="overlay-time">${tsToString(m.ts)}</div>
        <div class="overlay-row"><span class="overlay-tag overlay-tag-red">HUNTER</span> <b>${escapeHtml(m.hunter)}</b></div>
        <div class="overlay-row"><span class="overlay-tag">SURVIVORS</span> <b>${m.survivors.map(escapeHtml).join('、 ')}</b></div>
      `;
      wrap.appendChild(card);
    });
  }

  renderOverlayFromLocal();

  if(overlayChannel){
    overlayChannel.onmessage = (ev)=>{
      if(!ev || !ev.data || ev.data.type!=='state') return;
      const items = ev.data.payload?.items || [];
      renderOverlay(items.map(x=>({ts:x.ts, hunter:x.hunter, survivors:x.survivors})));
    };
  }
  window.addEventListener('storage', (e)=>{
    if(e.key === 'iv_matches'){ renderOverlayFromLocal(); }
  });
  setInterval(()=>{ try{ renderOverlayFromLocal(); }catch(_e){} }, 5000);
})();

/* ===== 通知（SW登録・権限・送信） ===== */
(async function registerSW(){
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); }
    catch(e) { console.warn('Service Worker 登録失敗', e); }
  }
})();

async function enableLineupNotifications(){
  if (!('Notification' in window)) { alert('このブラウザは通知に未対応です'); return; }
  const res = await Notification.requestPermission();
  if (res !== 'granted') { alert('通知が許可されませんでした'); return; }
  alert('通知を有効化しました。試合確定時に通知が届きます。');
}

async function notifyLatestLineup(matchesForNotify){
  if (!notificationsSupported()){
    try{
      const text = Array.isArray(matchesForNotify) && matchesForNotify.length === 2
        ? `[A] H:${matchesForNotify[0].hunter} / S:${matchesForNotify[0].survivors.join('、 ')}　|　[B] H:${matchesForNotify[1].hunter} / S:${matchesForNotify[1].survivors.join('、 ')}`
        : (()=>{ const m = Array.isArray(matchesForNotify)?matchesForNotify[0]:matchesForNotify; return `H:${m.hunter} / S:${m.survivors.join('、 ')}` })();
      const mini = document.getElementById('miniLineup');
      if (mini) mini.textContent = `最新：${text}`;
    }catch(e){ console.warn('mini panel 更新失敗', e); }
    return;
  }
  try{
    if (Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    let title = '次の対戦メンバー';
    let body = '';
    if (Array.isArray(matchesForNotify) && matchesForNotify.length === 2) {
      const [A,B] = matchesForNotify;
      body =
        `[A] H: ${A.hunter}\n` +
        `    S: ${A.survivors.join(' / ')}\n` +
        `[B] H: ${B.hunter}\n` +
        `    S: ${B.survivors.join(' / ')}`;
    } else {
      const m = Array.isArray(matchesForNotify) ? matchesForNotify[0] : matchesForNotify;
      body = `HUNTER: ${m.hunter}\nSURVIVORS: ${m.survivors.join(' / ')}`;
    }
    const payload = { type:'notify', payload:{ title, body, tag:'iv-lineup' } };
    if (reg.active) reg.active.postMessage(payload);
    else if (reg.showNotification) reg.showNotification(title, { body, tag:'iv-lineup', renotify:true });

    const mini = document.getElementById('miniLineup');
    if (mini) mini.textContent = body.replace(/\n/g, ' | ').replace(/S: /g, 'S:');
  }catch(e){ console.warn('通知エラー', e); }
}

