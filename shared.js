/* ============================================================
 * منطق مشترک پردازش فایل اکسل و نرمال‌سازی شماره اشتراک
 * هم در مرورگر (window.GazShared) و هم در Node (برای تست) قابل استفاده است
 * ============================================================ */
(function (root, factory) {
  const mod = factory();
  root.GazShared = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const FA = '۰۱۲۳۴۵۶۷۸۹';
  const AR = '٠١٢٣٤٥٦٧٨٩';

  /** نرمال‌سازی شماره اشتراک: ارقام فارسی/عربی → انگلیسی، حذف فاصله/خط‌تیره، حروف بزرگ */
  function normalizeSubNo(v) {
    if (v === undefined || v === null) return '';
    let s = String(v).trim();
    s = s.replace(/[۰-۹]/g, d => FA.indexOf(d));
    s = s.replace(/[٠-٩]/g, d => AR.indexOf(d));
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, ''); // 123.0 → 123
    s = s.replace(/[،,\s \-_]/g, '');
    return s.toUpperCase();
  }

  function normalizeHeader(h) {
    return String(h || '').replace(/[\s ‌]/g, '');
  }

  /**
   * تبدیل خروجی sheet_to_json(header:1) به سطرهای آبجکتی
   * - تشخیص خودکار سطر هدر (پرترین سطر بین ۵ سطر اول)
   * - تشخیص خودکار ستون شماره اشتراک (هدر شامل «اشتراک»، وگرنه اولین ستون)
   * خروجی: { headers, rows, subCol }
   */
  function gridToRows(grid) {
    if (!grid || !grid.length) return { headers: [], rows: [], subCol: null };

    let hdrIdx = 0, best = -1;
    for (let i = 0; i < Math.min(5, grid.length); i++) {
      const filled = grid[i].filter(x => String(x ?? '').trim() !== '').length;
      if (filled > best) { best = filled; hdrIdx = i; }
    }

    const seen = {};
    let headers = grid[hdrIdx].map((h, i) => {
      let key = String(h ?? '').trim() || ('ستون ' + (i + 1));
      if (seen[key]) { seen[key]++; key = key + '_' + seen[key]; } else seen[key] = 1;
      return key;
    });

    // اگر هیچ هدری شامل «اشتراک» نیست و سطر اول خودش شبیه داده عددی است → فایل هدر ندارد
    if (!headers.some(h => normalizeHeader(h).includes('اشتراک'))) {
      const firstRow = grid[hdrIdx].map(x => String(x ?? '').trim());
      if (firstRow.some(v => /^\d{5,}$/.test(v))) {
        headers = headers.map((h, i) => i === 0 ? 'شماره اشتراک' : h);
        grid = grid.slice(0, hdrIdx).concat([headers], [firstRow], grid.slice(hdrIdx + 1));
        return gridToRows(grid);
      }
    }

    let subIdx = 0;
    for (let i = 0; i < headers.length; i++) {
      if (normalizeHeader(headers[i]).includes('اشتراک')) { subIdx = i; break; }
    }

    const rows = [];
    for (let i = hdrIdx + 1; i < grid.length; i++) {
      const obj = {};
      let isEmpty = true;
      for (let c = 0; c < headers.length; c++) {
        const v = String(grid[i][c] ?? '').trim();
        obj[headers[c]] = v;
        if (v !== '') isEmpty = false;
      }
      if (!isEmpty) rows.push(obj);
    }
    return { headers, rows, subCol: headers[subIdx] };
  }

  /**
   * خواندن فایل اکسل (ArrayBuffer) با کتابخانه XLSX و برگرداندن سطرها
   * @param {ArrayBuffer} buf
   * @param {object} XLSXRef - رفرنس به کتابخانه XLSX (در مرورگر window.XLSX)
   */
  function parseWorkbook(buf, XLSXRef) {
    // xlsx/xls فایل zip است (با PK شروع می‌شود)؛ CSV/TXT را با UTF-8 به‌صورت متن بخوان
    const u8 = new Uint8Array(buf);
    let wb;
    if (u8[0] === 0x50 && u8[1] === 0x4B) {
      wb = XLSXRef.read(buf, { type: 'array' });
    } else {
      const txt = new TextDecoder('utf-8').decode(u8);
      wb = XLSXRef.read(txt, { type: 'string' });
    }
    const sheetNames = wb.SheetNames || [];
    // فایل تک‌شیت: رفتار قبلی
    if (sheetNames.length <= 1) {
      const sheetName = sheetNames[0] || '';
      const ws = wb.Sheets[sheetName];
      if (!ws) return { headers: [], rows: [], subCol: null, sheetName: '' };
      const grid = XLSXRef.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
      return { ...gridToRows(grid), sheetName };
    }
    // فایل چندشیتی (مثل لیست‌های بزرگ‌تر از ظرفیت یک شیت اکسل): همه شیت‌ها به هم می‌چسبند
    const out = { headers: [], rows: [], subCol: null, sheetName: sheetNames[0] || '', sheets: sheetNames.length };
    const subkeyNorm = h => normalizeHeader(h) && normalizeHeader(h).includes('اشتراک');
    for (const name of sheetNames) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      const grid = XLSXRef.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
      const part = gridToRows(grid);
      if (!part.headers.length || !part.rows.length) continue;
      if (!out.subCol) out.subCol = part.subCol;
      // تعیین ستون اشتراک یکتا: اگر در شیت‌ها متفاوت بود، از هدر شامل «اشتراک» استفاده کن
      if (!subkeyNorm(out.subCol) && subkeyNorm(part.subCol)) out.subCol = part.subCol;
      for (const h of part.headers) if (!out.headers.includes(h)) out.headers.push(h);
      for (const r of part.rows) {
        // اگر ستون اشتراک این شیت اسم متفاوتی داشت، مقدارش را روی ستون اصلی هم بگذار
        if (out.subCol && part.subCol !== out.subCol && r[out.subCol] === undefined) r[out.subCol] = r[part.subCol];
        out.rows.push(r);
      }
    }
    return out;
  }

  /** حذف شماره‌های تکراری داخل خود فایل (اولین occurrence نگه داشته می‌شود) */
  function dedupeRows(rows, subCol) {
    const seen = new Set();
    const out = [];
    let empty = 0, dupInFile = 0;
    for (const r of rows) {
      const no = normalizeSubNo(r[subCol]);
      if (!no) { empty++; continue; }
      if (seen.has(no)) { dupInFile++; continue; }
      seen.add(no);
      out.push({ no, data: r });
    }
    return { rows: out, empty, dupInFile };
  }

  return { normalizeSubNo, normalizeHeader, gridToRows, parseWorkbook, dedupeRows };
});
