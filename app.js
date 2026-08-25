/* ============================================================
 *  سامانه اشتراک‌های گاز — نسخه استاتیک (GitHub Pages + Supabase)
 * ============================================================ */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const S = window.GazShared;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const faNum = n => Number(n || 0).toLocaleString('fa-IR');
const faDateFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'long', day: 'numeric' });
const faDateShortFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: 'numeric', day: 'numeric' });
function faDate(iso) {
  if (!iso) return '—';
  const d = String(iso).slice(0, 10);
  try { return faDateFmt.format(new Date(d + 'T12:00:00')); } catch { return d; }
}
const faDateNumFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' });
// تاریخ شمسی عددی: «۱۴۰۳/۰۶/۰۲» — برای خروجی اکسل و راهنمای کنار تاریخ‌ها
function faDateNum(iso, empty = '') {
  if (!iso) return empty;
  const d = String(iso).slice(0, 10);
  try { return faDateNumFmt.format(new Date(d + 'T12:00:00')); } catch { return d; }
}
const todayISO = () => new Date().toISOString().slice(0, 10);

/* راهنمای شمسی زیر همه ورودی‌های تاریخ (کنترل date مرورگر میلادی است) */
function refreshJalaliHints() {
  $$('input[type="date"]').forEach(inp => {
    const span = inp.parentElement && inp.parentElement.querySelector('.jalali-hint[data-for="' + inp.id + '"]');
    if (span) span.textContent = inp.value ? ('🗓️ معادل شمسی: ' + faDateNum(inp.value) + '  —  ' + faDate(inp.value)) : '';
  });
}
function attachJalaliHints() {
  $$('input[type="date"]').forEach(inp => {
    if (!inp.id || inp._jalaliAttached) return;
    inp._jalaliAttached = true;
    const span = document.createElement('div');
    span.className = 'jalali-hint';
    span.setAttribute('data-for', inp.id);
    inp.insertAdjacentElement('afterend', span);
    inp.addEventListener('input', refreshJalaliHints);
    inp.addEventListener('change', refreshJalaliHints);
  });
  refreshJalaliHints();
}
attachJalaliHints(); // اسکریپت انتهای body اجرا می‌شود؛ ورودی‌ها موجودند

let toastTimer;
function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.className = '', 4000);
}

const STATUS = {
  new: { cls: 'green', txt: 'ثبت جدید ✅' },
  duplicate: { cls: 'amber', txt: 'تکراری 🔁' },
  not_found: { cls: 'red', txt: 'ناموجود در لیست ❌' },
};
const STATUS_FA = { new: 'ثبت جدید', duplicate: 'تکراری', not_found: 'ناموجود در لیست' };
const statusBadge = s => `<span class="badge ${STATUS[s]?.cls || 'gray'}">${STATUS[s]?.txt || esc(s)}</span>`;

/* ================= Supabase connection ================= */
let sb = null;

function getCreds() {
  const url = (localStorage.getItem('gaz_supa_url') || (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '') || '').trim();
  const key = (localStorage.getItem('gaz_supa_key') || (typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '') || '').trim();
  return { url, key };
}

function connect(url, key) {
  sb = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
}

async function testConnection() {
  // اگر schema.sql اجرا نشده باشد، این کوئری خطا می‌دهد
  const { error } = await sb.from('managers').select('id', { count: 'exact', head: true });
  if (error) throw error;
}

function friendlySetupError(e) {
  const m = String(e?.message || e);
  if (m.includes('does not exist') || m.includes('schema cache'))
    return 'جداول ساخته نشده‌اند — فایل schema.sql را در SQL Editor پروژه Supabase اجرا کنید (مرحله ۳ راهنما).';
  if (m.includes('Failed to fetch') || m.includes('fetch'))
    return 'اتصال برقرار نشد — آدرس Project URL را بررسی کنید و به اینترنت متصل باشید.';
  if (m.includes('API key') || m.includes('apikey') || m.includes('JWT'))
    return 'کلید API معتبر نیست — کلید «anon public» را از Settings → API کپی کنید.';
  return 'خطا: ' + m;
}

/* ================= views ================= */
function show(id) {
  ['setupView', 'loginView', 'appView'].forEach(v => $('#' + v).classList.add('hidden'));
  $('#' + id).classList.remove('hidden');
}

$('#setupForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#setupError').textContent = '';
  const url = $('#setupUrl').value.trim(), key = $('#setupKey').value.trim();
  if (!url || !key) { $('#setupError').textContent = 'هر دو مقدار لازم است'; return; }
  const btn = $('#setupBtn'); btn.disabled = true; btn.textContent = 'در حال اتصال...';
  try {
    connect(url, key);
    await testConnection();
    localStorage.setItem('gaz_supa_url', url);
    localStorage.setItem('gaz_supa_key', key);
    await boot();
  } catch (err) {
    $('#setupError').textContent = friendlySetupError(err);
  } finally {
    btn.disabled = false; btn.textContent = 'اتصال و ادامه';
  }
});

$('#resetCredsLink').addEventListener('click', e => {
  e.preventDefault();
  localStorage.removeItem('gaz_supa_url');
  localStorage.removeItem('gaz_supa_key');
  show('setupView');
});

/* ================= auth ================= */
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#loginError').textContent = '';
  const btn = $('#loginBtn'); btn.disabled = true; btn.textContent = 'در حال ورود...';
  try {
    const { error } = await sb.auth.signInWithPassword({
      email: $('#loginEmail').value.trim().toLowerCase(),
      password: $('#loginPass').value
    });
    if (error) throw error;
    await boot();
  } catch (err) {
    $('#loginError').textContent = String(err.message).includes('Invalid login')
      ? 'ایمیل یا رمز عبور اشتباه است' : ('خطا: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'ورود به سامانه';
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  try { await sb.auth.signOut(); } catch {}
  location.reload();
});

let ME = null;

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { show('loginView'); return; }
  ME = session.user;
  show('appView');
  $('#userName').textContent = ME.email || 'مدیر';
  $('#userAvatar').textContent = (ME.email || 'م').charAt(0).toUpperCase();
  $('#currentAdminEmail').textContent = ME.email || '-';
  await refreshManagers();
  setJalaliDateInput('#recordDate', todayISO());
  refreshJalaliHints();
  loadDashboard();
}

/* ================= مودال عمومی ================= */
function openModal(title, bodyHTML, onSave) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHTML;
  $('#modalOverlay').classList.remove('hidden');
  window.__modalSave = onSave;
  if (typeof attachJalaliHints === 'function') attachJalaliHints();
}
function closeModal() { $('#modalOverlay').classList.add('hidden'); window.__modalSave = null; }
$('#modalCancel').addEventListener('click', closeModal);
$('#modalOverlay').addEventListener('click', e => { if (e.target.id === 'modalOverlay') closeModal(); });
$('#modalSave').addEventListener('click', async () => {
  const btn = $('#modalSave'); btn.disabled = true;
  try { const r = await (window.__modalSave || (async () => {}))(); if (r !== false) closeModal(); }
  catch (e) { toast('خطا: ' + e.message, 'err'); }
  finally { btn.disabled = false; }
});

/* خروجی اکسل چند شیتی */
function downloadWorkbook(sheets, filename) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(sh => {
    const ws = XLSX.utils.json_to_sheet(sh.rows.length ? sh.rows : [{ 'اطلاع': 'داده‌ای وجود ندارد' }]);
    if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] };
    XLSX.utils.book_append_sheet(wb, ws, (sh.name || 'sheet').slice(0, 31));
  });
  XLSX.writeFile(wb, filename);
}

/* ================= navigation ================= */
$$('.nav-btn').forEach(btn => btn.addEventListener('click', () => {
  $$('.nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const tab = btn.dataset.tab;
  $$('main.content > section').forEach(s => s.classList.add('hidden'));
  $('#tab-' + tab).classList.remove('hidden');
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'manager-statement') loadManagerStatement();
  if (tab === 'upload') { loadUploadsTable(); refreshMasterLiveCount(); }
  if (tab === 'subs') loadSubs();
  if (tab === 'records') loadRecords();
  if (tab === 'settings') loadSettings();
}));

/* ================= managers ================= */
let MANAGERS = [];
async function refreshManagers() {
  const { data, error } = await sb.from('managers').select('id,name,color').order('id');
  if (error) { toast(friendlySetupError(error), 'err'); return; }
  MANAGERS = data || [];
  const opts = MANAGERS.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  const recMgr = $('#recManager');
  if (recMgr) recMgr.innerHTML = '<option value="">همه</option>' + opts;
  const dashMgr = $('#dashManager');
  if (dashMgr) dashMgr.innerHTML = '<option value="">همه مدیران</option>' + opts;
}
const mgrColor = id => (MANAGERS.find(m => m.id === id) || {}).color || '#38bdf8';

/* ================= dashboard ================= */
function statCard(label, value, color, sub) {
  return `<div class="stat-card" style="--sc:${color}">
    <div class="lbl">${label}</div><div class="val">${faNum(value)}</div>
    ${sub ? `<div class="sub2">${sub}</div>` : ''}</div>`;
}

async function loadDashboard() {
  let from, to;
  try { from = getJalaliDateInput('#dashFrom', null); to = getJalaliDateInput('#dashTo', null); }
  catch (e) { return toast(e.message, 'err'); }
  const mid = $('#dashManager') && $('#dashManager').value ? Number($('#dashManager').value) : null;
  const { data: d, error } = await sb.rpc('dashboard_stats', { p_from: from, p_to: to, p_manager: mid });
  if (error) return toast('خطا در بارگذاری آمار: ' + error.message, 'err');
  window.__lastDash = { d, mid };

  const remaining = Math.max(0, d.masterCount - d.validUnique);
  const progress = d.masterCount ? Math.round(d.validUnique * 1000 / d.masterCount) / 10 : 0;

  $('#statsGrid').innerHTML =
    statCard('اشتراک‌های شرکت گاز', d.masterCount, '#38bdf8') +
    statCard('ثبت‌شده معتبر (یکتا)', d.validUnique, '#34d399', 'اشتراک‌هایی که در لیست شرکت گاز هم هستند') +
    statCard('باقی‌مانده', remaining, '#f59e0b') +
    statCard('کل اشتراک‌های ثبت‌شده (یکتا)', d.registeredUnique, '#a78bfa', 'از همه فایل‌های روزانه') +
    statCard('رکوردهای امروز', d.todayRows, '#38bdf8', faDate(todayISO())) +
    statCard('ثبت تکراری', d.dupRows, '#fbbf24', 'قبلاً ثبت شده بودند') +
    statCard('ناموجود در لیست گاز', d.nfRows, '#f87171', 'در لیست شرکت گاز نیستند');

  $('#progressNum').innerHTML = faNum(progress) + '<small>٪ از کل اشتراک‌ها</small>';
  requestAnimationFrame(() => $('#progressFill').style.width = Math.min(100, progress) + '%');

  if (!$('#dashFrom').value) setJalaliDateInput('#dashFrom', d.from);
  if (!$('#dashTo').value) setJalaliDateInput('#dashTo', d.to);

  renderCharts(d, progress);
  renderMgrTable(d);
  loadDbUsage();
  // داشبورد اختصاصی هر مدیر
  const mgrCard = $('#mgrTableCard'), inspCard = $('#inspCard');
  if (mid) {
    if (mgrCard) mgrCard.classList.add('hidden');
    if (inspCard) inspCard.classList.remove('hidden');
    loadInspectors(mid, from, to);
  } else {
    if (mgrCard) mgrCard.classList.remove('hidden');
    if (inspCard) inspCard.classList.add('hidden');
  }
}

/* ممیزهای یک مدیر پروژه */
async function loadInspectors(mid, from, to) {
  try {
    const { data, error } = await sb.rpc('manager_inspectors', { p_manager: mid, p_from: from, p_to: to });
    if (error) throw new Error(error.message);
    const rows = data.rows || [];
    window.__lastInsp = rows;
    const mgrName = (MANAGERS.find(m => m.id === mid) || {}).name || '';
    $('#inspCardTitle').textContent = '👷 ممیزهای ' + mgrName;
    $('#inspTable tbody').innerHTML = rows.length ? rows.map(r => `<tr>
      <td><b>${esc(r.insp)}</b></td>
      <td>${faNum(r.c)}</td>
      <td style="color:var(--green)">${faNum(r.today_c || 0)}</td>
    </tr>`).join('') : '<tr><td colspan="3"><div class="empty-state"><div class="big">👷</div>هنوز ثبت معتبری برای این مدیر در این بازه نیست</div></td></tr>';
  } catch (e) {
    $('#inspCard').classList.add('hidden');
    toast('خطا در بارگذاری ممیزها: ' + e.message, 'err');
  }
}

/* خروجی اکسل داشبورد */
$('#dashExportBtn').addEventListener('click', () => {
  const L = window.__lastDash;
  if (!L || !L.d) return toast('اول «اعمال بازه» را بزنید تا آمار بیاید', 'err');
  const d = L.d;
  const mgrName = L.mid ? (MANAGERS.find(m => m.id === L.mid) || {}).name || '' : 'همه مدیران';
  const sum = [
    { 'عنوان': 'بازه گزارش', 'مقدار': faDate(d.from) + ' تا ' + faDate(d.to) },
    { 'عنوان': 'مدیر پروژه', 'مقدار': mgrName },
    { 'عنوان': 'اشتراک‌های شرکت گاز', 'مقدار': faNum(d.masterCount) },
    { 'عنوان': 'ثبت‌شده معتبر (یکتا)', 'مقدار': faNum(d.validUnique) },
    { 'عنوان': 'باقی‌مانده', 'مقدار': faNum(Math.max(0, d.masterCount - d.validUnique)) },
    { 'عنوان': 'کل ثبت‌شده یکتا', 'مقدار': faNum(d.registeredUnique) },
    { 'عنوان': 'رکوردهای امروز', 'مقدار': faNum(d.todayRows) },
    { 'عنوان': 'ثبت تکراری (مجموع)', 'مقدار': faNum(d.dupRows) },
    { 'عنوان': 'ناموجود در لیست (مجموع)', 'مقدار': faNum(d.nfRows) },
  ];
  const mgrRows = MANAGERS.map(m => {
    const s = (d.mgrStats || []).find(x => x.manager_id === m.id) || { uniq: 0, rows_n: 0, dups: 0, nf: 0 };
    const valid = ((d.bar || []).find(b => b.manager_id === m.id) || {}).c || 0;
    return { 'مدیر پروژه': m.name, 'اشتراک معتبر ثبت‌شده': valid, 'کل رکوردهای ارسالی': s.rows_n || 0, 'خطای تکراری': s.dups || 0, 'خطای ناموجود': s.nf || 0 };
  });
  const sheets = [{ name: 'خلاصه داشبورد', rows: sum }, { name: 'عملکرد مدیران', rows: mgrRows }];
  if (L.mid && window.__lastInsp) {
    sheets.push({ name: 'ممیزها', rows: window.__lastInsp.map(r => ({ 'ممیز / بازدیدکننده': r.insp, 'کل ثبت‌های معتبر': r.c, 'ثبت‌های امروز': r.today_c || 0 })) });
  }
  downloadWorkbook(sheets, `داشبورد-${mgrName}-${faDateNum(d.from)}-تا-${faDateNum(d.to)}.xlsx`);
  toast('خروجی داشبورد دانلود شد ✅', 'ok');
});

$('#dashManager').addEventListener('change', () => loadDashboard());

/* کارت فضای دیتابیس (نیازمند اجرای schema.sql جدید) */
const fmtMB = bytes => { const mb = Number(bytes || 0) / 1048576; return mb >= 100 ? faNum(Math.round(mb)) : faNum(Math.round(mb * 10) / 10); };
async function loadDbUsage() {
  const card = $('#dbUsageCard');
  if (!card) return;
  try {
    const { data: u, error } = await sb.rpc('db_usage');
    if (error) throw new Error(error.message);
    renderDbUsage(u);
  } catch { card.classList.add('hidden'); }
}
function renderDbUsage(u) {
  const card = $('#dbUsageCard');
  const total = Number(u.total || 0);
  const quotaMb = Number(u.quota_mb || 500);
  const pct = Math.min(100, (total / 1048576) * 100 / quotaMb);
  $('#dbUsageVal').innerHTML = `${fmtMB(total)}<small> از ${faNum(quotaMb)} مگابایت (${faNum(Math.round(pct))}٪)</small>`;
  const fill = $('#dbUsageFill');
  fill.style.width = pct + '%';
  fill.style.background = pct >= 85 ? 'linear-gradient(90deg,#f87171,#ef4444)'
    : pct >= 60 ? 'linear-gradient(90deg,#fbbf24,#f59e0b)' : '';
  $('#dbUsageDetail').textContent =
    `لیست شرکت گاز: ${fmtMB(u.subs)} مگابایت · ثبت‌شده‌ها: ${fmtMB(u.records)} مگابایت · تاریخچه: ${fmtMB(u.uploads)} مگابایت · مدیرها: ${fmtMB(u.managers)} مگابایت — سهمیه پلن رایگان Supabase`;
  card.classList.remove('hidden');
}

function dayList(from, to) {
  const out = [];
  let cur = new Date(from + 'T12:00:00');
  const end = new Date(to + 'T12:00:00');
  while (cur <= end && out.length < 400) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

let chartBar = null, chartLine = null;
const rtlTooltip = { rtl: true, textDirection: 'rtl' };

function renderCharts(d) {
  Chart.defaults.font.family = "'Vazirmatn', Tahoma, sans-serif";
  Chart.defaults.color = '#8ea0c2';
  Chart.defaults.borderColor = 'rgba(34,51,84,.6)';

  const labels = MANAGERS.map(m => m.name);
  const counts = MANAGERS.map(m => (d.bar.find(b => b.manager_id === m.id) || {}).c || 0);
  const colors = MANAGERS.map(m => m.color);
  if (chartBar) chartBar.destroy();
  chartBar = new Chart($('#barChart'), {
    type: 'bar',
    data: { labels, datasets: [{ data: counts, backgroundColor: colors.map(c => c + 'cc'), borderColor: colors, borderWidth: 2, borderRadius: 10, maxBarThickness: 70 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { ...rtlTooltip, callbacks: { label: c => ' ' + faNum(c.parsed.y) + ' اشتراک معتبر' } } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } }
    }
  });

  const days = dayList(d.from, d.to);
  const datasets = MANAGERS.map(m => {
    const map = {};
    d.line.filter(l => l.manager_id === m.id).forEach(l => map[l.d] = l.c);
    return {
      label: m.name, data: days.map(day => map[day] || 0),
      borderColor: m.color, backgroundColor: m.color + '22',
      tension: .35, pointRadius: 2.5, borderWidth: 2.5, fill: true,
    };
  });
  if (chartLine) chartLine.destroy();
  chartLine = new Chart($('#lineChart'), {
    type: 'line',
    data: { labels: days.map(day => { try { return faDateShortFmt.format(new Date(day + 'T12:00:00')); } catch { return day; } }), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { rtl: true, textDirection: 'rtl', labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: rtlTooltip },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 14 } } }
    }
  });
}

function renderMgrTable(d) {
  const rows = MANAGERS.map(m => {
    const s = d.mgrStats.find(x => x.manager_id === m.id) || { uniq: 0, rows_n: 0, dups: 0, nf: 0 };
    const valid = (d.bar.find(b => b.manager_id === m.id) || {}).c || 0;
    return `<tr>
      <td><span class="dot" style="background:${m.color}"></span> ${esc(m.name)}</td>
      <td><b style="color:var(--green)">${faNum(valid)}</b></td>
      <td>${faNum(s.rows_n)}</td>
      <td>${faNum(s.dups)}</td>
      <td>${faNum(s.nf)}</td>
    </tr>`;
  }).join('');
  $('#mgrTable tbody').innerHTML = rows || '<tr><td colspan="5" class="muted" style="text-align:center">داده‌ای نیست</td></tr>';
}

$('#applyRange').addEventListener('click', () => loadDashboard());
$$('.quick-range').forEach(b => b.addEventListener('click', () => {
  const v = b.dataset.days;
  const to = todayISO();
  if (v === 'all') {
    $('#dashFrom').value = ''; setJalaliDateInput('#dashTo', to);
  } else {
    const d = new Date(); d.setDate(d.getDate() - (parseInt(v) - 1));
    setJalaliDateInput('#dashFrom', d.toISOString().slice(0, 10));
    setJalaliDateInput('#dashTo', to);
  }
  refreshJalaliHints();
  loadDashboard();
}));

/* ================= check ================= */
async function runCheck(rawNumbers) {
  const uniq = [...new Set(rawNumbers.map(n => S.normalizeSubNo(n)).filter(Boolean))];
  const subMap = {}, recMap = {};
  for (let i = 0; i < uniq.length; i += 150) {
    const chunk = uniq.slice(i, i + 150);
    const [{ data: subs, error: e1 }, { data: recs, error: e2 }] = await Promise.all([
      sb.from('subs').select('sub_no,data').in('sub_no', chunk),
      sb.from('records_view').select('id,sub_no,visit_date,status,manager_name,filename,data').in('sub_no', chunk).order('id')
    ]);
    if (e1 || e2) throw new Error((e1 || e2).message);
    (subs || []).forEach(s => subMap[s.sub_no] = s.data);
    (recs || []).forEach(r => { (recMap[r.sub_no] = recMap[r.sub_no] || []).push(r); });
  }
  return uniq.map(no => {
    const recs = recMap[no] || [];
    return {
      sub_no: no,
      in_master: !!subMap[no],
      master_data: subMap[no] || null,
      registered: recs.length > 0,
      times: recs.length,
      first: recs.find(x => x.status === 'new') || recs[0] || null,
    };
  });
}

$('#checkBtn').addEventListener('click', async () => {
  const v = $('#checkInput').value.trim();
  if (!v) return toast('شماره اشتراک را وارد کنید', 'err');
  try {
    const [r] = await runCheck([v]);
    renderSingle(r, $('#checkResult'));
  } catch (e) { toast('خطا: ' + e.message, 'err'); }
});
$('#checkInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#checkBtn').click(); });

function renderSingle(r, box) {
  if (!r) { box.innerHTML = ''; return; }
  let icon, title, cls;
  if (r.in_master && r.registered) { icon = '🔁'; title = 'این اشتراک قبلاً ثبت شده است'; cls = 'amber'; }
  else if (r.in_master) { icon = '✅'; title = 'در لیست شرکت گاز هست و تاکنون ثبت نشده'; cls = 'green'; }
  else if (r.registered && r.first && r.first.status === 'not_found') { icon = '🚫'; title = 'قبلاً در فایل روزانه ارسال شده ولی در لیست شرکت گاز نبوده (ناموجود)'; cls = 'red'; }
  else if (r.registered) { icon = '⚠️'; title = 'ثبت شده اما در لیست شرکت گاز نیست!'; cls = 'red'; }
  else { icon = '❌'; title = 'نه در لیست شرکت گاز است، نه تاکنون ثبت شده'; cls = 'red'; }

  let html = `<div class="card">
    <div class="result-banner">
      <div class="rb-icon">${icon}</div>
      <div>
        <div class="rb-title" style="color:var(--${cls === 'amber' ? 'amber' : cls === 'green' ? 'green' : 'red'})">${title}</div>
        <div class="rb-sub">شماره اشتراک: <b class="ltr">${esc(r.sub_no)}</b></div>
      </div>
    </div>`;
  if (r.registered && r.first) {
    html += `<h3>وضعیت ثبت</h3>
    <table class="kv-table table-wrap">
      <tr><td>اولین ثبت</td><td>${faDate(r.first.visit_date)}</td></tr>
      <tr><td>مدیر پروژه (اولین ثبت)</td><td>${esc(r.first.manager_name || '—')}</td></tr>
      <tr><td>ممیز / بازدیدکننده (اولین ثبت)</td><td><b>${esc(extractInspector(r.first.data) || '—')}</b></td></tr>
      <tr><td>فایل</td><td class="ltr">${esc(r.first.filename || '—')}</td></tr>
      <tr><td>تعداد دفعات ثبت</td><td>${faNum(r.times)} بار</td></tr>
    </table>`;
  }
  if (r.in_master && r.master_data) {
    html += `<h3 class="mt">اطلاعات در لیست شرکت گاز («مربوط به کجاست»)</h3>
    <table class="kv-table table-wrap">
      ${Object.entries(r.master_data).filter(([k, v]) => v !== '').map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}
    </table>`;
  }
  html += '</div>';
  box.innerHTML = html;
}

$('#bulkBtn').addEventListener('click', async () => {
  const nums = $('#bulkInput').value.split(/[\n,،;]+/).map(s => s.trim()).filter(Boolean);
  if (!nums.length) return toast('حداقل یک شماره اشتراک وارد کنید', 'err');
  $('#bulkCount').textContent = faNum(nums.length) + ' شماره در حال بررسی...';
  try {
    const rows = await runCheck(nums);
    $('#bulkCount').textContent = '';
    const ok = rows.filter(r => r.in_master).length;
    const reg = rows.filter(r => r.registered).length;
    $('#bulkResult').innerHTML = `<div class="card">
      <div class="flex mb">
        <span class="badge blue">${faNum(rows.length)} شماره</span>
        <span class="badge green">${faNum(ok)} در لیست شرکت گاز</span>
        <span class="badge red">${faNum(rows.length - ok)} ناموجود</span>
        <span class="badge amber">${faNum(reg)} قبلاً ثبت شده</span>
      </div>
      <div class="table-wrap" style="max-height:420px;overflow-y:auto"><table>
        <thead><tr><th>شماره اشتراک</th><th>در لیست گاز</th><th>ثبت شده؟</th><th>اولین ثبت</th><th>مدیر</th><th>ممیز</th><th>دفعات</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td class="ltr">${esc(r.sub_no)}</td>
          <td>${r.in_master ? '<span class="badge green">بله ✅</span>' : '<span class="badge red">خیر ❌</span>'}</td>
          <td>${r.registered ? '<span class="badge amber">بله 🔁</span>' : '<span class="badge blue">نه</span>'}</td>
          <td>${r.first ? faDate(r.first.visit_date) : '—'}</td>
          <td>${esc(r.first?.manager_name || '—')}</td>
          <td>${esc(extractInspector(r.first?.data) || '—')}</td>
          <td>${faNum(r.times)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  } catch (e) {
    $('#bulkCount').textContent = '';
    toast('خطا: ' + e.message, 'err');
  }
});

/* تشخیص ستون تاریخ در فایل روزانه و تبدیل تاریخ شمسی/میلادی آن به ISO */
function detectVisitDateCol(headers, subCol) {
  return (headers || []).find(h => h !== subCol && /(?:تاریخ|date)/i.test(normalizeName(h)) && /(?:بازدید|ثبت|فرم|روز|date)/i.test(normalizeName(h)))
    || (headers || []).find(h => h !== subCol && /(?:تاریخ|date)/i.test(normalizeName(h))) || null;
}
function parseFileVisitDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  // تاریخ شمسی، با رقم فارسی یا انگلیسی
  const jalali = jalaliToISO(raw);
  if (jalali) return jalali;
  // ISO و حالت رایج YYYY/MM/DD میلادی
  const v = enDigits(raw).replace(/\//g, '-');
  const m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = new Date(`${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}T12:00:00`);
    if (!Number.isNaN(d.valueOf())) return d.toISOString().slice(0, 10);
  }
  return '';
}

/* ================= file reading ================= */
function readWorkbookRows(file) {
  return file.arrayBuffer().then(buf => S.parseWorkbook(buf, XLSX));
}
function bindFileName(inputId, nameId) {
  $(inputId).addEventListener('change', () => { $(nameId).textContent = $(inputId).files[0]?.name || ''; });
}
bindFileName('#masterFile', '#masterFileName');
bindFileName('#recordFile', '#recordFileName');

/* ================= master upload ================= */
function uploadOrderHint(subsCount) {
  return subsCount === 0
    ? '⚠️ لیست شرکت گاز خالی است! ابتدا از کارت ۱ بالای همین صفحه، فایل اکسل شرکت گاز را آپلود کنید و بعد فایل روزانه را بفرستید.'
    : null;
}
async function getSubsCount() {
  const { count, error } = await sb.from('subs').select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count || 0;
}
async function refreshMasterLiveCount() {
  const el = $('#masterLiveCount');
  if (!el) return;
  try {
    const n = await getSubsCount();
    el.innerHTML = n > 0
      ? `✅ لیست فعلی شرکت گاز: <b>${faNum(n)}</b> اشتراک در پایگاه‌داده موجود است`
      : '⚠️ لیست شرکت گاز هنوز خالی است — فایل ۱ را آپلود کنید';
    el.style.color = n > 0 ? 'var(--green)' : 'var(--amber)';
  } catch { el.textContent = ''; }
}

$('#masterUploadBtn').addEventListener('click', async () => {
  const f = $('#masterFile').files[0];
  if (!f) return toast('فایل اکسل شرکت گاز را انتخاب کنید', 'err');
  const btn = $('#masterUploadBtn');
  btn.disabled = true; btn.textContent = 'در حال پردازش...';
  $('#masterResult').innerHTML = '';
  try {
    const { rows, subCol } = await readWorkbookRows(f);
    if (!subCol) throw new Error('فایل خالی است');
    const { rows: uniq, empty, dupInFile } = S.dedupeRows(rows, subCol);
    if (!uniq.length) throw new Error('هیچ شماره اشتراک معتبری در فایل یافت نشد');

    const mode = document.querySelector('input[name=masterMode]:checked').value;
    if (mode === 'replace') {
      // حذف مرحله‌ای (در لیست‌های خیلی بزرگ، حذف یک‌جا ممکن است خطای timeout بدهد)
      const { data: mx } = await sb.from('subs').select('id').order('id', { ascending: false }).limit(1);
      let hi = mx && mx.length ? mx[0].id : 0;
      const DEL_STEP = 100000;
      while (hi > 0) {
        const { error } = await sb.from('subs').delete().gt('id', hi - DEL_STEP).lte('id', hi);
        if (error) throw new Error(error.message);
        hi -= DEL_STEP;
      }
    }

    // آپلود مرحله‌ای — اندازه بسته بر اساس حجم فایل (فایل‌های بزرگ: بسته‌های بزرگ‌تر)
    const CH = uniq.length > 500000 ? 5000 : (uniq.length > 50000 ? 3000 : (uniq.length > 5000 ? 1000 : 500));
    $('#masterProgress').classList.remove('hidden');
    const t0 = Date.now();
    // شمارش قبل از آپلود برای محاسبه دقیق «جدیدها»
    const { count: beforeCount } = await sb.from('subs').select('id', { count: 'exact', head: true });
    let done = 0, retried = 0;
    for (let i = 0; i < uniq.length; i += CH) {
      const chunk = uniq.slice(i, i + CH).map(r => ({ sub_no: r.no, data: r.data }));
      let err = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await sb.from('subs')
          .upsert(chunk, { onConflict: 'sub_no', ignoreDuplicates: true });
        err = error;
        if (!err) break;
        retried++;
        await new Promise(res => setTimeout(res, 1200 * (attempt + 1)));
      }
      if (err) throw new Error(err.message + ` (در ردیف ${faNum(i)})`);
      done = Math.min(uniq.length, i + CH);
      const pct = Math.round(done * 100 / uniq.length);
      const elapsed = (Date.now() - t0) / 1000;
      const eta = done > 0 ? Math.round(elapsed * (uniq.length - done) / done) : 0;
      $('#masterProgressFill').style.width = pct + '%';
      $('#masterProgressTxt').textContent = `${faNum(done)} از ${faNum(uniq.length)} ردیف (${faNum(pct)}٪) — حدود ${faNum(eta)} ثانیه مانده`;
    }
    if (mode === 'replace') await sb.rpc('recompute_statuses');
    $('#masterProgress').classList.add('hidden');
    $('#masterProgressFill').style.width = '0%';

    const { count } = await sb.from('subs').select('id', { count: 'exact', head: true });
    const added = Math.max(0, (count || 0) - (beforeCount || 0));
    const existed = Math.max(0, uniq.length - added);
    const secs = Math.round((Date.now() - t0) / 1000);
    $('#masterResult').innerHTML = `<div class="flex">
      <span class="badge green">${faNum(added)} اشتراک جدید اضافه شد</span>
      <span class="badge amber">${faNum(existed)} مورد از قبل موجود بود</span>
      <span class="badge blue">کل لیست: ${faNum(count)}</span>
      <span class="badge gray">⏱️ ${faNum(secs)} ثانیه</span>
    </div>
    <div class="muted mt" style="font-size:12.5px">ستون شناسایی‌شده: «${esc(subCol)}»${empty ? ` — ${faNum(empty)} ردیف خالی نادیده گرفته شد` : ''}${dupInFile ? ` — ${faNum(dupInFile)} شماره تکراری داخل فایل ادغام شد` : ''}${retried ? ` — ${faNum(retried)} بسته دوباره ارسال شد` : ''}</div>`;
    toast('لیست شرکت گاز با موفقیت آپلود شد', 'ok');
    refreshMasterLiveCount();
  } catch (e) {
    $('#masterProgress').classList.add('hidden');
    toast('خطا: ' + e.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'آپلود لیست شرکت گاز';
  }
});

/* ================= daily records upload ================= */
const INSPECTOR_RE = /(بازدید|ممیز|بازرس|ناظر|تنظیم کنند|تنظیم‌کنند|ثبت کننده|ثبت‌کننده|تهیه کننده|inspector)/i;
function extractInspector(data) {
  if (!data) return '';
  for (const [k, v] of Object.entries(data)) {
    if (INSPECTOR_RE.test(k) && String(v).trim()) return String(v).trim();
  }
  return '';
}

/* --- نرمال‌سازی نام‌ها (ی/ک عربی، فاصله و نیم‌فاصله) --- */
function normalizeName(v) {
  return String(v ?? '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[\s‌]+/g, '').trim();
}

/* --- تشخیص خودکار ستون مدیر پروژه از هدرهای فایل --- */
function detectManagerCol(headers, subCol) {
  const cands = (headers || []).filter(h => h !== subCol);
  const norm = h => normalizeName(h);
  let found = cands.find(h => { const n = norm(h); return n.includes('مدیر') && n.includes('پروژه'); });
  if (!found) found = cands.find(h => norm(h).includes('سرپرست'));
  if (!found) found = cands.find(h => { const n = norm(h); return (n.includes('مدیر') || n.includes('مسئول')) && !INSPECTOR_RE.test(n); });
  return found || null;
}

/* --- ساخت/یافتن مدیر و تبدیل نام‌ها به آیدی --- */
async function buildManagerResolver() {
  const cache = new Map(MANAGERS.map(m => [normalizeName(m.name), m.id]));
  const palette = ['#38bdf8', '#f59e0b', '#34d399', '#a78bfa', '#f87171', '#fbbf24', '#22d3ee'];
  return async rawName => {
    const n = normalizeName(rawName);
    if (cache.has(n)) return cache.get(n);
    const clean = String(rawName).trim();
    const { data, error } = await sb.from('managers')
      .insert({ name: clean, color: palette[cache.size % palette.length] })
      .select('id').single();
    if (error) {
      const { data: ex } = await sb.from('managers').select('id').eq('name', clean).maybeSingle();
      if (ex) { cache.set(n, ex.id); return ex.id; }
      throw new Error('ساخت مدیر «' + clean + '» ناموفق بود: ' + error.message);
    }
    cache.set(n, data.id);
    await refreshManagers();
    toast(`مدیر پروژه جدید «${clean}» ساخته شد`, 'ok');
    return data.id;
  };
}
async function rowsWithManagers(norm, mgrCol) {
  const resolve = await buildManagerResolver();
  const p_rows = [], extras = [];
  for (const r of norm) {
    const rawName = (r.data || {})[mgrCol];
    if (!normalizeName(rawName)) { extras.push({ no: r.no, data: r.data, kind: 'no_manager' }); continue; }
    p_rows.push({ no: r.no, data: r.data, mid: await resolve(rawName), vd: r.vd || '' });
  }
  return { p_rows, extras };
}

/* --- پیام راهنما وقتی schema.sql جدید اجرا نشده --- */
function hintSchema(e) {
  const m = String(e?.message || e);
  if (/does not exist|could not find|schema cache|not find the function|is not a function/i.test(m))
    return 'نسخه جدید schema.sql اجرا نشده — کل فایل schema.sql جدید را در Supabase ← SQL Editor اجرا کنید و بعد Ctrl+F5 بزنید';
  return m;
}

setJalaliDateInput('#recordDate', todayISO());
setJalaliDateInput('#prevDate', todayISO());
refreshJalaliHints();
bindFileName('#prevFile', '#prevFileName');

$('#recordUploadBtn').addEventListener('click', async () => {
  const f = $('#recordFile').files[0];
  if (!f) return toast('فایل خروجی روزانه را انتخاب کنید', 'err');
  const btn = $('#recordUploadBtn');
  btn.disabled = true; btn.textContent = 'در حال بررسی...';
  $('#recordResult').innerHTML = '';
  try {
    // قبل از پردازش، مطمئن شو لیست شرکت گاز (فایل ۱) آپلود شده
    const subsCount = await getSubsCount();
    const hint0 = uploadOrderHint(subsCount);
    if (hint0) throw new Error(hint0);

    const { rows, subCol, headers } = await readWorkbookRows(f);
    if (!subCol) throw new Error('فایل خالی است');
    const dateCol = detectVisitDateCol(headers, subCol);
    const norm = rows.map(r => ({ no: S.normalizeSubNo(r[subCol]), data: r, vd: dateCol ? parseFileVisitDate(r[dateCol]) : '' })).filter(r => r.no);
    if (!norm.length) throw new Error('هیچ شماره اشتراک معتبری در فایل یافت نشد');

    // تشخیص خودکار ستون مدیر پروژه از داخل فایل
    let mgrCol = detectManagerCol(headers, subCol);
    let p_rows, extraErrs, mgrNote = null;
    if (mgrCol) {
      ({ p_rows, extras: extraErrs } = await rowsWithManagers(norm, mgrCol));
    } else {
      // اگر ستون مدیر پروژه نبود → مثل فایل ثبت‌شده‌های قبلی از کاربر بپرس (یا حدس بزن از نام فایل)
      const pick = await askManagerForFile(f.name, '', '#recordResult');
      const resolve = await buildManagerResolver();
      const mid = await resolve(pick.name);
      p_rows = norm.map(r => ({ no: r.no, data: r.data, mid, vd: r.vd || '' }));
      extraErrs = [];
      mgrNote = `مدیر پروژه در ستون فایل نبود — همه «${pick.name}» ثبت شدند${pick.auto ? ' (برداشت خودکار)' : ''}`;
      $('#recordResult').innerHTML = '';
    }

    const visitDate = getJalaliDateInput('#recordDate', todayISO());
    const singleMid = p_rows.length && new Set(p_rows.map(x => x.mid)).size === 1 ? p_rows[0].mid : null;
    const { data: r, error } = await sb.rpc('process_upload', {
      p_filename: f.name,
      p_manager_id: singleMid,
      p_visit_date: visitDate,
      p_rows,
      p_uploaded_by: ME.email || null,
      p_nm_items: extraErrs.map(e => ({ no: e.no, data: e.data })),
    });
    if (error) throw new Error(error.message);

    const errs = [
      ...(r.ifdItems || []).map(d => ({ ...d, kind: 'in_file' })),
      ...(r.dupItems || []).map(d => ({ ...d, kind: 'duplicate' })),
      ...(r.nfItems || []).map(d => ({ ...d, kind: 'not_found' })),
      ...extraErrs,
    ];
    const pickedMgrName = p_rows.length ? (MANAGERS.find(m => m.id === p_rows[0].mid) || {}).name : null;
    const dateNote = dateCol
      ? ` — تاریخ از ستون «${esc(dateCol)}» خوانده شد (${faNum(norm.filter(x => x.vd).length)} ردیف معتبر)`
      : ' — ستون تاریخ پیدا نشد؛ تاریخ انتخاب‌شده در فرم استفاده شد';
    const mgrColNote = (mgrCol
      ? `ستون‌های شناسایی‌شده: اشتراک «${esc(subCol)}» — مدیر پروژه «${esc(mgrCol)}»`
      : `ستون «مدیر پروژه» در فایل نبود${pickedMgrName ? ` — مدیر: «${esc(pickedMgrName)}» (انتخاب دستی)` : ''}`) + dateNote;
    const kindBadge = k => k === 'in_file'
      ? '<span class="badge amber">تکراری داخل فایل 🔄</span>'
      : k === 'duplicate'
        ? '<span class="badge amber">تکراری با ثبت قبلی 🔁</span>'
        : k === 'not_found'
          ? '<span class="badge red">ناموجود در لیست ❌</span>'
          : '<span class="badge gray">مدیر نامشخص ⚠️</span>';

    $('#recordResult').innerHTML = `
      <div class="flex mb">
        <span class="badge blue">${faNum(r.total + extraErrs.length)} شماره بررسی شد</span>
        <span class="badge green">${faNum(r.new)} ثبت جدید ✅</span>
        ${r.ifd ? `<span class="badge amber">${faNum(r.ifd)} تکراری داخل خود فایل 🔄</span>` : ''}
        ${r.dup ? `<span class="badge amber">${faNum(r.dup)} تکراری با ثبت‌ قبلی 🔁</span>` : ''}
        ${r.nf ? `<span class="badge red">${faNum(r.nf)} ناموجود در لیست گاز ❌</span>` : ''}
        ${extraErrs.length ? `<span class="badge gray">${faNum(extraErrs.length)} بدون مدیر ⚠️</span>` : ''}
      </div>
      <div class="muted mb" style="font-size:12.5px">${mgrColNote}${INSPECTOR_RE.test(headers.find(h => INSPECTOR_RE.test(h)) || '') ? ' — ممیز «' + esc(headers.find(h => INSPECTOR_RE.test(h))) + '»' : ''}</div>
      ${errs.length ? `
      <div class="note-box mb" style="border-color:rgba(248,113,113,.4)">⚠️ موارد زیر <b style="color:var(--red)">ثبت نشدند</b> و فقط به‌صورت خطا گزارش می‌شوند:</div>
      <div class="table-wrap mb" style="max-height:280px;overflow-y:auto"><table>
        <thead><tr><th>شماره اشتراک</th><th>نوع خطا</th><th>مدیر پروژه (ثبت اول)</th><th>ممیز (ثبت اول)</th><th>تاریخ ثبت اول</th></tr></thead>
        <tbody>${errs.slice(0, 100).map(e2 => `<tr>
          <td class="ltr">${esc(e2.no)}</td>
          <td>${kindBadge(e2.kind)}</td>
          <td>${e2.kind === 'duplicate' ? esc(e2.prev_manager || '—') : '—'}</td>
          <td>${e2.kind === 'duplicate' ? '<b>' + esc(e2.prev_inspector || '—') + '</b>' : '—'}</td>
          <td>${e2.kind === 'duplicate' ? faDate(e2.prev_date) : '—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${errs.length > 100 ? `<div class="muted mb" style="font-size:12px">+ ${faNum(errs.length - 100)} خطای دیگر — فهرست کامل در فایل گزارش است</div>` : ''}` : ''}
      <div class="flex">
        <select class="input" id="dailyReportFilter" style="padding:6px 10px;font-size:12.5px;width:auto">
          <option value="all">همه موارد</option>
          <option value="ok">فقط ثبت‌شده‌ها ✅</option>
          <option value="ifd">فقط تکراری‌های داخل خود فایل 🔄</option>
          <option value="dup">فقط تکراری با ثبت قبلی 🔁</option>
          <option value="nf">فقط ناموجودها ❌</option>
          <option value="no_manager">فقط بدون مدیر ⚠️</option>
        </select>
        <button class="btn ghost sm" id="dlReportBtn">⬇ دانلود گزارش این فایل (اکسل)</button>
        <span class="muted" style="font-size:12.5px">گزارش همیشه از «تاریخچه فایل‌های آپلودشده» هم قابل دانلود است</span>
      </div>`;
    $('#dlReportBtn').onclick = () => {
      const kind = $('#dailyReportFilter').value;
      const r2 = { new: r.new, dupItems: r.dupItems, nfItems: r.nfItems };
      window.__lastReportCounts = {
        ok: r.new || 0,
        dup: (r.dupItems || []).length,
        ifd: (r.ifdItems || []).length,
        nf: (r.nfItems || []).length,
        no_manager: extraErrs.length,
      };
      guardedDownloadReport(
        filterReportRows(buildDailyReportRows(norm, r, mgrCol, visitDate, extraErrs, pickedMgrName || ''), kind),
        kind,
        `گزارش-${f.name.replace(/\.[^.]+$/, '')}${REPORT_KIND_SUFFIX[kind] || ''}.xlsx`);
    };
    toast(errs.length ? 'پردازش شد — خطاها را بررسی کنید' : 'همه شماره‌ها با موفقیت ثبت شدند ✅', errs.length ? '' : 'ok');
    loadUploadsTable();
  } catch (e) {
    toast(hintSchema(e), 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'آپلود و بررسی خودکار';
  }
});

/* ================= import previous registrations («فایل دوم») ================= */
function guessManagerFromName(text) {
  const t = normalizeName(text);
  if (!t) return null;
  // ۱) تطبیق کامل نام
  let hits = MANAGERS.filter(m => {
    const n = normalizeName(m.name);
    return n.length >= 3 && (t.includes(n) || n.includes(t));
  });
  if (hits.length === 1) return hits[0];
  // ۲) تطبیق بر اساس کلمات نام (مثل «دلخوش» داخل «شماره اشتراک-دلخوش»)
  hits = MANAGERS.filter(m =>
    String(m.name).trim().split(/[\s‌]+/).some(w => normalizeName(w).length >= 3 && t.includes(normalizeName(w)))
  );
  return hits.length === 1 ? hits[0] : null;
}

/* وقتی فایل ثبت‌شده‌های قبلی ستون مدیر ندارد: حدس از نام شیت/فایل، وگرنه انتخاب دستی
 * boxSel: سلکتور باکسی که فرم انتخاب در آن رندر می‌شود */
function askManagerForFile(fName, sheetName, boxSel = '#prevResult') {
  const guess = guessManagerFromName(sheetName) || guessManagerFromName(fName);
  if (guess) return Promise.resolve({ name: guess.name, auto: true });
  return new Promise((resolve, reject) => {
    const box = $(boxSel);
    box.innerHTML = `<div class="note-box mb">⚠️ ستون «مدیر پروژه» در این فایل${sheetName ? ` (شیت «${esc(sheetName)}»)` : ''} پیدا نشد. مدیر پروژه مالک این فهرست را انتخاب کنید یا نامش را بنویسید:</div>
      <div class="flex">
        <select class="input" id="prevMgrSel" style="max-width:250px">
          <option value="">— انتخاب از فهرست —</option>
          ${MANAGERS.map(m => `<option>${esc(m.name)}</option>`).join('')}
        </select>
        <input class="input" id="prevMgrNew" placeholder="یا نام جدید بنویسید" style="max-width:220px">
        <button class="btn sm" id="prevMgrOk">تأیید</button>
        <button class="btn ghost sm" id="prevMgrCancel">انصراف</button>
      </div>`;
    $('#prevMgrOk').onclick = () => {
      const newName = $('#prevMgrNew').value.trim();
      if (newName) return resolve({ name: newName, auto: false });
      const sel = $('#prevMgrSel');
      if (sel.value) return resolve({ name: sel.value, auto: false });
      toast('یک مدیر را انتخاب کنید یا نام جدید بنویسید', 'err');
    };
    $('#prevMgrCancel').onclick = () => reject(new Error('__cancelled__'));
  });
}

$('#importPrevBtn').addEventListener('click', async () => {
  const f = $('#prevFile').files[0];
  if (!f) return toast('فایل ثبت‌شده‌های قبلی را انتخاب کنید', 'err');
  const btn = $('#importPrevBtn');
  btn.disabled = true; btn.textContent = 'در حال واردکردن...';
  $('#prevResult').innerHTML = '';
  try {
    // قبل از واردکردن، لیست شرکت گاز باید آپلود شده باشد (چکِ ناموجود)
    const hint0 = uploadOrderHint(await getSubsCount());
    if (hint0) throw new Error(hint0);

    // هر شیت جداگانه خوانده می‌شود؛ نام شیت می‌تواند نام مدیر پروژه باشد
    const buf = await f.arrayBuffer();
    const sheets = S.parseWorkbookSheets(buf, XLSX);
    if (!sheets.length) throw new Error('فایل خالی است یا شیتی با داده ندارد');

    let p_rows = [], extras = [];
    const sheetNotes = [];
    for (const sh of sheets) {
      if (!sh.subCol) continue;
      const norm = sh.rows.map(r => ({ no: S.normalizeSubNo(r[sh.subCol]), data: r })).filter(r => r.no);
      if (!norm.length) continue;

      // اولویت ۱: ستون مدیر پروژه داخل خود شیت
      const mgrCol = detectManagerCol(sh.headers, sh.subCol);
      if (mgrCol) {
        const res = await rowsWithManagers(norm, mgrCol);
        p_rows.push(...res.p_rows);
        extras.push(...res.extras);
        sheetNotes.push(`شیت «${esc(sh.sheetName)}»: ${faNum(res.p_rows.length)} اشتراک — مدیر از ستون «${esc(mgrCol)}»`);
        continue;
      }
      // اولویت ۲: نام شیت (مثل «شماره اشتراک-دلخوش» یا «دشتی»)؛ وگرنه از کاربر می‌پرسیم
      const pick = await askManagerForFile(f.name, sh.sheetName);
      const resolve = await buildManagerResolver();
      const mid = await resolve(pick.name);
      norm.forEach(r => p_rows.push({ no: r.no, data: r.data, mid }));
      sheetNotes.push(`شیت «${esc(sh.sheetName)}»: ${faNum(norm.length)} اشتراک — مدیر: ${esc(pick.name)}${pick.auto ? ' (برداشت خودکار از نام شیت)' : ''}`);
    }
    if (!p_rows.length) throw new Error('هیچ شماره اشتراک معتبری برای واردکردن یافت نشد');
    const mgrNote = sheetNotes.join('<br>');
    $('#prevResult').innerHTML = '';

    // تکه‌تکه ارسال می‌کنیم تا حجم درخواست‌ها بالا نرود (بسته بزرگ برای تشخیص تکراری داخل خود فایل)
    const CH = 5000;
    let total = 0, added = 0, dup = 0, nf = 0, ifd = 0;
    for (let i = 0; i < p_rows.length; i += CH) {
      const { data: r, error } = await sb.rpc('import_registered', {
        p_filename: f.name + (p_rows.length > CH ? ` (بخش ${Math.floor(i / CH) + 1})` : ''),
        p_manager_id: null,
        p_visit_date: getJalaliDateInput('#prevDate', todayISO()),
        p_rows: p_rows.slice(i, i + CH),
        p_uploaded_by: ME.email || null,
      });
      if (error) throw new Error(error.message);
      total += r.total; added += r.added; dup += r.dup; nf += r.nf; ifd += (r.ifd || 0);
    }

    $('#prevResult').innerHTML = `<div class="flex" style="flex-wrap:wrap;gap:6px">
      <span class="badge blue">${faNum(total + extras.length)} شماره بررسی شد</span>
      <span class="badge green">${faNum(added)} به ثبت‌شده‌ها اضافه شد ✅</span>
      ${ifd ? `<span class="badge amber">${faNum(ifd)} تکراری داخل خود فایل 🔄</span>` : ''}
      ${dup ? `<span class="badge amber">${faNum(dup)} از قبل موجود بود 🔁</span>` : ''}
      ${nf ? `<span class="badge red">${faNum(nf)} در لیست شرکت گاز نبود و «ناموجود» ثبت شد ❌</span>` : ''}
      ${extras.length ? `<span class="badge gray">${faNum(extras.length)} بدون مدیر رد شد ⚠️</span>` : ''}
    </div>
    <div class="muted mt" style="font-size:12.5px">${mgrNote} — از این پس چک تکراری فایل‌های روزانه بر اساس همین ثبت‌شده‌ها انجام می‌شود.</div>`;
    toast('ثبت‌های قبلی وارد سیستم شد ✅', 'ok');
    loadUploadsTable();
  } catch (e) {
    if (e.message !== '__cancelled__') toast(hintSchema(e), 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'واردکردن ثبت‌های قبلی';
  }
});

/* ================= گزارش اکسل بررسی روزانه ================= */
function buildDailyReportRows(norm, result, mgrCol, visitDate, extraErrs = [], manualMgrName = '') {
  const dupMap = {};
  (result.dupItems || []).forEach(d => dupMap[d.no] = d);
  const nfSet = new Set((result.nfItems || []).map(x => x.no));
  const ifdSet = new Set((result.ifdItems || []).map(x => x.no));
  const noMgrSet = new Set(extraErrs.map(x => x.no));
  const dataKeys = [];
  norm.forEach(r => Object.keys(r.data || {}).forEach(k => {
    if (!dataKeys.includes(k) && dataKeys.length < 20) dataKeys.push(k);
  }));
  const occ = {};
  return norm.map(r => {
    occ[r.no] = (occ[r.no] || 0) + 1;
    // بار دوم به بعدِ یک شماره داخل همین فایل → «تکراری داخل خود فایل» (همان مرحله ۱ سرور)
    const isRepeat = occ[r.no] > 1 && ifdSet.has(r.no);
    const noMgr = noMgrSet.has(r.no);
    const isNf = nfSet.has(r.no);
    const dup = (!isRepeat && !noMgr && !isNf) ? (dupMap[r.no] || null) : null;
    const isOk = !isRepeat && !noMgr && !isNf && !dup;
    const o = {
      'شماره اشتراک': r.no,
      'نتیجه بررسی': isRepeat ? 'تکراری داخل خود فایل 🔄'
        : noMgr ? 'بدون مدیر پروژه — ثبت نشد ⚠️'
        : isNf ? 'ناموجود در لیست شرکت گاز ❌'
        : dup ? 'تکراری — قبلاً ثبت شده 🔁' : 'ثبت شد ✅',
      'مدیر پروژه (ثبت اول)': dup ? (dup.prev_manager || '') : (isOk ? String((r.data || {})[mgrCol] ?? manualMgrName).trim() : ''),
      'ممیز (ثبت اول)': dup ? (dup.prev_inspector || '') : (isOk ? extractInspector(r.data) : ''),
      'تاریخ ثبت اول': dup ? faDateNum(dup.prev_date) : (isOk ? faDateNum(r.vd || visitDate) : ''),
    };
    for (const k of dataKeys) o['اطلاعات فایل | ' + k] = (r.data || {})[k] ?? '';
    return o;
  });
}

function buildHistoryReportRows(recs, details, mgrName) {
  const nosInRecs = new Set(recs.map(x => x.sub_no));
  const rows = recs.map(x => ({
    'شماره اشتراک': x.sub_no,
    'نتیجه بررسی': x.status === 'not_found' ? 'ناموجود در لیست شرکت گاز ❌' : 'ثبت شد ✅',
    'مدیر پروژه (ثبت اول)': x.manager_name || mgrName || '',
    'ممیز (ثبت اول)': extractInspector(x.data),
    'تاریخ ثبت اول': faDateNum(x.visit_date),
  }));
  (details.dupItems || []).forEach(it => rows.push({
    'شماره اشتراک': it.no,
    'نتیجه بررسی': 'تکراری — قبلاً ثبت شده 🔁',
    'مدیر پروژه (ثبت اول)': it.prev_manager || '',
    'ممیز (ثبت اول)': it.prev_inspector || '',
    'تاریخ ثبت اول': faDateNum(it.prev_date),
  }));
  // ناموجودها: برای آپلودهای جدید از records می‌آیند؛ برای قدیمی‌ها از details
  (details.nfItems || []).filter(it => !nosInRecs.has(it.no)).forEach(it => rows.push({
    'شماره اشتراک': it.no,
    'نتیجه بررسی': 'ناموجود در لیست شرکت گاز ❌',
    'مدیر پروژه (ثبت اول)': '', 'ممیز (ثبت اول)': '', 'تاریخ ثبت اول': '',
  }));
  (details.ifdItems || []).forEach(it => rows.push({
    'شماره اشتراک': it.no,
    'نتیجه بررسی': 'تکراری داخل خود فایل 🔄',
    'مدیر پروژه (ثبت اول)': '', 'ممیز (ثبت اول)': '', 'تاریخ ثبت اول': '',
  }));
  (details.nmItems || []).forEach(it => rows.push({
    'شماره اشتراک': it.no,
    'نتیجه بررسی': 'بدون مدیر پروژه — ثبت نشد ⚠️',
    'مدیر پروژه (ثبت اول)': '', 'ممیز (ثبت اول)': '', 'تاریخ ثبت اول': '',
  }));
  return rows;
}

/* ================= uploads history ================= */
async function loadUploadsTable() {
  const { data: rows, error } = await sb.from('uploads')
    .select('id,filename,visit_date,total,new_count,dup_count,notfound_count,uploaded_by,details,managers(name)')
    .order('id', { ascending: false }).limit(100);
  if (error) return toast(hintSchema(error), 'err');
  $('#uploadsTable tbody').innerHTML = rows.length ? rows.map(u => {
    // آپلود قدیمی (قبل از آپدیت ۸): شمارنده دارد ولی جزئیات (شماره‌های خطادار) ذخیره نشده
    const d = u.details || {};
    const oldMissingDetails = (u.dup_count > 0 || u.notfound_count > 0) &&
      !(d.dupItems || []).length && !(d.nfItems || []).length && !(d.nmItems || []).length;
    return `<tr>
    <td>${faNum(u.id)}</td>
    <td class="ltr" style="max-width:180px;overflow:hidden;text-overflow:ellipsis">${esc(u.filename || '—')}</td>
    <td>${u.managers?.name ? esc(u.managers.name) : '<span class="badge gray">متنوع</span>'}</td>
    <td>${faDate(u.visit_date)}</td>
    <td>${faNum(u.total)}</td>
    <td style="color:var(--green)">${faNum(u.new_count)}</td>
    <td style="color:var(--amber)">${faNum(u.dup_count)}</td>
    <td style="color:var(--red)">${faNum(u.notfound_count)}</td>
    <td class="ltr">${esc((u.uploaded_by || '—').split('@')[0])}</td>
    <td class="flex">
      <button class="btn ghost sm" onclick="downloadUploadReport(${u.id})" ${oldMissingDetails ? 'title="این آپلود قدیمی است و شماره‌های خطادارش ذخیره نشده — فقط گزارش ثبت‌شده‌ها کامل است"' : ''}>گزارش${oldMissingDetails ? ' ⚠️' : ''}</button>
      <button class="btn danger sm" onclick="deleteUpload(${u.id})">حذف</button>
    </td>
  </tr>`;
  }).join('') : '<tr><td colspan="10"><div class="empty-state"><div class="big">📂</div>هنوز فایلی آپلود نشده است</div></td></tr>';
}

window.deleteUpload = async id => {
  if (!confirm('تمام رکوردهای این فایل حذف شود؟ وضعیت‌ها دوباره محاسبه می‌شوند.')) return;
  const { error } = await sb.rpc('delete_upload', { p_id: id });
  if (error) return toast('خطا: ' + error.message, 'err');
  toast('فایل و رکوردهایش حذف شد', 'ok');
  loadUploadsTable();
};

/* ================= xlsx export helpers ================= */
function downloadXlsx(rows, filename, sheetName) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'اطلاع': 'داده‌ای وجود ندارد' }]);
  // فعال‌کردن فیلتر خودکار اکسل روی سرستون‌ها تا گزارش قابل فیلترکردن باشد
  if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] };
  XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'data').slice(0, 31));
  XLSX.writeFile(wb, filename);
}

/* فیلتر ردیف‌های گزارش بر اساس نوع نتیجه (ستون «نتیجه بررسی») */
const REPORT_KINDS = { ok: 'ثبت شد', dup: 'تکراری — قبلاً', ifd: 'تکراری داخل خود فایل', nf: 'ناموجود', no_manager: 'بدون مدیر' };
function filterReportRows(rows, kind) {
  if (!kind || kind === 'all') return rows;
  const prefix = REPORT_KINDS[kind];
  return rows.filter(r => String(r['نتیجه بررسی'] || '').startsWith(prefix));
}
const REPORT_KIND_SUFFIX = { all: '', ok: '-ثبت‌شده‌ها', dup: '-تکراری‌ها', ifd: '-تکراری‌های-داخل-فایل', nf: '-ناموجودها', no_manager: '-بدون‌مدیر' };

async function fetchAllRecordsView(queryFn) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from('records_view').select('*').order('id').range(from, from + 999);
    q = queryFn(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
    if (out.length >= 100000) break;
  }
  return out;
}

async function fetchMasterInfo(subNos) {
  const uniq = [...new Set(subNos)];
  const map = {};
  for (let i = 0; i < uniq.length; i += 150) {
    const { data, error } = await sb.from('subs').select('sub_no,data').in('sub_no', uniq.slice(i, i + 150));
    if (error) throw new Error(error.message);
    (data || []).forEach(s => map[s.sub_no] = s.data);
  }
  return map;
}

function recordsToExcelRows(recs, masterMap) {
  const masterKeys = [];
  recs.forEach(r => {
    const md = masterMap[r.sub_no];
    if (md) Object.keys(md).forEach(k => { if (!masterKeys.includes(k) && masterKeys.length < 20) masterKeys.push(k); });
  });
  return recs.map(r => {
    const md = masterMap[r.sub_no] || {};
    const o = {
      'شماره اشتراک': r.sub_no,
      'وضعیت': STATUS_FA[r.status] || r.status,
      'تاریخ بازدید': faDateNum(r.visit_date),
      'مدیر پروژه': r.manager_name || '',
      'فایل': r.filename || '',
      'موجود در لیست شرکت گاز': r.in_master ? 'بله' : 'خیر',
      'تاریخ اولین ثبت': faDateNum(r.prev_date),
      'مدیر اولین ثبت': r.prev_manager || '',
    };
    for (const k of masterKeys) o['اطلاعات | ' + k] = md[k] ?? '';
    return o;
  });
}

/* شمارش انواع موجود در جزئیات یک آپلود — برای پیام‌های شفاف */
function reportKindCounts(recs, details) {
  return {
    ok: recs.filter(x => x.status === 'new').length,
    dup: (details.dupItems || []).length,
    ifd: (details.ifdItems || []).length,
    nf: (details.nfItems || []).length + recs.filter(x => x.status === 'not_found').length,
    no_manager: (details.nmItems || []).length,
  };
}
/* دانلود گزارش فقط وقتی ردیفی دارد؛ وگرنه پیام شفاف به‌جای فایل خالی */
function guardedDownloadReport(rows, kind, filename) {
  if (!rows.length) {
    const c = window.__lastReportCounts || {};
    toast(`❗ در این فایل هیچ «${REPORT_KINDS[kind] || 'موردی'}» ثبت نشده است. موجود در این فایل — ثبت‌شده: ${faNum(c.ok || 0)} | تکراری داخل فایل: ${faNum(c.ifd || 0)} | تکراری قبلی: ${faNum(c.dup || 0)} | ناموجود: ${faNum(c.nf || 0)} | بدون مدیر: ${faNum(c.no_manager || 0)}. برای دیدن همه، فیلتر را روی «همه موارد» بگذارید.`, 'err');
    return false;
  }
  downloadXlsx(rows, filename, 'گزارش بررسی');
  toast(`گزارش دانلود شد — ${faNum(rows.length)} ردیف ✅`, 'ok');
  return true;
}

window.downloadUploadReport = async uploadId => {
  try {
    toast('در حال آماده‌سازی گزارش...', 'ok');
    const { data: u, error } = await sb.from('uploads')
      .select('id,filename,visit_date,details,managers(name)').eq('id', uploadId).single();
    if (error) throw new Error(error.message);
    const recs = await fetchAllRecordsView(q => q.eq('upload_id', uploadId));
    const kind = $('#historyReportFilter') ? $('#historyReportFilter').value : 'all';
    const details = u.details || {};
    window.__lastReportCounts = reportKindCounts(recs, details);
    const rows = filterReportRows(buildHistoryReportRows(recs, details, u.managers?.name || ''), kind);
    guardedDownloadReport(rows, kind,
      `گزارش-${(u.filename || 'upload-' + uploadId).replace(/\.[^.]+$/, '')}${REPORT_KIND_SUFFIX[kind] || ''}.xlsx`);
  } catch (e) { toast('خطا: ' + e.message, 'err'); }
};

/* حذف کلی تاریخچه — ثبت‌شده‌ها حفظ می‌شوند */
$('#clearHistoryBtn').addEventListener('click', async () => {
  if (!confirm('تمام تاریخچه فایل‌های آپلودشده پاک شود؟\nاشتراک‌های «ثبت‌شده» در دیتابیس حفظ می‌شوند و خراب نمی‌شوند — فقط لیست تاریخچه خالی می‌شود.')) return;
  if (!confirm('مطمئن هستید؟ تاریخچه آپلودها به‌طور کامل پاک می‌شود.')) return;
  const { data, error } = await sb.rpc('delete_all_uploads');
  if (error) return toast(hintSchema(error), 'err');
  toast(`تاریخچه پاک شد (${faNum(data.uploads)} فایل) — ${faNum(data.kept_records)} اشتراک ثبت‌شده حفظ شد`, 'ok');
  loadUploadsTable();
});

/* ================= پشتیبان‌گیری کامل (شماره‌ها + ثبت‌شده‌ها) ================= */
/* ساخت CSV لیست شرکت گاز — با BOM تا اکسل فارسی را درست باز کند */
function buildSubsBackupCsv(numbers) {
  const parts = ['\ufeffشماره اشتراک\r\n'];
  for (let i = 0; i < numbers.length; i += 5000) parts.push(numbers.slice(i, i + 5000).join('\r\n') + '\r\n');
  return parts.join('');
}
function downloadText(txt, filename, mime) {
  const blob = new Blob([txt], { type: mime || 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
/* دریافت همه شماره‌ها — ساپابیس هر درخواست حداکثر ۱۰۰۰ ردیف می‌دهد؛ ۶ درخواست هم‌زمان برای سرعت */
async function fetchAllSubsNos(onProgress) {
  const { count, error: cErr } = await sb.from('subs').select('id', { count: 'exact', head: true });
  if (cErr) throw new Error(cErr.message);
  const total = count || 0;
  if (!total) return [];
  const PAGE = 1000, CONC = 6;
  const froms = [];
  for (let f = 0; f < total; f += PAGE) froms.push(f);
  const out = new Array(total);
  let done = 0, idx = 0;
  async function worker() {
    while (idx < froms.length) {
      const from = froms[idx++];
      const { data, error } = await sb.from('subs').select('sub_no').order('id').range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      for (let i = 0; i < data.length; i++) out[from + i] = data[i].sub_no;
      done += data.length;
      if (onProgress) onProgress(done, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, froms.length) }, worker));
  return out.filter(Boolean);
}
/* ردیف‌های پشتیبان ثبت‌شده‌ها — قابل بازگردانی با کارت «فایل ۲» (ستون مدیر پروژه + ممیز) */
function recordsBackupRows(recs) {
  return recs.map(r => ({
    'شماره اشتراک': r.sub_no,
    'مدیر پروژه': r.manager_name || '',
    'ممیز': extractInspector(r.data) || '',
    'تاریخ بازدید (شمسی)': faDateNum(r.visit_date),
    'تاریخ بازدید (میلادی)': r.visit_date || '',
    'وضعیت': STATUS_FA[r.status] || r.status || '',
    'فایل ثبت': r.filename || '',
  }));
}
$('#backupAllBtn').addEventListener('click', async () => {
  const btn = $('#backupAllBtn');
  if (!confirm('پشتیبان کامل شامل: ۱) همه اشتراک‌های ثبت‌شده (اکسل) + ۲) کل لیست شرکت گاز (CSV).\nهر دو فایل دانلود می‌شوند — اگر مرورگر اجازه «دانلود چند فایل» پرسید، اجازه دهید. ادامه؟')) return;
  btn.disabled = true; btn.textContent = '⏳ در حال آماده‌سازی...';
  $('#backupResult').innerHTML = '';
  $('#backupProgress').classList.remove('hidden');
  try {
    // ۱) ثبت‌شده‌ها (حجم کم، سریع)
    const recs = await fetchAllRecordsView(q => q);
    if (recs.length >= 100000) toast('تعداد ثبت‌شده‌ها خیلی زیاد است — ۱۰۰,۰۰۰ ردیف اول در پشتیبان است', '');
    downloadXlsx(recordsBackupRows(recs), `پشتیبان-ثبت‌شده‌ها-${faDateNum(todayISO())}.xlsx`, 'ثبت‌شده‌ها');

    // ۲) لیست شرکت گاز (حجم بالا — با نوار پیشرفت)
    const t0 = Date.now();
    const nos = await fetchAllSubsNos((done, total) => {
      const pct = Math.round(done * 100 / total);
      const elapsed = (Date.now() - t0) / 1000;
      const eta = done > 0 ? Math.round(elapsed * (total - done) / done) : 0;
      $('#backupProgressFill').style.width = pct + '%';
      $('#backupProgressTxt').textContent = `${faNum(done)} از ${faNum(total)} شماره (${faNum(pct)}٪) — حدود ${faNum(eta)} ثانیه مانده`;
    });
    $('#backupProgress').classList.add('hidden');
    $('#backupProgressFill').style.width = '0%';
    downloadText(buildSubsBackupCsv(nos), `پشتیبان-لیست-شرکت-گاز-${faDateNum(todayISO())}.csv`);

    $('#backupResult').innerHTML = `<div class="flex" style="flex-wrap:wrap;gap:6px">
      <span class="badge green">✅ پشتیبان ثبت‌شده‌ها: ${faNum(recs.length)} ردیف (اکسل)</span>
      <span class="badge blue">✅ پشتیبان لیست شرکت گاز: ${faNum(nos.length)} شماره (CSV)</span>
    </div>
    <div class="muted mt" style="font-size:12.5px;line-height:2">💾 هر دو فایل را در پوشه‌ای امن (کامپیوتر یا فلش) نگه دارید. بازگردانی: فایل CSV لیست با <b>کارت ۱</b> و فایل ثبت‌شده‌ها با <b>کارت ۲</b> آپلود می‌شود. نسخه آفلاین سایت هم این فایل‌ها را می‌پذیرد.</div>`;
    toast('پشتیبان‌گیری کامل شد ✅', 'ok');
  } catch (e) {
    $('#backupProgress').classList.add('hidden');
    $('#backupResult').innerHTML = '';
    toast('خطا: ' + e.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = '⬇ دانلود پشتیبان کامل (شماره‌ها + ثبت‌شده‌ها)';
  }
});

/* ================= subs list ================= */
let subsPage = 1, subsQ = '';
$('#subsSearchBtn').addEventListener('click', () => { subsQ = $('#subsSearch').value; subsPage = 1; loadSubs(); });
$('#subsSearch').addEventListener('keydown', e => { if (e.key === 'Enter') $('#subsSearchBtn').click(); });

async function loadSubs() {
  let q = sb.from('subs_view').select('*', { count: 'exact' }).order('id', { ascending: false });
  const nq = S.normalizeSubNo(subsQ);
  if (nq) q = q.ilike('sub_no', '%' + nq + '%');
  const from = (subsPage - 1) * 50;
  const { data, error, count } = await q.range(from, from + 49);
  if (error) return toast('خطا: ' + error.message, 'err');

  const keys = [];
  data.forEach(r => Object.keys(r.data || {}).forEach(k => {
    if (!k.replace(/[\s‌]/g, '').includes('اشتراک') && !keys.includes(k) && keys.length < 4 && String(r.data[k]).trim() !== '') keys.push(k);
  }));
  $('#subsTable thead').innerHTML = `<tr><th>شماره اشتراک</th>${keys.map(k => `<th>${esc(k)}</th>`).join('')}<th>وضعیت</th><th>عملیات</th></tr>`;
  $('#subsTable tbody').innerHTML = data.length ? data.map(r => `<tr>
    <td class="ltr"><b>${esc(r.sub_no)}</b></td>
    ${keys.map(k => `<td>${esc((r.data || {})[k] ?? '')}</td>`).join('')}
    <td>${r.times > 0 ? `<span class="badge amber">ثبت شده (${faNum(r.times)} بار)</span>` : '<span class="badge gray">ثبت نشده</span>'}</td>
    <td><button class="btn danger sm" onclick="delSub(${r.id}, '${esc(r.sub_no)}', ${r.times})" title="حذف از لیست">🗑</button></td>
  </tr>`).join('') : `<tr><td colspan="${keys.length + 3}"><div class="empty-state"><div class="big">🗄️</div>${subsQ ? 'موردی یافت نشد' : 'لیست شرکت گاز هنوز آپلود نشده — از بخش «آپلود فایل» اقدام کنید'}</div></td></tr>`;
  renderPager($('#subsPager'), subsPage, Math.max(1, Math.ceil(count / 50)), count, pg => { subsPage = pg; loadSubs(); });
}

function renderPager(box, page, pages, total, go) {
  box.innerHTML = `
    <button class="btn ghost sm" ${page <= 1 ? 'disabled' : ''}>قبلی</button>
    <span class="info">صفحه ${faNum(page)} از ${faNum(pages)} — ${faNum(total)} مورد</span>
    <button class="btn ghost sm" ${page >= pages ? 'disabled' : ''}>بعدی</button>`;
  const [prev, next] = box.querySelectorAll('button');
  if (page > 1) prev.onclick = () => go(page - 1);
  if (page < pages) next.onclick = () => go(page + 1);
}

window.delSub = async (id, no, times) => {
  const msg = times > 0
    ? `این شماره از «لیست شرکت گاز» حذف شود؟\nشماره: ${no}\n⚠️ این شماره ${times} بار ثبت شده — رکوردهای ثبت‌شده حفظ می‌شوند اما از این پس «خارج از لیست» دیده می‌شوند.`
    : `این شماره از «لیست شرکت گاز» حذف شود؟\nشماره: ${no}`;
  if (!confirm(msg)) return;
  const { error } = await sb.from('subs').delete().eq('id', id);
  if (error) return toast('خطا: ' + error.message, 'err');
  toast('از لیست شرکت گاز حذف شد', 'ok');
  loadSubs(); refreshMasterLiveCount();
};
$('#subsAddBtn').addEventListener('click', () => {
  openModal('➕ افزودن شماره به لیست شرکت گاز', `
    <div class="field"><label>شماره اشتراک</label>
      <input class="input ltr" id="mSubNo" style="direction:ltr;text-align:left" placeholder="مثلاً 10092643491"></div>
    <div class="muted" style="font-size:12.5px;line-height:2">برای افزودن تعداد زیاد، از «آپلود فایل ← کارت ۱ ← افزودن به فعلی» استفاده کنید.</div>`,
  async () => {
    const no = S.normalizeSubNo($('#mSubNo').value);
    if (!no) { toast('شماره معتبر وارد کنید', 'err'); return false; }
    const { error } = await sb.from('subs').insert({ sub_no: no, data: {} });
    if (error) throw new Error(String(error.message).includes('duplicate') ? 'این شماره قبلاً در لیست هست' : error.message);
    toast('شماره به لیست اضافه شد ✅', 'ok');
    loadSubs(); refreshMasterLiveCount();
  });
});

/* ================= records list ================= */
let recPage = 1;
$('#recFilterBtn').addEventListener('click', () => { recPage = 1; loadRecords(); });
$('#recSearch').addEventListener('keydown', e => { if (e.key === 'Enter') $('#recFilterBtn').click(); });

function applyRecFilters(q) {
  const s = S.normalizeSubNo($('#recSearch').value);
  if (s) q = q.ilike('sub_no', '%' + s + '%');
  if ($('#recManager').value) q = q.eq('manager_id', Number($('#recManager').value));
  if ($('#recStatus').value) q = q.eq('status', $('#recStatus').value);
  if ($('#recInMaster') && $('#recInMaster').value) q = q.eq('in_master', $('#recInMaster').value === 'yes');
  const recFrom = getJalaliDateInput('#recFrom', null);
  const recTo = getJalaliDateInput('#recTo', null);
  if (recFrom) q = q.gte('visit_date', recFrom);
  if (recTo) q = q.lte('visit_date', recTo);
  return q;
}

async function loadRecords() {
  let q = sb.from('records_view').select('*', { count: 'exact' }).order('id', { ascending: false });
  try { q = applyRecFilters(q); }
  catch (e) { toast(e.message, 'err'); return; }
  const from = (recPage - 1) * 50;
  const { data, error, count } = await q.range(from, from + 49);
  if (error) return toast('خطا: ' + error.message, 'err');
  window.__recRows = data;
  $('#recordsTable tbody').innerHTML = data.length ? data.map(r => `<tr>
    <td class="ltr"><b>${esc(r.sub_no)}</b></td>
    <td>${statusBadge(r.status)}</td>
    <td><b>${esc(extractInspector(r.data) || '—')}</b></td>
    <td>${faDate(r.visit_date)}</td>
    <td>${esc(r.manager_name || '—')}</td>
    <td class="ltr" style="max-width:160px;overflow:hidden;text-overflow:ellipsis">${esc(r.filename || '—')}</td>
    <td class="flex">
      <button class="btn ghost sm" onclick="editRec(${r.id})" title="ویرایش">✏️</button>
      <button class="btn danger sm" onclick="delRec(${r.id})" title="حذف">🗑</button>
    </td>
  </tr>`).join('') : '<tr><td colspan="7"><div class="empty-state"><div class="big">📋</div>هنوز اشتراکی ثبت نشده است</div></td></tr>';
  renderPager($('#recordsPager'), recPage, Math.max(1, Math.ceil(count / 50)), count, pg => { recPage = pg; loadRecords(); });
}

const mgrOptions = sel => MANAGERS.map(m => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
function recModal(r) {
  openModal(r ? '✏️ ویرایش ثبت' : '➕ افزودن ثبت دستی', `
    <div class="field"><label>شماره اشتراک ${r ? '(غیرقابل تغییر)' : ''}</label>
      <input class="input ltr" id="mNo" ${r ? 'disabled' : ''} value="${r ? esc(r.sub_no) : ''}" style="direction:ltr;text-align:left" placeholder="مثلاً 10092643491"></div>
    <div class="form-row">
      <div class="field"><label>مدیر پروژه</label><select class="input" id="mMgr"><option value="">— بدون مدیر —</option>${mgrOptions(r ? r.manager_id : null)}</select></div>
      <div class="field"><label>ممیز / بازدیدکننده</label><input class="input" id="mInsp" value="${r ? esc(extractInspector(r.data) || '') : ''}"></div>
      <div class="field"><label>تاریخ (میلادی)</label><input type="date" class="input" id="mDate" value="${faDateNum(r ? (r.visit_date || todayISO()) : todayISO())}"></div>
      <div class="field"><label>وضعیت</label><select class="input" id="mStatus">
        <option value="new" ${!r || r.status === 'new' ? 'selected' : ''}>ثبت شده</option>
        <option value="not_found" ${r && r.status === 'not_found' ? 'selected' : ''}>ناموجود در لیست گاز</option>
      </select></div>
    </div>`, async () => {
    const mid = $('#mMgr').value ? Number($('#mMgr').value) : null;
    const vd = getJalaliDateInput('#mDate', todayISO());
    const status = $('#mStatus').value;
    const insp = $('#mInsp').value.trim();
    const dataObj = insp ? { 'ممیز (ویرایش دستی)': insp } : (r ? r.data : {});
    if (r) {
      const { error } = await sb.from('records').update({ manager_id: mid, visit_date: vd, status, data: dataObj }).eq('id', r.id);
      if (error) throw new Error(error.message);
      toast('ثبت ویرایش شد ✅', 'ok');
    } else {
      const no = S.normalizeSubNo($('#mNo').value);
      if (!no) { toast('شماره اشتراک معتبر وارد کنید', 'err'); return false; }
      const [chk] = await runCheck([no]);
      if (chk.registered && chk.first && chk.first.status === 'new') throw new Error('این شماره قبلاً ثبت شده — از ویرایش همان ردیف استفاده کنید');
      if (!chk.in_master && status === 'new' && !confirm('⚠️ این شماره در لیست شرکت گاز نیست.\nبا وضعیت «ناموجود» ثبت شود؟')) { $('#mStatus').value = 'not_found'; return false; }
      const st2 = !chk.in_master ? 'not_found' : status;
      const { error } = await sb.from('records').insert({ sub_no: no, manager_id: mid, status: st2, visit_date: vd, data: dataObj });
      if (error) throw new Error(error.message);
      toast('ثبت جدید اضافه شد ✅', 'ok');
    }
    loadRecords();
  });
}
window.editRec = id => { const r = (window.__recRows || []).find(x => x.id === id); if (r) recModal(r); };
window.delRec = async id => {
  const r = (window.__recRows || []).find(x => x.id === id);
  if (!r) return;
  if (!confirm(`این رکورد حذف شود؟\nشماره: ${r.sub_no} — ${r.manager_name || 'بدون مدیر'}\n(گزارش فایل‌های تاریخچه دست‌نخورده می‌ماند)`)) return;
  const { error } = await sb.from('records').delete().eq('id', id);
  if (error) return toast('خطا: ' + error.message, 'err');
  toast('رکورد حذف شد', 'ok');
  loadRecords();
};
$('#recAddBtn').addEventListener('click', () => recModal(null));

$('#recExportBtn').addEventListener('click', async () => {
  try {
    toast('در حال آماده‌سازی خروجی اکسل...', 'ok');
    const recs = await fetchAllRecordsView(q => applyRecFilters(q));
    const masterMap = await fetchMasterInfo(recs.map(r => r.sub_no));
    downloadXlsx(recordsToExcelRows(recs, masterMap), 'records.xlsx', 'سوابق');
  } catch (e) { toast('خطا: ' + e.message, 'err'); }
});

/* ================= settings ================= */
async function loadSettings() {
  await refreshManagers();
  $('#managersTable tbody').innerHTML = MANAGERS.map(m => `<tr>
    <td><span class="dot" style="background:${m.color};width:14px;height:14px"></span></td>
    <td><b>${esc(m.name)}</b></td>
    <td class="flex">
      <button class="btn ghost sm" onclick="editManager(${m.id})">ویرایش</button>
      <button class="btn danger sm" onclick="deleteManager(${m.id})">حذف</button>
    </td>
  </tr>`).join('');
}

window.editManager = async id => {
  const m = MANAGERS.find(x => x.id === id);
  if (!m) return;
  const name = prompt('نام مدیر پروژه:', m.name);
  if (name === null || !name.trim()) return;
  const { error } = await sb.from('managers').update({ name: name.trim() }).eq('id', id);
  if (error) return toast(error.code === '23505' ? 'این نام تکراری است' : 'خطا: ' + error.message, 'err');
  toast('ذخیره شد', 'ok'); loadSettings();
};

window.deleteManager = async id => {
  const { count } = await sb.from('records').select('id', { count: 'exact', head: true }).eq('manager_id', id);
  if (count > 0) return toast('این مدیر دارای سوابق ثبت است و قابل حذف نیست', 'err');
  if (!confirm('این مدیر پروژه حذف شود؟')) return;
  const { error } = await sb.from('managers').delete().eq('id', id);
  if (error) return toast('خطا: ' + error.message, 'err');
  toast('حذف شد', 'ok'); loadSettings();
};

$('#addMgrBtn').addEventListener('click', async () => {
  const name = $('#newMgrName').value.trim();
  if (!name) return toast('نام مدیر را وارد کنید', 'err');
  const { error } = await sb.from('managers').insert({ name, color: $('#newMgrColor').value });
  if (error) return toast(error.code === '23505' ? 'این نام تکراری است' : 'خطا: ' + error.message, 'err');
  $('#newMgrName').value = '';
  toast('مدیر پروژه اضافه شد', 'ok'); loadSettings();
});

$('#changePassBtn').addEventListener('click', async () => {
  const np = $('#newPass').value;
  if (np.length < 6) return toast('رمز جدید حداقل ۶ کاراکتر باشد', 'err');
  const { error } = await sb.auth.updateUser({ password: np });
  if (error) return toast('خطا: ' + error.message, 'err');
  $('#newPass').value = '';
  toast('رمز عبور تغییر کرد', 'ok');
});

$('#resetBtn').addEventListener('click', async () => {
  if (!confirm('⚠️ هشدار: تمام داده‌ها (لیست شرکت گاز + همه سوابق) حذف می‌شود! ادامه می‌دهید؟')) return;
  if (!confirm('مطمئن هستید؟ این کار قابل بازگشت نیست.')) return;
  const { error } = await sb.rpc('reset_all');
  if (error) return toast('خطا: ' + error.message, 'err');
  toast('همه داده‌ها بازنشانی شد', 'ok');
  await refreshManagers(); loadDashboard(); loadSettings();
});

/* ================= start ================= */
(async () => {
  const { url, key } = getCreds();
  if (!url || !key) { show('setupView'); return; }
  try {
    connect(url, key);
    await testConnection();
    await boot();
  } catch (e) {
    show('setupView');
    $('#setupUrl').value = url; $('#setupKey').value = key;
    $('#setupError').textContent = friendlySetupError(e);
  }
})();

/* ورودی‌های تاریخ در رابط کاربری فقط شمسی هستند؛ دیتابیس همچنان ISO نگه می‌دارد. */
function setJalaliDateInput(sel, iso) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (el) el.value = iso ? faDateNum(iso) : '';
}
function getJalaliDateInput(sel, fallback = null) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (!el || !el.value.trim()) return fallback;
  const iso = jalaliToISO(el.value);
  if (!iso) throw new Error('تاریخ را به شکل شمسی مانند «۱۴۰۵/۰۶/۰۳» وارد کنید.');
  return iso;
}

/* ================= صورت وضعیت مدیران پروژه =================
   تاریخ در رابط کاربری شمسی است؛ برای ذخیره‌سازی و RPC به ISO تبدیل می‌شود. */
const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
function enDigits(v) {
  return String(v || '').replace(/[۰-۹]/g, d => String(persianDigits.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}
function jalaliToISO(value) {
  const m = enDigits(value).trim().replace(/[.\-]/g, '/').match(/^(\d{3,4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const jy = Number(m[1]), jm = Number(m[2]), jd = Number(m[3]);
  if (jy < 1200 || jy > 1600 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  // تبدیل قابل‌اعتماد با تقویم فارسی خود مرورگر؛ محدوده جست‌وجو فقط حدود دو سال است.
  const target = `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
  const fmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const start = Date.UTC(jy + 620, 2, 1), end = Date.UTC(jy + 622, 3, 1);
  for (let t = start; t <= end; t += 86400000) {
    const parts = fmt.formatToParts(new Date(t)).filter(x => x.type !== 'literal');
    const got = `${enDigits(parts[0].value)}/${enDigits(parts[1].value).padStart(2, '0')}/${enDigits(parts[2].value).padStart(2, '0')}`;
    if (got === target) return new Date(t).toISOString().slice(0, 10);
  }
  return null;
}
function jalaliToday() { return faDateNum(todayISO()); }
function statementRowsToExcel(rows, from, to) {
  return rows.map(r => ({
    'نام مدیر پروژه': r.manager_name,
    'جاری': r.current_count || 0,
    'از قبل': r.previous_count || 0,
    'تاکنون': r.total_count || 0,
    'بازه شمسی': `${from} تا ${to}`,
  }));
}
async function loadManagerStatement() {
  const fromJ = $('#statementFrom').value.trim(), toJ = $('#statementTo').value.trim();
  const errBox = $('#statementRangeError');
  errBox.textContent = '';
  const from = jalaliToISO(fromJ), to = jalaliToISO(toJ);
  if (!from || !to) {
    errBox.textContent = 'تاریخ را به شکل شمسی «۱۴۰۵/۰۵/۰۱» وارد کنید.';
    return;
  }
  if (from > to) { errBox.textContent = 'تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد.'; return; }
  const { data, error } = await sb.rpc('manager_statement', { p_from: from, p_to: to });
  if (error) { toast(hintSchema(error), 'err'); return; }
  const rows = data?.rows || [];
  window.__lastStatement = { rows, fromJ, toJ };
  $('#statementTable tbody').innerHTML = rows.length ? rows.map(r => `<tr>
    <td><span class="dot" style="background:${mgrColor(r.manager_id)}"></span><b>${esc(r.manager_name)}</b></td>
    <td style="color:var(--blue);font-weight:700">${faNum(r.current_count)}</td>
    <td>${faNum(r.previous_count)}</td>
    <td style="color:var(--green);font-weight:800">${faNum(r.total_count)}</td>
  </tr>`).join('') : '<tr><td colspan="4"><div class="empty-state">مدیر پروژه‌ای ثبت نشده است</div></td></tr>';
}
$('#applyStatement').addEventListener('click', loadManagerStatement);
$('#statementExportBtn').addEventListener('click', () => {
  const d = window.__lastStatement;
  if (!d) return toast('ابتدا بازه را اعمال کنید.', 'err');
  downloadXlsx(statementRowsToExcel(d.rows, d.fromJ, d.toJ), `صورت-وضعیت-مدیران-${d.fromJ}-تا-${d.toJ}.xlsx`, 'صورت وضعیت');
  toast('خروجی صورت وضعیت دانلود شد ✅', 'ok');
});
// تاریخ پیش‌فرض: اول ماه شمسی تا امروز؛ به‌این‌ترتیب «از قبل» معنای عملیاتی دارد.
(function initStatementDates() {
  const today = jalaliToday();
  const p = enDigits(today).split('/');
  // روز اول همین ماه شمسی
  $('#statementFrom').value = faDateNum(jalaliToISO(`${p[0]}/${p[1]}/1`) || todayISO());
  $('#statementTo').value = today;
})();
