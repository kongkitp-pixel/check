'use strict';
/* ระบบเช็คชื่อ QR — หน้าเว็บ (ครู + นักเรียน) ใช้ Google Apps Script เป็น backend
 * ครู:     เปิดหน้าเว็บปกติ แล้วกรอกรหัสผ่านครู
 * นักเรียน: เปิดลิงก์ส่วนตัว  #/s/<ห้อง>/<รหัส>/<รหัสลับ>  (ครั้งแรกครั้งเดียว) แล้วกดสแกน QR
 */
const CFG = window.CONFIG || {};
const $ = (s, e = document) => e.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rand = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, '0')).join('');
const timeStr = iso => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { } },
  del(k) { try { localStorage.removeItem(k); } catch { } },
  sget(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  sset(k, v) { try { sessionStorage.setItem(k, v); } catch { } },
  sdel(k) { try { sessionStorage.removeItem(k); } catch { } },
};
const app = $('#app');
const baseUrl = () => location.origin + location.pathname;

function qrSvg(text, cell = 5) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}
const getKey = () => store.sget('att_key') || store.get('att_key') || '';

async function api(action, data = {}, teacher = false) {
  if (!CFG.API_URL || CFG.API_URL.indexOf('http') !== 0) throw new Error('ยังไม่ได้ตั้งค่า API_URL ในไฟล์ config.js');
  const body = { action, ...data }; if (teacher) body.key = getKey();
  let r;
  try { r = await fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(body) }); }
  catch { throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่'); }
  let j;
  try { j = await r.json(); } catch { throw new Error('เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ (ตรวจว่า Deploy เป็น Anyone และใช้ URL ที่ลงท้าย /exec)'); }
  if (!j.ok) { const e = new Error(j.error || 'เกิดข้อผิดพลาด'); e.auth = !!j.auth; throw e; }
  return j;
}
function getPos() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => res(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });
  });
}
function startScanner(video, onText) {
  let stopped = false, stream = null;
  (async () => {
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); video.srcObject = stream; await video.play(); }
    catch { onText(null, 'เปิดกล้องไม่ได้ กรุณาอนุญาตการใช้กล้องในเบราว์เซอร์ (ต้องเปิดผ่าน https)'); return; }
    const c = document.createElement('canvas'), ctx = c.getContext('2d', { willReadFrequently: true });
    const loop = () => {
      if (stopped) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = 480, h = Math.round(480 * video.videoHeight / video.videoWidth);
        c.width = w; c.height = h; ctx.drawImage(video, 0, 0, w, h);
        const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        if (code && code.data) onText(code.data);
      }
      requestAnimationFrame(loop);
    };
    loop();
  })();
  return () => { stopped = true; if (stream) stream.getTracks().forEach(t => t.stop()); };
}

// =====================================================================
// นักเรียน
// =====================================================================
const getDev = () => { let d = store.get('att_dev'); if (!d) { d = rand(8); store.set('att_dev', d); } return d; };
const getMe = () => { try { return JSON.parse(store.get('att_me') || 'null'); } catch { return null; } };

function stuShell(inner) { app.innerHTML = `<div class="stu">${inner}</div>`; }

async function studentRegister(classId, studentId, secret) {
  stuShell('<h1>กำลังผูกเครื่อง…</h1>');
  try {
    const j = await api('register', { classId, studentId, secret, dev: getDev() });
    store.set('att_me', JSON.stringify({ classId, studentId, secret, name: j.name }));
    history.replaceState(null, '', location.pathname + '#/me');
    meView();
  } catch (e) {
    stuShell(`<h1>ผูกเครื่องไม่สำเร็จ</h1><div class="res bad">${esc(e.message)}</div>`);
  }
}
function meView(token) {
  const me = getMe();
  if (!me) return stuShell('<h1>ยังไม่ได้ลงทะเบียน</h1><p class="muted">กรุณาเปิด <b>ลิงก์ส่วนตัว</b> ที่ครูให้ไว้ก่อน (ครั้งแรกครั้งเดียว) แล้วจึงสแกน QR เช็คชื่อ</p>');
  stuShell(`<h1>${esc(me.name)}</h1><p class="muted">รหัส ${esc(me.studentId)} · มือถือเครื่องนี้ผูกกับคุณแล้ว</p>
    <div id="box"></div>
    <button class="btn" id="scan" style="width:100%;font-size:18px;padding:14px">📷 สแกน QR เช็คชื่อ</button>
    <p class="muted">สแกน QR ที่ครูฉายบนจอ · ห้ามให้ผู้อื่นยืมมือถือนี้ไปเช็คชื่อ</p>`);
  $('#scan').onclick = openScanner;
  if (token) { history.replaceState(null, '', location.pathname + '#/me'); doCheckin(token); }
}
function openScanner() {
  $('#box').innerHTML = '<video id="v" playsinline muted></video><p class="muted" id="hint">เล็งกล้องไปที่ QR บนจอ</p><button class="btn sec" id="cancel">ยกเลิก</button>';
  let busy = false, stop;
  stop = startScanner($('#v'), (text, err) => {
    if (err) { stop(); return showResult('bad', err); }
    if (busy) return;
    const m = String(text).match(/#\/c\/([\w.\-]+)/);
    if (!m) { $('#hint') && ($('#hint').textContent = 'นี่ไม่ใช่ QR เช็คชื่อ ลองใหม่'); return; }
    busy = true; stop(); doCheckin(m[1]);
  });
  $('#cancel').onclick = () => { stop(); $('#box').innerHTML = ''; };
}
function showResult(kind, big, small = '') {
  const b = $('#box'); if (!b) return;
  b.innerHTML = `<div class="res ${kind}"><div class="big">${esc(big)}</div><div>${esc(small)}</div></div>`;
}
async function doCheckin(token) {
  const me = getMe();
  if (!me) return meView();
  showResult('warn', 'กำลังตรวจตำแหน่ง…');
  const pos = await getPos();
  showResult('warn', 'กำลังบันทึก…');
  try {
    const j = await api('checkin', { token, classId: me.classId, studentId: me.studentId, secret: me.secret, dev: getDev(), lat: pos ? pos.lat : undefined, lng: pos ? pos.lng : undefined, acc: pos ? pos.acc : undefined });
    const st = j.status === 'late' ? 'สาย' : j.status === 'leave' ? 'ลา' : 'มา';
    showResult(j.status === 'late' ? 'warn' : 'ok', j.already ? '✓ คุณเช็คชื่อไปแล้ว' : '✓ เช็คชื่อสำเร็จ', `${j.name} · ${st} · ${timeStr(j.ts)}`);
  } catch (e) { showResult('bad', '✗ เช็คชื่อไม่สำเร็จ', e.message); }
}

// =====================================================================
// ครู
// =====================================================================
const T = { tab: 'class', classes: [], cid: null, timer: null, tick: null };

async function teacherApp() {
  if (!getKey()) return loginView();
  try { await loadClasses(); } catch (e) { return loginView(e.message); }
  render();
}
function loginView(msg = '') {
  app.innerHTML = `<div class="card narrow"><h1>ระบบเช็คชื่อ QR Code</h1>
    <p class="muted">สำหรับครู — กรอกรหัสผ่านที่ตั้งไว้ใน Code.gs</p>
    <form id="f"><label>รหัสผ่านครู</label><input type="password" name="pw" required autocomplete="current-password">
    <label style="font-weight:400"><input type="checkbox" name="rem" style="width:auto"> จำไว้ในเครื่องนี้</label>
    <p class="err" id="e">${esc(msg)}</p><button class="btn" style="width:100%">เข้าสู่ระบบ</button></form></div>`;
  $('#f').onsubmit = async ev => {
    ev.preventDefault(); const fd = Object.fromEntries(new FormData(ev.target));
    store.sset('att_key', fd.pw); if (fd.rem) store.set('att_key', fd.pw);
    $('#e').textContent = 'กำลังตรวจสอบ…';
    try { await loadClasses(); render(); } catch (e) { store.sdel('att_key'); store.del('att_key'); $('#e').textContent = e.message; }
  };
}
async function loadClasses() {
  T.classes = (await api('classes', {}, true)).classes;
  if (!T.cid || !T.classes.find(c => c.classId === T.cid)) T.cid = T.classes[0]?.classId || null;
}
function clearTimers() { clearInterval(T.timer); clearInterval(T.tick); T.timer = T.tick = null; }
function render() {
  clearTimers();
  const live = store.get('att_sid');
  const tabs = [['class', 'ห้องเรียน/นักเรียน'], ['check', 'เช็คชื่อ' + (live ? ' ●' : '')], ['report', 'รายงาน']];
  app.innerHTML = `<header class="top"><span class="brand">เช็คชื่อ QR</span>
    <nav>${tabs.map(([k, l]) => `<button data-tab="${k}" class="${T.tab === k ? 'on' : ''}">${l}</button>`).join('')}</nav>
    <span class="sync" style="margin-left:auto"><button class="btn sm sec" id="lo">ออกจากระบบ</button></span></header><main id="main"></main>`;
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { T.tab = b.dataset.tab; render(); });
  $('#lo').onclick = () => { store.sdel('att_key'); store.del('att_key'); location.reload(); };
  ({ class: tabClass, check: tabCheck, report: tabReport })[T.tab]().catch(handleErr);
}
function handleErr(e) {
  if (e.auth) { store.sdel('att_key'); store.del('att_key'); return loginView(e.message); }
  const m = $('#main'); if (m) m.insertAdjacentHTML('afterbegin', `<div class="warnbox">⚠ ${esc(e.message)}</div>`);
}
function modal(html) {
  const o = document.createElement('div'); o.className = 'overlay';
  o.innerHTML = `<div class="box">${html}<p><button class="btn sec" data-x>ปิด</button></p></div>`;
  o.onclick = e => { if (e.target === o || e.target.dataset.x !== undefined) o.remove(); };
  document.body.appendChild(o);
}
const stuLink = (cid, s) => `${baseUrl()}#/s/${encodeURIComponent(cid)}/${encodeURIComponent(s.studentId)}/${encodeURIComponent(s.secret)}`;
async function act(fn) { try { await fn(); } catch (e) { if (e.auth) return handleErr(e); alert(e.message); } }

// ----- ห้องเรียน/นักเรียน -----
async function tabClass() {
  const cls = T.classes.find(c => c.classId === T.cid);
  const studs = cls ? (await api('students', { classId: cls.classId }, true)).students : [];
  $('#main').innerHTML = `
  <div class="card"><h2>ห้องเรียน</h2><div class="row">
    <div><label>เลือกห้อง</label><select id="csel">${T.classes.map(c => `<option value="${esc(c.classId)}" ${c.classId === T.cid ? 'selected' : ''}>${esc(c.name)} (${c.count} คน)</option>`).join('') || '<option>— ยังไม่มีห้อง —</option>'}</select></div>
    <div><label>เพิ่มห้องใหม่</label><input id="cname" placeholder="เช่น ม.4/2 ฟิสิกส์"></div>
    <div class="auto"><button class="btn" id="cadd">เพิ่มห้อง</button></div></div></div>
  ${cls ? `<div class="card"><h2>นักเรียนใน ${esc(cls.name)}</h2>
    <div class="tscroll"><table><thead><tr><th>รหัส</th><th>ชื่อ</th><th>เครื่อง</th><th></th></tr></thead><tbody>
    ${studs.map(s => `<tr><td>${esc(s.studentId)}</td><td>${esc(s.name)}</td><td>${s.bound ? '<span class="badge ok">ผูกแล้ว</span>' : '<span class="badge">ยังไม่ผูก</span>'}</td>
      <td style="white-space:nowrap"><button class="btn sm sec" data-link="${esc(s.studentId)}">ลิงก์/QR</button>
      <button class="btn sm sec" data-rd="${esc(s.studentId)}">รีเซ็ตเครื่อง</button>
      <button class="btn sm sec" data-rs="${esc(s.studentId)}">รหัสลับใหม่</button>
      <button class="btn sm red" data-del="${esc(s.studentId)}">ลบ</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">ยังไม่มีนักเรียน</td></tr>'}
    </tbody></table></div>
    <label>เพิ่มนักเรียน (บรรทัดละคน: <code>รหัส,ชื่อ</code> — วางจาก Excel ได้)</label>
    <textarea id="imp" placeholder="10001,สมชาย ใจดี&#10;10002,สมหญิง รักเรียน"></textarea>
    <div class="row" style="margin-top:8px"><div class="auto"><button class="btn" id="impbtn">เพิ่มนักเรียน</button></div>
    <div class="auto"><button class="btn sec" id="printall">พิมพ์บัตร QR ลิงก์ทุกคน</button></div></div>
    <div class="warnbox">⚠ ลิงก์ส่วนตัวเป็นความลับ ให้ส่งตรงถึงนักเรียนคนนั้นเท่านั้น และให้เปิดในมือถือของตัวเองเครื่องเดียว (เปิดครั้งแรกจะผูกเครื่องทันที)</div></div>` : ''}`;
  $('#csel').onchange = e => { T.cid = e.target.value; render(); };
  $('#cadd').onclick = () => act(async () => { const n = $('#cname').value.trim(); if (!n) return; const j = await api('addClass', { name: n }, true); T.cid = j.classId; await loadClasses(); render(); });
  if (!cls) return;
  $('#impbtn').onclick = () => act(async () => { const j = await api('addStudents', { classId: cls.classId, lines: $('#imp').value }, true); await loadClasses(); render(); alert(j.added ? `เพิ่ม ${j.added} คน` : 'ไม่มีรายการใหม่ (ตรวจรูปแบบ/รหัสซ้ำ)'); });
  $('#printall').onclick = () => {
    $('#printArea').innerHTML = studs.map(s => `<div class="pcard">${qrSvg(stuLink(cls.classId, s), 4)}<b>${esc(s.name)}</b><br>${esc(s.studentId)}<br>สแกนเพื่อลงทะเบียนมือถือ (ห้ามแชร์)</div>`).join('');
    print(); $('#printArea').innerHTML = '';
  };
  const byId = id => studs.find(x => x.studentId === id);
  document.querySelectorAll('[data-link]').forEach(b => b.onclick = () => { const s = byId(b.dataset.link), l = stuLink(cls.classId, s); modal(`<h2>${esc(s.name)}</h2>${qrSvg(l, 5)}<p class="muted">ให้นักเรียนสแกนด้วยมือถือตัวเอง หรือส่งลิงก์นี้ให้เฉพาะคนนี้</p><input readonly value="${esc(l)}" onclick="this.select()">`); });
  document.querySelectorAll('[data-rd]').forEach(b => b.onclick = () => { const s = byId(b.dataset.rd); if (confirm(`รีเซ็ตเครื่องที่ผูกของ ${s.name}?`)) act(async () => { await api('resetDevice', { classId: cls.classId, studentId: s.studentId }, true); render(); }); });
  document.querySelectorAll('[data-rs]').forEach(b => b.onclick = () => { const s = byId(b.dataset.rs); if (confirm(`สร้างรหัสลับใหม่ให้ ${s.name}? ลิงก์เดิมจะใช้ไม่ได้ทันที`)) act(async () => { await api('newSecret', { classId: cls.classId, studentId: s.studentId }, true); render(); }); });
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { const s = byId(b.dataset.del); if (confirm(`ลบ ${s.name}?`)) act(async () => { await api('delStudent', { classId: cls.classId, studentId: s.studentId }, true); await loadClasses(); render(); }); });
}

// ----- เช็คชื่อ -----
async function tabCheck() {
  const sid = store.get('att_sid');
  if (sid) return liveView(sid);
  $('#main').innerHTML = `<div class="card"><h2>เริ่มรอบเช็คชื่อใหม่</h2>
    <div class="row"><div><label>ห้อง</label><select id="scls">${T.classes.map(c => `<option value="${esc(c.classId)}" ${c.classId === T.cid ? 'selected' : ''}>${esc(c.name)} (${c.count} คน)</option>`).join('')}</select></div>
    <div><label>นับเป็น “สาย” หลังจากกี่นาที</label><input id="late" type="number" min="0" value="10"></div></div>
    <label style="font-weight:400"><input type="checkbox" id="gps" style="width:auto" checked> ตรวจตำแหน่ง GPS ของนักเรียน (ใช้ตำแหน่งของครูตอนนี้เป็นจุดห้องเรียน)</label>
    <div><label>รัศมีที่ยอมรับ (เมตร)</label><input id="rad" type="number" min="20" value="150"></div>
    <p class="muted">GPS ในอาคารอาจคลาดเคลื่อน แนะนำ 100–200 เมตร</p>
    <p><button class="btn" id="go">เริ่มเช็คชื่อ</button></p></div>`;
  $('#go').onclick = () => act(async () => {
    const classId = $('#scls').value; if (!classId) return alert('ยังไม่มีห้อง');
    const data = { classId, lateMin: +$('#late').value || 0 };
    if ($('#gps').checked) {
      $('#go').textContent = 'กำลังอ่านตำแหน่ง…';
      const p = await getPos(); if (!p) { $('#go').textContent = 'เริ่มเช็คชื่อ'; return alert('อ่านตำแหน่งครูไม่ได้ ตรวจสิทธิ์ตำแหน่งของเบราว์เซอร์ หรือปิดตัวเลือก GPS'); }
      Object.assign(data, { lat: p.lat, lng: p.lng, radius: +$('#rad').value || 150 });
    }
    const j = await api('start', data, true); store.set('att_sid', j.sessionId); T.cid = classId; render();
  });
}
async function liveView(sid) {
  $('#main').innerHTML = `
  <div class="card"><h2 id="ttl">กำลังเช็คชื่อ…</h2>
    <div class="row" style="align-items:flex-start">
      <div style="flex:1 1 360px;text-align:center"><div class="bigqr" id="qr"></div>
        <div class="bar"><i id="bar" style="width:100%"></i></div><p class="muted">ฉายหน้าจอนี้ให้นักเรียนสแกน · QR เปลี่ยนทุก 20 วินาที</p></div>
      <div style="flex:1 1 300px"><div class="stats" id="stats"></div>
        <h2>การสแกนที่ถูกปฏิเสธ</h2><div id="rej" class="muted">—</div>
        <h2 style="margin-top:14px">บันทึกโดยครู (มือถือเสีย / ลา)</h2>
        <select id="mst"></select>
        <div class="row"><select id="mstat"><option value="present">มา</option><option value="late">สาย</option><option value="leave">ลา</option></select><input id="mnote" placeholder="เหตุผล (จำเป็น)"></div>
        <p><button class="btn sec" id="mbtn">บันทึก</button></p></div></div></div>
  <div class="card"><h2>รายการที่เช็คแล้ว</h2><div class="tscroll"><table><tbody id="rec"></tbody></table></div>
    <p><button class="btn red" id="close">ปิดรอบเช็คชื่อ</button></p></div>`;
  let lastToken = null, left = 20, t0 = Date.now(), sig = '', win = 20;
  const lab = { present: ['มา', 'ok'], late: ['สาย', 'warn'], leave: ['ลา', ''] };
  const update = j => {
    if (j.status !== 'open') { store.del('att_sid'); T.tab = 'report'; return render(); }
    $('#ttl').innerHTML = `${esc(j.className)} <span class="badge ok">เปิดอยู่</span> <span class="muted">เริ่ม ${timeStr(j.start)} · สายหลัง ${j.lateMin} นาที · GPS ${j.gps ? 'เปิด' : 'ปิด'}</span>`;
    if (j.token !== lastToken) { lastToken = j.token; $('#qr').innerHTML = qrSvg(`${baseUrl()}#/c/${j.token}`, 5); }
    left = j.secondsLeft; win = j.windowSec; t0 = Date.now();
    const c = k => j.records.filter(r => r.status === k).length;
    $('#stats').innerHTML = `<div class="stat"><b>${c('present')}</b>มา</div><div class="stat"><b>${c('late')}</b>สาย</div><div class="stat"><b>${c('leave')}</b>ลา</div><div class="stat"><b>${j.roster.length - j.records.length}</b>ยังไม่เช็ค</div>`;
    $('#rej').innerHTML = j.rejects.length ? j.rejects.map(x => `<div>${timeStr(x.ts)} — ${esc(x.detail)}</div>`).join('') : '—';
    $('#rec').innerHTML = [...j.records].reverse().map(r => `<tr><td>${timeStr(r.ts)}</td><td>${esc(r.studentId)}</td><td>${esc(r.name)}</td><td><span class="badge ${lab[r.status][1]}">${lab[r.status][0]}</span> ${r.method === 'manual' ? `<span class="badge">ครูบันทึก: ${esc(r.note)}</span>` : ''}</td></tr>`).join('') || '<tr><td class="muted">ยังไม่มีรายการ</td></tr>';
    const done = new Set(j.records.map(r => r.studentId)), rest = j.roster.filter(x => !done.has(x.id)), ns = rest.map(x => x.id).join(',');
    if (ns !== sig) { sig = ns; const cur = $('#mst').value; $('#mst').innerHTML = rest.map(x => `<option value="${esc(x.id)}">${esc(x.id)} ${esc(x.name)}</option>`).join(''); if (rest.some(x => x.id === cur)) $('#mst').value = cur; }
  };
  const poll = async () => { try { update(await api('poll', { sessionId: sid }, true)); } catch (e) { if (e.auth) return handleErr(e); const m = $('#ttl'); if (m) m.innerHTML += ` <span class="badge bad">เชื่อมต่อขัดข้อง: ${esc(e.message)}</span>`; } };
  await poll();
  T.timer = setInterval(poll, 3000);
  T.tick = setInterval(() => { const l = Math.max(0, left - (Date.now() - t0) / 1000), b = $('#bar'); if (b) b.style.width = (l / win * 100) + '%'; }, 250);
  $('#mbtn').onclick = () => act(async () => {
    const note = $('#mnote').value.trim(); if (note.length < 3) return alert('กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร');
    if (!$('#mst').value) return;
    await api('manual', { sessionId: sid, studentId: $('#mst').value, status: $('#mstat').value, note }, true); $('#mnote').value = ''; poll();
  });
  $('#close').onclick = () => act(async () => {
    if (!confirm('ปิดรอบเช็คชื่อ? คนที่ยังไม่เช็คจะถูกนับเป็น “ขาด”')) return;
    await api('close', { sessionId: sid }, true); store.del('att_sid'); T.tab = 'report'; render();
  });
}

// ----- รายงาน -----
async function tabReport() {
  $('#main').innerHTML = `<div class="card"><h2>รายงานการเข้าเรียน</h2>
    <div class="row"><div><label>ห้อง</label><select id="rcls">${T.classes.map(c => `<option value="${esc(c.classId)}" ${c.classId === T.cid ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    <div class="auto"><button class="btn" id="rload">โหลดรายงาน</button></div><div class="auto"><button class="btn sec" id="rcsv" disabled>ส่งออก CSV</button></div></div>
    <div id="rout" class="muted" style="margin-top:12px">กด “โหลดรายงาน”</div></div>`;
  let t = null;
  $('#rload').onclick = () => act(async () => {
    T.cid = $('#rcls').value; $('#rout').textContent = 'กำลังโหลด…';
    t = await api('report', { classId: T.cid }, true);
    if (!t.sessions.length) { $('#rout').textContent = 'ยังไม่มีข้อมูลการเช็คชื่อของห้องนี้'; return; }
    const col = c => c === 'มา' ? 'ok' : c === 'สาย' ? 'warn' : c === 'ขาด' ? 'bad' : '';
    $('#rout').innerHTML = `<div class="tscroll"><table><thead><tr><th>รหัส</th><th>ชื่อ</th>${t.sessions.map(s => `<th>${esc(s.date)}<br><span class="badge ${s.ok ? 'ok' : 'bad'}">${s.ok ? 'ข้อมูลครบถ้วน' : 'ถูกแก้ไข!'}</span></th>`).join('')}<th>%</th></tr></thead>
      <tbody>${t.rows.map(r => `<tr><td>${esc(r.id)}</td><td>${esc(r.name)}</td>${r.cells.map(c => `<td><span class="badge ${col(c)}">${c}</span></td>`).join('')}<td><b>${r.pct}%</b></td></tr>`).join('')}</tbody></table></div>
      <p class="muted">“ข้อมูลครบถ้วน” = ตรวจ hash chain (ลงลายเซ็นด้วยกุญแจเซิร์ฟเวอร์) แล้วไม่พบการแก้/ลบ/แทรกรายการ · อย่าเรียงลำดับหรือแก้ชีต Records ด้วยมือ</p>`;
    $('#rcsv').disabled = false;
  });
  $('#rcsv').onclick = () => {
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['รหัส', 'ชื่อ', ...t.sessions.map(s => s.date + '_' + s.id), '% เข้าเรียน'].map(q).join(',')];
    t.rows.forEach(r => lines.push([r.id, r.name, ...r.cells, r.pct].map(q).join(',')));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `attendance_${new Date().toLocaleDateString('sv-SE')}.csv`; a.click();
  };
}

// ---------- routing (ต้องอยู่ท้ายไฟล์) ----------
{
  const h = location.hash;
  let m;
  if ((m = h.match(/^#\/s\/([^/]+)\/([^/]+)\/([^/]+)$/))) studentRegister(...m.slice(1).map(decodeURIComponent));
  else if ((m = h.match(/^#\/c\/([\w.\-]+)$/))) meView(m[1]);
  else if (h === '#/me') meView();
  else teacherApp();
  addEventListener('hashchange', () => location.reload());
}
