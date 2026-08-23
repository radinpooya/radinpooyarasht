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
const todayISO = () => new Date().toISOString().slice(0, 10);

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
  $('#recordDate').value = todayISO();
  loadDashboard();
}

/* ================= navigation ================= */
$$('.nav-btn').forEach(btn => btn.addEventListener('click', () => {
  $$('.nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const tab = btn.dataset.tab;
  $$('main.content > section').forEach(s => s.classList.add('hidden'));
  $('#tab-' + tab).classList.remove('hidden');
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'upload') loadUploadsTable();
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
}
const mgrColor = id => (MANAGERS.find(m => m.id === id) || {}).color || '#38bdf8';

/* ================= dashboard ================= */
function statCard(label, value, color, sub) {
  return `<div class="stat-card" style="--sc:${color}">
    <div class="lbl">${label}</div><div class="val">${faNum(value)}</div>
    ${sub ? `<div class="sub2">${sub}</div>` : ''}</div>`;
}

async function loadDashboard() {
  const from = $('#dashFrom').value || null;
  const to = $('#dashTo').value || null;
  const { data: d, error } = await sb.rpc('dashboard_stats', { p_from: from, p_to: to });
  if (error) return toast('خطا در بارگذاری آمار: ' + error.message, 'err');

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

  if (!$('#dashFrom').value) $('#dashFrom').value = d.from;
  if (!$('#dashTo').value) $('#dashTo').value = d.to;

  renderCharts(d, progress);
  renderMgrTable(d);
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
    $('#dashFrom').value = ''; $('#dashTo').value = to;
  } else {
    const d = new Date(); d.setDate(d.getDate() - (parseInt(v) - 1));
    $('#dashFrom').value = d.toISOString().slice(0, 10);
    $('#dashTo').value = to;
  }
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
      first: recs[0] || null,
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
      const { error } = await sb.from('subs').delete().gte('id', 0);
      if (error) throw new Error(error.message);
    }

    // آپلود مرحله‌ای (۵۰۰ ردیف در هر بسته)
    const CH = 500;
    let added = 0;
    $('#masterProgress').classList.remove('hidden');
    for (let i = 0; i < uniq.length; i += CH) {
      const chunk = uniq.slice(i, i + CH).map(r => ({ sub_no: r.no, data: r.data }));
      const { data, error } = await sb.from('subs')
        .upsert(chunk, { onConflict: 'sub_no', ignoreDuplicates: true })
        .select('sub_no');
      if (error) throw new Error(error.message);
      added += (data || []).length;
      const pct = Math.round(Math.min(uniq.length, i + CH) * 100 / uniq.length);
      $('#masterProgressFill').style.width = pct + '%';
      $('#masterProgressTxt').textContent = `${faNum(Math.min(uniq.length, i + CH))} از ${faNum(uniq.length)} ردیف...`;
    }
    if (mode === 'replace') await sb.rpc('recompute_statuses');
    $('#masterProgress').classList.add('hidden');
    $('#masterProgressFill').style.width = '0%';

    const { count } = await sb.from('subs').select('id', { count: 'exact', head: true });
    $('#masterResult').innerHTML = `<div class="flex">
      <span class="badge green">${faNum(added)} اشتراک جدید اضافه شد</span>
      <span class="badge amber">${faNum(uniq.length - added)} مورد از قبل موجود بود</span>
      <span class="badge blue">کل لیست: ${faNum(count)}</span>
    </div>
    <div class="muted mt" style="font-size:12.5px">ستون شناسایی‌شده: «${esc(subCol)}»${empty ? ` — ${faNum(empty)} ردیف خالی نادیده گرفته شد` : ''}${dupInFile ? ` — ${faNum(dupInFile)} شماره تکراری داخل فایل ادغام شد` : ''}</div>`;
    toast('لیست شرکت گاز با موفقیت آپلود شد', 'ok');
  } catch (e) {
    $('#masterProgress').classList.add('hidden');
    toast('خطا: ' + e.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'آپلود لیست شرکت گاز';
  }
});

/* ================= daily records upload ================= */
const INSPECTOR_RE = /(بازدید|ممیز|بازرس|ناظر|inspector)/i;
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
    p_rows.push({ no: r.no, data: r.data, mid: await resolve(rawName) });
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

$('#recordDate').value = todayISO();
$('#prevDate').value = todayISO();
bindFileName('#prevFile', '#prevFileName');

$('#recordUploadBtn').addEventListener('click', async () => {
  const f = $('#recordFile').files[0];
  if (!f) return toast('فایل خروجی روزانه را انتخاب کنید', 'err');
  const btn = $('#recordUploadBtn');
  btn.disabled = true; btn.textContent = 'در حال بررسی...';
  $('#recordResult').innerHTML = '';
  try {
    const { rows, subCol, headers } = await readWorkbookRows(f);
    if (!subCol) throw new Error('فایل خالی است');
    const norm = rows.map(r => ({ no: S.normalizeSubNo(r[subCol]), data: r })).filter(r => r.no);
    if (!norm.length) throw new Error('هیچ شماره اشتراک معتبری در فایل یافت نشد');

    // تشخیص خودکار ستون مدیر پروژه از داخل فایل
    const mgrCol = detectManagerCol(headers, subCol);
    if (!mgrCol) throw new Error('ستون «مدیر پروژه» در فایل پیدا نشد. ستون‌های فایل: «' + headers.join('»، «') + '»');

    const { p_rows, extras: extraErrs } = await rowsWithManagers(norm, mgrCol);

    const visitDate = $('#recordDate').value || todayISO();
    const singleMid = p_rows.length && new Set(p_rows.map(x => x.mid)).size === 1 ? p_rows[0].mid : null;
    const { data: r, error } = await sb.rpc('process_upload', {
      p_filename: f.name,
      p_manager_id: singleMid,
      p_visit_date: visitDate,
      p_rows,
      p_uploaded_by: ME.email || null,
    });
    if (error) throw new Error(error.message);

    const errs = [
      ...(r.dupItems || []).map(d => ({ ...d, kind: 'duplicate' })),
      ...(r.nfItems || []).map(d => ({ ...d, kind: 'not_found' })),
      ...extraErrs,
    ];
    const kindBadge = k => k === 'duplicate'
      ? '<span class="badge amber">تکراری 🔁</span>'
      : k === 'not_found'
        ? '<span class="badge red">ناموجود در لیست ❌</span>'
        : '<span class="badge gray">مدیر نامشخص ⚠️</span>';

    $('#recordResult').innerHTML = `
      <div class="flex mb">
        <span class="badge blue">${faNum(r.total + extraErrs.length)} شماره بررسی شد</span>
        <span class="badge green">${faNum(r.new)} ثبت جدید ✅</span>
        ${r.dup ? `<span class="badge amber">${faNum(r.dup)} خطای تکراری 🔁</span>` : ''}
        ${r.nf ? `<span class="badge red">${faNum(r.nf)} خطای ناموجود ❌</span>` : ''}
        ${extraErrs.length ? `<span class="badge gray">${faNum(extraErrs.length)} بدون مدیر ⚠️</span>` : ''}
      </div>
      <div class="muted mb" style="font-size:12.5px">ستون‌های شناسایی‌شده: اشتراک «${esc(subCol)}» — مدیر پروژه «${esc(mgrCol)}»${INSPECTOR_RE.test(headers.find(h => INSPECTOR_RE.test(h)) || '') ? ' — ممیز «' + esc(headers.find(h => INSPECTOR_RE.test(h))) + '»' : ''}</div>
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
        <button class="btn ghost sm" id="dlReportBtn">⬇ دانلود گزارش کامل این فایل (اکسل)</button>
        <span class="muted" style="font-size:12.5px">گزارش همیشه از «تاریخچه فایل‌های آپلودشده» هم قابل دانلود است</span>
      </div>`;
    $('#dlReportBtn').onclick = () => downloadXlsx(
      buildDailyReportRows(norm, r, mgrCol, visitDate, extraErrs),
      `گزارش-${f.name.replace(/\.[^.]+$/, '')}.xlsx`, 'گزارش بررسی');
    toast(errs.length ? 'پردازش شد — خطاها را بررسی کنید' : 'همه شماره‌ها با موفقیت ثبت شدند ✅', errs.length ? '' : 'ok');
    loadUploadsTable();
  } catch (e) {
    toast(hintSchema(e), 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'آپلود و بررسی خودکار';
  }
});

/* ================= import previous registrations («فایل دوم») ================= */
$('#importPrevBtn').addEventListener('click', async () => {
  const f = $('#prevFile').files[0];
  if (!f) return toast('فایل ثبت‌شده‌های قبلی را انتخاب کنید', 'err');
  const btn = $('#importPrevBtn');
  btn.disabled = true; btn.textContent = 'در حال واردکردن...';
  $('#prevResult').innerHTML = '';
  try {
    const { rows, subCol, headers } = await readWorkbookRows(f);
    if (!subCol) throw new Error('فایل خالی است');
    const norm = rows.map(r => ({ no: S.normalizeSubNo(r[subCol]), data: r })).filter(r => r.no);
    if (!norm.length) throw new Error('هیچ شماره اشتراک معتبری در فایل یافت نشد');

    const mgrCol = detectManagerCol(headers, subCol);
    if (!mgrCol) throw new Error('ستون «مدیر پروژه» در فایل پیدا نشد. ستون‌های فایل: «' + headers.join('»، «') + '»');

    const { p_rows, extras } = await rowsWithManagers(norm, mgrCol);

    // تکه‌تکه ارسال می‌کنیم تا حجم درخواست‌ها بالا نرود
    const CH = 1000;
    let total = 0, added = 0, dup = 0, nf = 0;
    for (let i = 0; i < p_rows.length; i += CH) {
      const { data: r, error } = await sb.rpc('import_registered', {
        p_filename: f.name + (p_rows.length > CH ? ` (بخش ${Math.floor(i / CH) + 1})` : ''),
        p_manager_id: null,
        p_visit_date: $('#prevDate').value || todayISO(),
        p_rows: p_rows.slice(i, i + CH),
        p_uploaded_by: ME.email || null,
      });
      if (error) throw new Error(error.message);
      total += r.total; added += r.added; dup += r.dup; nf += r.nf;
    }

    $('#prevResult').innerHTML = `<div class="flex">
      <span class="badge blue">${faNum(total + extras.length)} شماره بررسی شد</span>
      <span class="badge green">${faNum(added)} به ثبت‌شده‌ها اضافه شد ✅</span>
      ${dup ? `<span class="badge amber">${faNum(dup)} از قبل موجود بود</span>` : ''}
      ${nf ? `<span class="badge red">${faNum(nf)} در لیست شرکت گاز نبود و رد شد ❌</span>` : ''}
      ${extras.length ? `<span class="badge gray">${faNum(extras.length)} بدون مدیر رد شد ⚠️</span>` : ''}
    </div>
    <div class="muted mt" style="font-size:12.5px">ستون مدیر پروژه شناسایی‌شده: «${esc(mgrCol)}» — از این پس چک تکراری فایل‌های روزانه بر اساس همین ثبت‌شده‌ها انجام می‌شود.</div>`;
    toast('ثبت‌های قبلی وارد سیستم شد ✅', 'ok');
    loadUploadsTable();
  } catch (e) {
    toast(hintSchema(e), 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'واردکردن ثبت‌های قبلی';
  }
});

/* ================= گزارش اکسل بررسی روزانه ================= */
function buildDailyReportRows(norm, result, mgrCol, visitDate, extraErrs = []) {
  const dupMap = {};
  (result.dupItems || []).forEach(d => dupMap[d.no] = d);
  const nfSet = new Set((result.nfItems || []).map(x => x.no));
  const noMgrSet = new Set(extraErrs.map(x => x.no));
  const dataKeys = [];
  norm.forEach(r => Object.keys(r.data || {}).forEach(k => {
    if (!dataKeys.includes(k) && dataKeys.length < 20) dataKeys.push(k);
  }));
  const seenOk = new Set();
  return norm.map(r => {
    const rawMgr = String((r.data || {})[mgrCol] ?? '').trim();
    const noMgr = noMgrSet.has(r.no) || !normalizeName(rawMgr);
    const isNf = !noMgr && nfSet.has(r.no);
    let dup = (!noMgr && !isNf) ? (dupMap[r.no] || null) : null;
    // اگر همین فایل دوبار شامل شماره بود، اولین occurrence «ثبت شد» است
    if (dup && dup.prev_date === visitDate && normalizeName(dup.prev_manager) === normalizeName(rawMgr) && !seenOk.has(r.no)) dup = null;
    if (!noMgr && !isNf && !dup) seenOk.add(r.no);
    const o = {
      'شماره اشتراک': r.no,
      'نتیجه بررسی': noMgr ? 'بدون مدیر پروژه — ثبت نشد ⚠️'
        : isNf ? 'ناموجود در لیست شرکت گاز ❌'
        : dup ? 'تکراری — قبلاً ثبت شده 🔁' : 'ثبت شد ✅',
      'مدیر پروژه (ثبت اول)': dup ? (dup.prev_manager || '') : (noMgr || isNf ? '' : rawMgr),
      'ممیز (ثبت اول)': dup ? (dup.prev_inspector || '') : '',
      'تاریخ ثبت اول': dup ? (dup.prev_date || '') : (noMgr || isNf ? '' : visitDate),
    };
    for (const k of dataKeys) o['اطلاعات فایل | ' + k] = (r.data || {})[k] ?? '';
    return o;
  });
}

function buildHistoryReportRows(recs, details, mgrName) {
  const rows = recs.map(x => ({
    'شماره اشتراک': x.sub_no,
    'نتیجه بررسی': 'ثبت شد ✅',
    'مدیر پروژه (ثبت اول)': x.manager_name || mgrName || '',
    'ممیز (ثبت اول)': extractInspector(x.data),
    'تاریخ ثبت اول': x.visit_date || '',
  }));
  (details.dupItems || []).forEach(it => rows.push({
    'شماره اشتراک': it.no,
    'نتیجه بررسی': 'تکراری — قبلاً ثبت شده 🔁',
    'مدیر پروژه (ثبت اول)': it.prev_manager || '',
    'ممیز (ثبت اول)': it.prev_inspector || '',
    'تاریخ ثبت اول': it.prev_date || '',
  }));
  (details.nfItems || []).forEach(it => rows.push({
    'شماره اشتراک': it.no,
    'نتیجه بررسی': 'ناموجود در لیست شرکت گاز ❌',
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
  $('#uploadsTable tbody').innerHTML = rows.length ? rows.map(u => `<tr>
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
      <button class="btn ghost sm" onclick="downloadUploadReport(${u.id})">گزارش</button>
      <button class="btn danger sm" onclick="deleteUpload(${u.id})">حذف</button>
    </td>
  </tr>`).join('') : '<tr><td colspan="10"><div class="empty-state"><div class="big">📂</div>هنوز فایلی آپلود نشده است</div></td></tr>';
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
  XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'data').slice(0, 31));
  XLSX.writeFile(wb, filename);
}

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
      'تاریخ بازدید': r.visit_date,
      'مدیر پروژه': r.manager_name || '',
      'فایل': r.filename || '',
      'موجود در لیست شرکت گاز': r.in_master ? 'بله' : 'خیر',
      'تاریخ اولین ثبت': r.prev_date || '',
      'مدیر اولین ثبت': r.prev_manager || '',
    };
    for (const k of masterKeys) o['اطلاعات | ' + k] = md[k] ?? '';
    return o;
  });
}

window.downloadUploadReport = async uploadId => {
  try {
    toast('در حال آماده‌سازی گزارش...', 'ok');
    const { data: u, error } = await sb.from('uploads')
      .select('id,filename,visit_date,details,managers(name)').eq('id', uploadId).single();
    if (error) throw new Error(error.message);
    const recs = await fetchAllRecordsView(q => q.eq('upload_id', uploadId));
    downloadXlsx(
      buildHistoryReportRows(recs, u.details || {}, u.managers?.name || ''),
      `گزارش-${(u.filename || 'upload-' + uploadId).replace(/\.[^.]+$/, '')}.xlsx`, 'گزارش بررسی');
  } catch (e) { toast('خطا: ' + e.message, 'err'); }
};

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
  $('#subsTable thead').innerHTML = `<tr><th>شماره اشتراک</th>${keys.map(k => `<th>${esc(k)}</th>`).join('')}<th>وضعیت</th></tr>`;
  $('#subsTable tbody').innerHTML = data.length ? data.map(r => `<tr>
    <td class="ltr"><b>${esc(r.sub_no)}</b></td>
    ${keys.map(k => `<td>${esc((r.data || {})[k] ?? '')}</td>`).join('')}
    <td>${r.times > 0 ? `<span class="badge amber">ثبت شده (${faNum(r.times)} بار)</span>` : '<span class="badge gray">ثبت نشده</span>'}</td>
  </tr>`).join('') : `<tr><td colspan="${keys.length + 2}"><div class="empty-state"><div class="big">🗄️</div>${subsQ ? 'موردی یافت نشد' : 'لیست شرکت گاز هنوز آپلود نشده — از بخش «آپلود فایل» اقدام کنید'}</div></td></tr>`;
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

/* ================= records list ================= */
let recPage = 1;
$('#recFilterBtn').addEventListener('click', () => { recPage = 1; loadRecords(); });
$('#recSearch').addEventListener('keydown', e => { if (e.key === 'Enter') $('#recFilterBtn').click(); });

function applyRecFilters(q) {
  const s = S.normalizeSubNo($('#recSearch').value);
  if (s) q = q.ilike('sub_no', '%' + s + '%');
  if ($('#recManager').value) q = q.eq('manager_id', Number($('#recManager').value));
  if ($('#recStatus').value) q = q.eq('status', $('#recStatus').value);
  if ($('#recFrom').value) q = q.gte('visit_date', $('#recFrom').value);
  if ($('#recTo').value) q = q.lte('visit_date', $('#recTo').value);
  return q;
}

async function loadRecords() {
  let q = sb.from('records_view').select('*', { count: 'exact' }).order('id', { ascending: false });
  q = applyRecFilters(q);
  const from = (recPage - 1) * 50;
  const { data, error, count } = await q.range(from, from + 49);
  if (error) return toast('خطا: ' + error.message, 'err');
  $('#recordsTable tbody').innerHTML = data.length ? data.map(r => `<tr>
    <td class="ltr"><b>${esc(r.sub_no)}</b></td>
    <td>${statusBadge(r.status)}</td>
    <td><b>${esc(extractInspector(r.data) || '—')}</b></td>
    <td>${faDate(r.visit_date)}</td>
    <td>${esc(r.manager_name || '—')}</td>
    <td class="ltr" style="max-width:160px;overflow:hidden;text-overflow:ellipsis">${esc(r.filename || '—')}</td>
  </tr>`).join('') : '<tr><td colspan="6"><div class="empty-state"><div class="big">📋</div>هنوز اشتراکی ثبت نشده است</div></td></tr>';
  renderPager($('#recordsPager'), recPage, Math.max(1, Math.ceil(count / 50)), count, pg => { recPage = pg; loadRecords(); });
}

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
