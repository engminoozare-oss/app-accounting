/* ============================================================
   حساب کتاب — ثبت و تفکیک هزینه‌ها
   همه‌ی داده‌ها فقط روی همین دستگاه (localStorage) ذخیره می‌شوند.
   ============================================================ */
(function () {
  'use strict';

  var STORE_KEY = 'hesab.v1';
  var APP_VERSION = '1.0';

  /* ---------------- ابزارهای عددی فارسی ---------------- */

  var FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

  function toFa(str) {
    return String(str).replace(/\d/g, function (d) { return FA_DIGITS[+d]; });
  }
  function toEn(str) {
    return String(str)
      .replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); })
      .replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); });
  }
  function groupDigits(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u060C');
  }
  /* عدد با جداکننده هزارگان فارسی */
  function money(n) {
    return toFa(groupDigits(Math.round(Number(n) || 0)));
  }
  function parseAmount(raw) {
    var s = toEn(String(raw || '')).replace(/[^\d]/g, '');
    return s ? parseInt(s, 10) : 0;
  }

  /* عدد به حروف فارسی */
  var _YEK = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
  var _DAH = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
  var _DAHGAN = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
  var _SAD = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
  var _SCALE = ['', ' هزار', ' میلیون', ' میلیارد', ' هزار میلیارد'];

  function threeToWords(n) {
    var out = [], h = Math.floor(n / 100), r = n % 100;
    if (h) out.push(_SAD[h]);
    if (r >= 10 && r <= 19) out.push(_DAH[r - 10]);
    else {
      var t = Math.floor(r / 10), o = r % 10;
      if (t) out.push(_DAHGAN[t]);
      if (o) out.push(_YEK[o]);
    }
    return out.join(' و ');
  }
  function numToWords(n) {
    n = Math.round(Number(n) || 0);
    if (n === 0) return 'صفر';
    if (n < 0) return 'منفی ' + numToWords(-n);
    var parts = [], i = 0;
    while (n > 0 && i < _SCALE.length) {
      var chunk = n % 1000;
      if (chunk) parts.unshift(threeToWords(chunk) + _SCALE[i]);
      n = Math.floor(n / 1000);
      i++;
    }
    return parts.join(' و ');
  }

  /* تاریخ شمسی با ارقام فارسی برای نمایش */
  function fdate(iso, long) {
    return toFa(Jalali.format(iso, long ? { long: true } : undefined));
  }
  function fmonth(key) { return toFa(Jalali.monthLabel(key)); }
  /* درصد با جداکننده اعشار فارسی */
  function faPercent(n) { return toFa(String(n)).replace('.', '٫'); }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(id) { return document.getElementById(id); }

  /* ---------------- داده‌های پیش‌فرض ---------------- */

  var ENTITY_TYPES = {
    farm: 'مرغداری',
    worker: 'کارگر',
    manager: 'مدیریت',
    other: 'سایر'
  };
  var TYPE_ORDER = ['farm', 'worker', 'manager', 'other'];
  var TYPE_GROUP_LABEL = {
    farm: 'مرغداری‌ها',
    worker: 'کارگرها',
    manager: 'مدیریت',
    other: 'سایر'
  };

  function defaultState() {
    return {
      version: 2,
      currency: 'تومان',
      metaUpdatedAt: 0,
      entities: [
        { id: 'e_dashtsabz', name: 'مرغداری دشت سبز', type: 'farm', active: true },
        { id: 'e_banaft', name: 'مرغداری بنافت', type: 'farm', active: true },
        { id: 'e_w_dashtsabz', name: 'کارگر مرغداری دشت سبز', type: 'worker', active: true },
        { id: 'e_w_banaft', name: 'کارگر مرغداری بنافت', type: 'worker', active: true },
        { id: 'e_hossein', name: 'حسین (پدر)', type: 'manager', active: true },
        { id: 'e_abolfazl', name: 'ابوالفضل', type: 'manager', active: true },
        { id: 'e_amir', name: 'امیر', type: 'manager', active: true }
      ],
      categories: [
        { id: 'c_dan', name: 'خوراک و دان' },
        { id: 'c_jooje', name: 'خرید جوجه' },
        { id: 'c_daru', name: 'دارو و واکسن' },
        { id: 'c_hoghoogh', name: 'حقوق و دستمزد' },
        { id: 'c_bargh', name: 'برق و آب و گاز' },
        { id: 'c_sookht', name: 'سوخت' },
        { id: 'c_tamir', name: 'تعمیر و نگهداری' },
        { id: 'c_haml', name: 'حمل و نقل' },
        { id: 'c_lavazem', name: 'خرید لوازم' },
        { id: 'c_khorak', name: 'خورد و خوراک' },
        { id: 'c_darman', name: 'درمان و پزشکی' },
        { id: 'c_motefarreghe', name: 'متفرقه' }
      ],
      expenses: []
    };
  }

  var state = null;

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      var s = JSON.parse(raw);
      if (!s || !Array.isArray(s.entities) || !Array.isArray(s.expenses)) return defaultState();
      if (!Array.isArray(s.categories)) s.categories = defaultState().categories;
      if (!s.currency) s.currency = 'تومان';
      s.entities.forEach(function (e) { if (e.active === undefined) e.active = true; });
      return migrate(s);
    } catch (err) {
      console.error('خطا در خواندن داده‌ها', err);
      return defaultState();
    }
  }

  /* داده‌های نسخه‌های قبلی را برای همگام‌سازی آماده می‌کند */
  function migrate(s) {
    if (typeof s.metaUpdatedAt !== 'number') s.metaUpdatedAt = 0;
    s.expenses.forEach(function (x) {
      if (typeof x.updatedAt !== 'number') x.updatedAt = x.createdAt || Date.now();
      if (typeof x.createdAt !== 'number') x.createdAt = x.updatedAt;
      x.deleted = !!x.deleted;
    });
    s.version = 2;
    return s;
  }

  /* هزینه‌های واقعی؛ رکوردهای حذف‌شده فقط نشانه‌ی حذف‌اند و شمرده نمی‌شوند */
  function liveExpenses() {
    return state.expenses.filter(function (x) { return !x.deleted; });
  }

  var saveTimer = null, pendingSync = false;
  function save(skipSync) {
    if (!skipSync) pendingSync = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
      } catch (err) {
        toast('ذخیره نشد! حافظه دستگاه پر است.');
        console.error(err);
      }
      if (pendingSync && window.Sync) window.Sync.nudge();
      pendingSync = false;
    }, 60);
  }

  /* هر تغییر در موجودیت‌ها یا دسته‌بندی‌ها باید به دستگاه‌های دیگر برسد */
  function touchMeta() { state.metaUpdatedAt = Date.now(); }

  function entityById(id) {
    for (var i = 0; i < state.entities.length; i++) if (state.entities[i].id === id) return state.entities[i];
    return null;
  }
  function categoryById(id) {
    for (var i = 0; i < state.categories.length; i++) if (state.categories[i].id === id) return state.categories[i];
    return null;
  }
  function entityName(id) { var e = entityById(id); return e ? e.name : 'نامشخص'; }
  function categoryName(id) { var c = categoryById(id); return c ? c.name : 'بدون دسته'; }

  /* ---------------- پیام شناور ---------------- */

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.firstElementChild.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2400);
  }

  /* ---------------- پنجره تأیید ---------------- */

  var confirmCb = null;
  function askConfirm(title, text, cb) {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmModal').hidden = false;
    confirmCb = cb;
  }
  $('confirmNo').onclick = function () { $('confirmModal').hidden = true; confirmCb = null; };
  $('confirmYes').onclick = function () {
    $('confirmModal').hidden = true;
    if (confirmCb) confirmCb();
    confirmCb = null;
  };
  $('confirmModal').onclick = function (e) {
    if (e.target === this) { this.hidden = true; confirmCb = null; }
  };

  /* ---------------- تقویم شمسی ---------------- */

  var calCtx = { onPick: null, selected: null, viewY: 0, viewM: 0 };

  function openCalendar(currentIso, onPick) {
    var j = Jalali.isoToJalali(currentIso || Jalali.todayIso());
    calCtx.onPick = onPick;
    calCtx.selected = currentIso || Jalali.todayIso();
    calCtx.viewY = j.jy;
    calCtx.viewM = j.jm;
    renderCalendar();
    $('calModal').hidden = false;
  }
  function closeCalendar() { $('calModal').hidden = true; calCtx.onPick = null; }

  function renderCalendar() {
    var y = calCtx.viewY, m = calCtx.viewM;
    $('calTitle').textContent = Jalali.MONTHS[m - 1] + ' ' + toFa(y);
    var len = Jalali.monthLength(y, m);
    var first = Jalali.weekDay(y, m, 1);
    var todayJ = Jalali.isoToJalali(Jalali.todayIso());
    var selJ = calCtx.selected ? Jalali.isoToJalali(calCtx.selected) : null;
    var html = '';
    Jalali.WEEK_DAYS_SHORT.forEach(function (w) { html += '<div class="wd">' + w + '</div>'; });
    for (var b = 0; b < first; b++) html += '<button class="d blank" disabled></button>';
    for (var d = 1; d <= len; d++) {
      var cls = 'd';
      if (todayJ.jy === y && todayJ.jm === m && todayJ.jd === d) cls += ' today';
      if (selJ && selJ.jy === y && selJ.jm === m && selJ.jd === d) cls += ' sel';
      if (Jalali.weekDay(y, m, d) === 6) cls += ' holiday';
      html += '<button class="' + cls + '" data-d="' + d + '">' + toFa(d) + '</button>';
    }
    $('calGrid').innerHTML = html;
  }

  $('calGrid').addEventListener('click', function (e) {
    var b = e.target.closest('.d[data-d]');
    if (!b) return;
    var iso = Jalali.jalaliToIso(calCtx.viewY, calCtx.viewM, +b.dataset.d);
    var cb = calCtx.onPick;
    closeCalendar();
    if (cb) cb(iso);
  });
  $('calPrev').onclick = function () {
    calCtx.viewM--;
    if (calCtx.viewM < 1) { calCtx.viewM = 12; calCtx.viewY--; }
    renderCalendar();
  };
  $('calNext').onclick = function () {
    calCtx.viewM++;
    if (calCtx.viewM > 12) { calCtx.viewM = 1; calCtx.viewY++; }
    renderCalendar();
  };
  $('calToday').onclick = function () {
    var cb = calCtx.onPick; closeCalendar(); if (cb) cb(Jalali.todayIso());
  };
  $('calYesterday').onclick = function () {
    var d = new Date(); d.setDate(d.getDate() - 1);
    var iso = d.getFullYear() + '-' + Jalali.pad2(d.getMonth() + 1) + '-' + Jalali.pad2(d.getDate());
    var cb = calCtx.onPick; closeCalendar(); if (cb) cb(iso);
  };
  $('calClose').onclick = closeCalendar;
  $('calModal').onclick = function (e) { if (e.target === this) closeCalendar(); };

  /* توصیف نسبی تاریخ: امروز / دیروز / ۳ روز پیش */
  function relDay(iso) {
    var a = new Date(iso + 'T00:00:00');
    var b = new Date(Jalali.todayIso() + 'T00:00:00');
    var diff = Math.round((b - a) / 86400000);
    if (diff === 0) return 'امروز';
    if (diff === 1) return 'دیروز';
    if (diff === 2) return 'پریروز';
    if (diff > 2 && diff < 30) return toFa(diff) + ' روز پیش';
    if (diff < 0) return toFa(-diff) + ' روز بعد';
    return '';
  }

  /* ---------------- فرم ثبت هزینه ---------------- */

  var form = { date: Jalali.todayIso(), entityId: null, categoryId: null, editingId: null };

  function renderEntityPicker(container, selectedId, onSelect, opts) {
    var html = '';
    TYPE_ORDER.forEach(function (type) {
      var list = state.entities.filter(function (e) {
        return e.type === type && (e.active || e.id === selectedId);
      });
      if (!list.length) return;
      html += '<div><div class="glabel">' + TYPE_GROUP_LABEL[type] + '</div><div class="opts">';
      list.forEach(function (e) {
        html += '<button type="button" class="chip' + (e.id === selectedId ? ' on' : '') +
          '" data-id="' + e.id + '">' + esc(e.name) + '</button>';
      });
      html += '</div></div>';
    });
    if (opts && opts.allOption) {
      html = '<div class="opts"><button type="button" class="chip' + (selectedId === null ? ' on' : '') +
        '" data-id="">همه</button></div>' + html;
    }
    container.innerHTML = html || '<div class="note">موردی تعریف نشده است.</div>';
    container.onclick = function (e) {
      var b = e.target.closest('.chip[data-id]');
      if (!b) return;
      onSelect(b.dataset.id || null);
    };
  }

  function renderCategoryPicker(container, selectedId, onSelect, opts) {
    var html = '';
    if (opts && opts.allOption) {
      html += '<button type="button" class="chip' + (selectedId === null ? ' on' : '') + '" data-id="">همه</button>';
    }
    state.categories.forEach(function (c) {
      html += '<button type="button" class="chip' + (c.id === selectedId ? ' on' : '') +
        '" data-id="' + c.id + '">' + esc(c.name) + '</button>';
    });
    container.innerHTML = html;
    container.onclick = function (e) {
      var b = e.target.closest('.chip[data-id]');
      if (!b) return;
      onSelect(b.dataset.id || null);
    };
  }

  function renderForm() {
    renderEntityPicker($('fEntity'), form.entityId, function (id) {
      form.entityId = id; renderForm();
    });
    renderCategoryPicker($('fCategory'), form.categoryId, function (id) {
      form.categoryId = id; renderForm();
    });
    $('fDateLabel').textContent = fdate(form.date, true);
    $('fDateRel').textContent = relDay(form.date);
    $('fUnit').textContent = state.currency;
    $('formTitle').textContent = form.editingId ? 'ویرایش هزینه' : 'ثبت هزینه جدید';
    $('fSave').textContent = form.editingId ? 'ذخیره تغییرات' : 'ثبت هزینه';
    $('fEditActions').hidden = !form.editingId;
    renderTitleSuggestions();
  }

  /* پیشنهاد موضوع بر اساس ثبت‌های قبلی */
  function renderTitleSuggestions() {
    var counts = {};
    liveExpenses().forEach(function (x) {
      if (!x.title) return;
      if (form.entityId && x.entityId !== form.entityId) return;
      counts[x.title] = (counts[x.title] || 0) + 1;
    });
    var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 6);
    $('fTitleSuggest').innerHTML = top.map(function (t) {
      return '<button type="button" class="chip" data-t="' + esc(t) + '">' + esc(t) + '</button>';
    }).join('');
  }
  $('fTitleSuggest').onclick = function (e) {
    var b = e.target.closest('.chip[data-t]');
    if (!b) return;
    $('fTitle').value = b.dataset.t;
  };

  $('fAmount').addEventListener('input', function () {
    var n = parseAmount(this.value);
    this.value = n ? toFa(groupDigits(n)) : '';
    $('fAmountHint').textContent = n ? numToWords(n) + ' ' + state.currency : '';
  });

  $('fDateBtn').onclick = function () {
    openCalendar(form.date, function (iso) { form.date = iso; renderForm(); });
  };

  function resetForm(keepEntity) {
    form.editingId = null;
    form.date = Jalali.todayIso();
    if (!keepEntity) form.entityId = null;
    form.categoryId = null;
    $('fAmount').value = '';
    $('fAmountHint').textContent = '';
    $('fTitle').value = '';
    $('fNote').value = '';
    renderForm();
  }

  $('fReset').onclick = function () { resetForm(false); };

  $('fSave').onclick = function () {
    var amount = parseAmount($('fAmount').value);
    var title = $('fTitle').value.trim();
    if (!amount) { toast('مبلغ را وارد کنید'); $('fAmount').focus(); return; }
    if (!title) { toast('موضوع هزینه را بنویسید'); $('fTitle').focus(); return; }
    if (!form.entityId) { toast('مشخص کنید هزینه برای چه کسی است'); return; }

    if (form.editingId) {
      var x = state.expenses.filter(function (e) { return e.id === form.editingId; })[0];
      if (x) {
        x.amount = amount; x.title = title; x.entityId = form.entityId;
        x.categoryId = form.categoryId; x.date = form.date; x.note = $('fNote').value.trim();
        x.updatedAt = Date.now();
      }
      save();
      toast('تغییرات ذخیره شد');
      resetForm(false);
      renderAll();
      go('list');
      return;
    }

    var now = Date.now();
    state.expenses.push({
      id: uid(),
      amount: amount,
      title: title,
      entityId: form.entityId,
      categoryId: form.categoryId,
      date: form.date,
      note: $('fNote').value.trim(),
      createdAt: now,
      updatedAt: now,
      deleted: false
    });
    save();
    toast('ثبت شد: ' + money(amount) + ' ' + state.currency);
    var keptEntity = form.entityId;
    resetForm(true);
    form.entityId = keptEntity;
    renderForm();
    renderAll();
  };

  $('fDelete').onclick = function () {
    var id = form.editingId;
    askConfirm('حذف هزینه', 'این هزینه برای همیشه حذف می‌شود. مطمئن هستید؟', function () {
      state.expenses.forEach(function (e) {
        if (e.id === id) { e.deleted = true; e.updatedAt = Date.now(); }
      });
      save();
      toast('حذف شد');
      resetForm(false);
      renderAll();
      go('list');
    });
  };

  function editExpense(id) {
    var x = state.expenses.filter(function (e) { return e.id === id; })[0];
    if (!x) return;
    form.editingId = x.id;
    form.date = x.date;
    form.entityId = x.entityId;
    form.categoryId = x.categoryId;
    $('fAmount').value = toFa(groupDigits(x.amount));
    $('fAmountHint').textContent = numToWords(x.amount) + ' ' + state.currency;
    $('fTitle').value = x.title;
    $('fNote').value = x.note || '';
    renderForm();
    go('add');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- دوره‌های زمانی ---------------- */

  var PERIODS = [
    { id: 'this-month', label: 'این ماه' },
    { id: 'last-month', label: 'ماه قبل' },
    { id: 'this-year', label: 'امسال' },
    { id: 'all', label: 'همه' },
    { id: 'custom', label: 'بازه دلخواه' }
  ];

  function periodRange(p, from, to) {
    var t = Jalali.isoToJalali(Jalali.todayIso());
    if (p === 'this-month') return Jalali.monthRange(t.jy, t.jm);
    if (p === 'last-month') {
      var y = t.jy, m = t.jm - 1;
      if (m < 1) { m = 12; y--; }
      return Jalali.monthRange(y, m);
    }
    if (p === 'this-year') {
      return [Jalali.jalaliToIso(t.jy, 1, 1), Jalali.jalaliToIso(t.jy, 12, Jalali.monthLength(t.jy, 12))];
    }
    if (p === 'custom') return from <= to ? [from, to] : [to, from];
    return ['0000-01-01', '9999-12-31'];
  }

  function periodLabel(p, from, to) {
    var t = Jalali.isoToJalali(Jalali.todayIso());
    if (p === 'this-month') return 'جمع ' + Jalali.MONTHS[t.jm - 1] + ' ' + toFa(t.jy);
    if (p === 'last-month') {
      var y = t.jy, m = t.jm - 1;
      if (m < 1) { m = 12; y--; }
      return 'جمع ' + Jalali.MONTHS[m - 1] + ' ' + toFa(y);
    }
    if (p === 'this-year') return 'جمع سال ' + toFa(t.jy);
    if (p === 'custom') return 'جمع ' + fdate(from) + ' تا ' + fdate(to);
    return 'جمع کل هزینه‌ها';
  }

  function renderSegmented(container, items, current, onPick) {
    container.innerHTML = items.map(function (it) {
      return '<button data-v="' + it.id + '"' + (it.id === current ? ' class="on"' : '') + '>' +
        it.label + '</button>';
    }).join('');
    container.onclick = function (e) {
      var b = e.target.closest('button[data-v]');
      if (b) onPick(b.dataset.v);
    };
  }

  /* ---------------- فیلتر لیست ---------------- */

  var listF = {
    q: '', period: 'this-month', from: Jalali.todayIso(), to: Jalali.todayIso(),
    entityId: null, categoryId: null
  };

  function applyFilter(f) {
    var r = periodRange(f.period, f.from, f.to);
    var q = f.q.trim().toLowerCase();
    return liveExpenses().filter(function (x) {
      if (x.date < r[0] || x.date > r[1]) return false;
      if (f.entityId && x.entityId !== f.entityId) return false;
      if (f.categoryId && x.categoryId !== f.categoryId) return false;
      if (q) {
        var hay = (x.title + ' ' + (x.note || '') + ' ' + entityName(x.entityId) + ' ' +
          categoryName(x.categoryId)).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function sum(list) {
    return list.reduce(function (s, x) { return s + (x.amount || 0); }, 0);
  }

  function renderList() {
    renderSegmented($('qPeriod'), PERIODS, listF.period, function (v) {
      listF.period = v; renderList();
    });
    $('qCustomRange').hidden = listF.period !== 'custom';
    $('qFromLabel').textContent = fdate(listF.from);
    $('qToLabel').textContent = fdate(listF.to);
    renderEntityPicker($('qEntity'), listF.entityId, function (id) {
      listF.entityId = id; renderList();
    }, { allOption: true });
    renderCategoryPicker($('qCategory'), listF.categoryId, function (id) {
      listF.categoryId = id; renderList();
    }, { allOption: true });

    var picked = [];
    if (listF.entityId) picked.push(entityName(listF.entityId));
    if (listF.categoryId) picked.push(categoryName(listF.categoryId));
    $('qMoreBtn').textContent = picked.length
      ? 'فیلتر: ' + picked.join(' + ')
      : 'فیلتر بر اساس شخص و دسته‌بندی';
    $('qMoreBtn').classList.toggle('primary', picked.length > 0);

    var list = applyFilter(listF);
    $('listTotal').innerHTML = money(sum(list)) + ' <small>' + esc(state.currency) + '</small>';
    $('filterCount').textContent = toFa(list.length) + ' مورد';
    $('listBody').innerHTML = renderGroupedItems(list);
  }

  function renderGroupedItems(list) {
    if (!list.length) {
      return '<div class="card"><div class="empty"><div class="big">🧾</div>' +
        'هزینه‌ای برای این فیلتر پیدا نشد.</div></div>';
    }
    var groups = [], byDate = {};
    list.forEach(function (x) {
      if (!byDate[x.date]) { byDate[x.date] = []; groups.push(x.date); }
      byDate[x.date].push(x);
    });
    return groups.map(function (date) {
      var items = byDate[date];
      var rel = relDay(date);
      return '<div class="daygroup">' +
        '<div class="dayhead"><span>' + fdate(date, true) + '</span>' +
        (rel ? '<span>· ' + rel + '</span>' : '') +
        '<span class="sum">' + money(sum(items)) + '</span></div>' +
        '<div class="items">' + items.map(itemHtml).join('') + '</div></div>';
    }).join('');
  }

  function itemHtml(x) {
    return '<div class="item" data-id="' + x.id + '">' +
      '<span class="dot"></span>' +
      '<div class="body"><div class="t">' + esc(x.title) + '</div>' +
      '<div class="m">' + esc(entityName(x.entityId)) + ' · ' + esc(categoryName(x.categoryId)) +
      (x.note ? ' · ' + esc(x.note) : '') + '</div></div>' +
      '<div class="a">' + money(x.amount) + '</div></div>';
  }

  $('listBody').addEventListener('click', function (e) {
    var it = e.target.closest('.item[data-id]');
    if (it) editExpense(it.dataset.id);
  });
  $('recentList').addEventListener('click', function (e) {
    var it = e.target.closest('.item[data-id]');
    if (it) editExpense(it.dataset.id);
  });

  $('qMoreBtn').onclick = function () { $('qMore').hidden = !$('qMore').hidden; };

  $('qSearch').addEventListener('input', function () { listF.q = this.value; renderList(); });
  $('qFromBtn').onclick = function () {
    openCalendar(listF.from, function (iso) { listF.from = iso; renderList(); });
  };
  $('qToBtn').onclick = function () {
    openCalendar(listF.to, function (iso) { listF.to = iso; renderList(); });
  };

  /* ---------------- آخرین ثبت‌ها ---------------- */

  function renderRecent() {
    var list = liveExpenses().sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    }).slice(0, 5);
    if (!list.length) {
      $('recentList').innerHTML = '<div class="empty"><div class="big">📋</div>' +
        'هنوز هزینه‌ای ثبت نشده. اولین هزینه را بالا وارد کنید.</div>';
      $('recentHint').textContent = '';
      return;
    }
    var t = Jalali.isoToJalali(Jalali.todayIso());
    var r = Jalali.monthRange(t.jy, t.jm);
    var monthTotal = sum(liveExpenses().filter(function (x) { return x.date >= r[0] && x.date <= r[1]; }));
    $('recentHint').textContent = Jalali.MONTHS[t.jm - 1] + ': ' + money(monthTotal) + ' ' + state.currency;
    $('recentList').innerHTML = '<div class="items">' + list.map(function (x) {
      return itemHtml(x).replace('<div class="m">', '<div class="m">' + fdate(x.date) + ' · ');
    }).join('') + '</div>';
  }

  /* ---------------- گزارش ---------------- */

  var repF = { period: 'this-month', from: Jalali.todayIso(), to: Jalali.todayIso() };

  function bars(rows, total) {
    if (!rows.length) return '<div class="empty">داده‌ای برای نمایش نیست.</div>';
    var max = rows[0].value || 1;
    return rows.map(function (r) {
      var pc = total ? Math.round(r.value * 1000 / total) / 10 : 0;
      return '<div class="bar"><div class="top"><span class="nm">' + esc(r.name) + '</span>' +
        '<span class="pc">' + faPercent(pc) + '٪</span>' +
        '<span class="vl">' + money(r.value) + '</span></div>' +
        '<div class="track"><div class="fill" style="width:' + (r.value * 100 / max) + '%"></div></div></div>';
    }).join('');
  }

  function groupBy(list, keyFn, nameFn) {
    var acc = {};
    list.forEach(function (x) {
      var k = keyFn(x);
      acc[k] = (acc[k] || 0) + (x.amount || 0);
    });
    return Object.keys(acc).map(function (k) {
      return { key: k, name: nameFn(k), value: acc[k] };
    }).sort(function (a, b) { return b.value - a.value; });
  }

  function renderReport() {
    renderSegmented($('rPeriod'), PERIODS, repF.period, function (v) {
      repF.period = v; renderReport();
    });
    $('rCustomRange').hidden = repF.period !== 'custom';
    $('rFromLabel').textContent = fdate(repF.from);
    $('rToLabel').textContent = fdate(repF.to);

    var list = applyFilter({
      q: '', period: repF.period, from: repF.from, to: repF.to,
      entityId: null, categoryId: null
    });
    var total = sum(list);

    $('rTotalLabel').textContent = periodLabel(repF.period, repF.from, repF.to);
    $('rTotal').innerHTML = money(total) + ' <small>' + esc(state.currency) + '</small>';
    $('rCount').textContent = toFa(list.length);
    $('rAvg').innerHTML = money(list.length ? total / list.length : 0) + ' <small>ت</small>';

    var byEntity = groupBy(list, function (x) { return x.entityId; }, entityName);
    var byCat = groupBy(list, function (x) { return x.categoryId || '_'; }, function (k) {
      return k === '_' ? 'بدون دسته' : categoryName(k);
    });
    var byMonth = groupBy(list, function (x) { return Jalali.monthKey(x.date); }, fmonth)
      .sort(function (a, b) { return a.key < b.key ? 1 : -1; });

    $('rTopEntity').textContent = byEntity.length ? byEntity[0].name : '—';
    $('rTopCat').textContent = byCat.length ? byCat[0].name : '—';

    $('rByEntity').innerHTML = bars(byEntity, total);
    $('rByCategory').innerHTML = bars(byCat, total);
    $('rByMonth').innerHTML = bars(byMonth.slice(0, 12), total);

    renderMatrix(list, byEntity, byCat);
  }

  function renderMatrix(list, byEntity, byCat) {
    if (!list.length) {
      $('rMatrix').innerHTML = '<tbody><tr><td>داده‌ای برای نمایش نیست.</td></tr></tbody>';
      return;
    }
    var cats = byCat.slice(0, 20);
    var cell = {};
    list.forEach(function (x) {
      var k = x.entityId + '|' + (x.categoryId || '_');
      cell[k] = (cell[k] || 0) + (x.amount || 0);
    });
    var h = '<thead><tr><th>موجودیت</th>';
    cats.forEach(function (c) { h += '<th class="num">' + esc(c.name) + '</th>'; });
    h += '<th class="num">جمع</th></tr></thead><tbody>';
    byEntity.forEach(function (e) {
      h += '<tr><td>' + esc(e.name) + '</td>';
      cats.forEach(function (c) {
        var v = cell[e.key + '|' + c.key] || 0;
        h += '<td class="num">' + (v ? money(v) : '—') + '</td>';
      });
      h += '<td class="num"><b>' + money(e.value) + '</b></td></tr>';
    });
    h += '</tbody><tfoot><tr><td>جمع</td>';
    cats.forEach(function (c) { h += '<td class="num">' + money(c.value) + '</td>'; });
    h += '<td class="num">' + money(sum(list)) + '</td></tr></tfoot>';
    $('rMatrix').innerHTML = h;
  }

  $('rFromBtn').onclick = function () {
    openCalendar(repF.from, function (iso) { repF.from = iso; renderReport(); });
  };
  $('rToBtn').onclick = function () {
    openCalendar(repF.to, function (iso) { repF.to = iso; renderReport(); });
  };

  /* ---------------- خروجی CSV و چاپ ---------------- */

  function downloadFile(name, content, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  $('rExportCsv').onclick = function () {
    var list = applyFilter({
      q: '', period: repF.period, from: repF.from, to: repF.to, entityId: null, categoryId: null
    });
    if (!list.length) { toast('در این دوره هزینه‌ای نیست'); return; }
    var rows = [['تاریخ شمسی', 'تاریخ میلادی', 'موضوع', 'مبلغ (' + state.currency + ')',
      'موجودیت', 'نوع', 'دسته‌بندی', 'توضیحات']];
    list.slice().reverse().forEach(function (x) {
      var e = entityById(x.entityId);
      rows.push([
        Jalali.format(x.date), x.date, x.title, x.amount,
        entityName(x.entityId), e ? ENTITY_TYPES[e.type] : '', categoryName(x.categoryId), x.note || ''
      ]);
    });
    rows.push([]);
    rows.push(['', '', 'جمع کل', sum(list), '', '', '', '']);
    var csv = '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    downloadFile('hazineha-' + Jalali.todayIso() + '.csv', csv, 'text/csv;charset=utf-8');
    toast('فایل CSV ساخته شد');
  };

  $('rPrint').onclick = function () {
    var list = applyFilter({
      q: '', period: repF.period, from: repF.from, to: repF.to, entityId: null, categoryId: null
    });
    if (!list.length) { toast('در این دوره هزینه‌ای نیست'); return; }
    var total = sum(list);
    var byEntity = groupBy(list, function (x) { return x.entityId; }, entityName);
    var byCat = groupBy(list, function (x) { return x.categoryId || '_'; }, function (k) {
      return k === '_' ? 'بدون دسته' : categoryName(k);
    });
    var h = '<h1>گزارش هزینه‌ها</h1><p>' + esc(periodLabel(repF.period, repF.from, repF.to)) +
      ' — ' + money(total) + ' ' + esc(state.currency) + '</p>';
    h += '<h2>تفکیک بر اساس موجودیت</h2><table><tr><th>مورد</th><th>مبلغ</th><th>سهم</th></tr>';
    byEntity.forEach(function (r) {
      h += '<tr><td>' + esc(r.name) + '</td><td>' + money(r.value) + '</td><td>' +
        toFa(Math.round(r.value * 100 / total)) + '٪</td></tr>';
    });
    h += '</table><h2>تفکیک بر اساس دسته‌بندی</h2><table><tr><th>دسته</th><th>مبلغ</th></tr>';
    byCat.forEach(function (r) {
      h += '<tr><td>' + esc(r.name) + '</td><td>' + money(r.value) + '</td></tr>';
    });
    h += '</table><h2>ریز هزینه‌ها</h2><table><tr><th>تاریخ</th><th>موضوع</th><th>موجودیت</th>' +
      '<th>دسته</th><th>مبلغ</th></tr>';
    list.slice().reverse().forEach(function (x) {
      h += '<tr><td>' + fdate(x.date) + '</td><td>' + esc(x.title) + '</td><td>' +
        esc(entityName(x.entityId)) + '</td><td>' + esc(categoryName(x.categoryId)) + '</td><td>' +
        money(x.amount) + '</td></tr>';
    });
    h += '<tr><th colspan="4">جمع کل</th><th>' + money(total) + '</th></tr></table>';

    var area = document.createElement('div');
    area.id = 'printArea';
    area.innerHTML = h;
    document.body.appendChild(area);
    document.body.classList.add('printing');
    window.print();
    setTimeout(function () {
      document.body.classList.remove('printing');
      area.remove();
    }, 500);
  };

  /* ---------------- تنظیمات ---------------- */

  function renderSettings() {
    var eh = '';
    TYPE_ORDER.forEach(function (type) {
      var list = state.entities.filter(function (e) { return e.type === type; });
      if (!list.length) return;
      list.forEach(function (e) {
        var used = liveExpenses().filter(function (x) { return x.entityId === e.id; });
        eh += '<div class="listrow">' +
          '<span class="nm"' + (e.active ? '' : ' style="opacity:.5"') + '>' + esc(e.name) + '</span>' +
          '<span class="tag">' + ENTITY_TYPES[e.type] + '</span>' +
          '<span class="tag">' + toFa(used.length) + ' هزینه</span>' +
          '<button class="iconbtn" data-act="rename-e" data-id="' + e.id + '" title="تغییر نام">✏️</button>' +
          '<button class="iconbtn" data-act="toggle-e" data-id="' + e.id + '" title="' +
          (e.active ? 'غیرفعال کردن' : 'فعال کردن') + '">' + (e.active ? '👁' : '🚫') + '</button>' +
          '<button class="iconbtn del" data-act="del-e" data-id="' + e.id + '" title="حذف">🗑</button>' +
          '</div>';
      });
    });
    $('setEntities').innerHTML = eh || '<div class="note">موردی ثبت نشده.</div>';

    var ch = state.categories.map(function (c) {
      var used = liveExpenses().filter(function (x) { return x.categoryId === c.id; });
      return '<div class="listrow"><span class="nm">' + esc(c.name) + '</span>' +
        '<span class="tag">' + toFa(used.length) + ' هزینه</span>' +
        '<button class="iconbtn" data-act="rename-c" data-id="' + c.id + '" title="تغییر نام">✏️</button>' +
        '<button class="iconbtn del" data-act="del-c" data-id="' + c.id + '" title="حذف">🗑</button></div>';
    }).join('');
    $('setCategories').innerHTML = ch || '<div class="note">دسته‌بندی‌ای ثبت نشده.</div>';

    var bytes = 0;
    try { bytes = new Blob([JSON.stringify(state)]).size; } catch (e) { bytes = 0; }
    $('storeInfo').innerHTML = 'در مجموع <b>' + toFa(liveExpenses().length) +
      '</b> هزینه ثبت شده است (حدود ' + toFa(Math.max(1, Math.round(bytes / 1024))) + ' کیلوبایت).';
  }

  $('setEntities').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var id = b.dataset.id, ent = entityById(id);
    if (!ent) return;
    if (b.dataset.act === 'rename-e') {
      var nn = prompt('نام جدید:', ent.name);
      if (nn && nn.trim()) { ent.name = nn.trim(); touchMeta(); save(); renderAll(); }
    } else if (b.dataset.act === 'toggle-e') {
      ent.active = !ent.active; touchMeta(); save(); renderAll();
      toast(ent.active ? 'فعال شد' : 'از فهرست ثبت پنهان شد');
    } else if (b.dataset.act === 'del-e') {
      var n = liveExpenses().filter(function (x) { return x.entityId === id; }).length;
      if (n) {
        toast('اول ' + toFa(n) + ' هزینه‌ی این مورد را حذف کنید یا آن را غیرفعال کنید');
        return;
      }
      askConfirm('حذف', '«' + ent.name + '» حذف شود؟', function () {
        state.entities = state.entities.filter(function (x) { return x.id !== id; });
        if (form.entityId === id) form.entityId = null;
        touchMeta(); save(); renderAll(); toast('حذف شد');
      });
    }
  });

  $('setCategories').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var id = b.dataset.id, cat = categoryById(id);
    if (!cat) return;
    if (b.dataset.act === 'rename-c') {
      var nn = prompt('نام جدید:', cat.name);
      if (nn && nn.trim()) { cat.name = nn.trim(); touchMeta(); save(); renderAll(); }
    } else if (b.dataset.act === 'del-c') {
      var n = liveExpenses().filter(function (x) { return x.categoryId === id; }).length;
      if (n) { toast('این دسته در ' + toFa(n) + ' هزینه استفاده شده است'); return; }
      askConfirm('حذف', '«' + cat.name + '» حذف شود؟', function () {
        state.categories = state.categories.filter(function (x) { return x.id !== id; });
        if (form.categoryId === id) form.categoryId = null;
        touchMeta(); save(); renderAll(); toast('حذف شد');
      });
    }
  });

  $('addEntity').onclick = function () {
    var name = $('newEntityName').value.trim();
    if (!name) { toast('نام را وارد کنید'); return; }
    state.entities.push({ id: uid(), name: name, type: $('newEntityType').value, active: true });
    $('newEntityName').value = '';
    touchMeta(); save(); renderAll(); toast('اضافه شد');
  };
  $('addCategory').onclick = function () {
    var name = $('newCategoryName').value.trim();
    if (!name) { toast('نام را وارد کنید'); return; }
    state.categories.push({ id: uid(), name: name });
    $('newCategoryName').value = '';
    touchMeta(); save(); renderAll(); toast('اضافه شد');
  };

  /* ---------------- پشتیبان‌گیری ---------------- */

  $('btnExport').onclick = function () {
    var data = JSON.stringify({ app: 'hesab', version: 1, exportedAt: new Date().toISOString(), state: state }, null, 1);
    downloadFile('poshtiban-hesab-' + Jalali.todayIso() + '.json', data, 'application/json');
    toast('فایل پشتیبان ساخته شد');
  };

  $('btnImport').onclick = function () { $('importFile').click(); };

  $('importFile').onchange = function () {
    var file = this.files && this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var incoming;
      try {
        var obj = JSON.parse(reader.result);
        incoming = obj && obj.state ? obj.state : obj;
        if (!incoming || !Array.isArray(incoming.expenses) || !Array.isArray(incoming.entities)) {
          throw new Error('ساختار نامعتبر');
        }
      } catch (err) {
        toast('فایل معتبر نیست');
        return;
      }
      askConfirm('بازیابی اطلاعات',
        'اطلاعات فعلی (' + toFa(liveExpenses().length) + ' هزینه) با اطلاعات فایل (' +
        toFa(incoming.expenses.filter(function (x) { return !x.deleted; }).length) +
        ' هزینه) جایگزین می‌شود. ادامه می‌دهید؟',
        function () {
          state = migrate(incoming);
          if (!Array.isArray(state.categories)) state.categories = defaultState().categories;
          if (!state.currency) state.currency = 'تومان';
          state.entities.forEach(function (e) { if (e.active === undefined) e.active = true; });
          state.metaUpdatedAt = Date.now();
          state.expenses.forEach(function (x) { x.syncedAt = 0; });
          save();
          resetForm(false);
          renderAll();
          toast('اطلاعات بازیابی شد');
        });
    };
    reader.readAsText(file);
    this.value = '';
  };

  $('btnWipe').onclick = function () {
    askConfirm('پاک کردن همه هزینه‌ها',
      'همه‌ی ' + toFa(liveExpenses().length) + ' هزینه حذف می‌شود. ' +
      'مرغداری‌ها، اشخاص و دسته‌بندی‌ها باقی می‌مانند. ' +
      'اگر پشتیبان نگرفته‌اید اول پشتیبان بگیرید!',
      function () {
        var t = Date.now();
        state.expenses.forEach(function (x) { x.deleted = true; x.updatedAt = t; });
        save(); resetForm(false); renderAll(); toast('همه هزینه‌ها پاک شد');
      });
  };

  /* ---------------- تب‌ها ---------------- */

  var currentTab = 'add';
  function go(tab) {
    currentTab = tab;
    ['add', 'list', 'report', 'settings'].forEach(function (t) {
      $('page-' + t).classList.toggle('on', t === tab);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tabbar button'), function (b) {
      b.classList.toggle('on', b.dataset.tab === tab);
    });
    $('fab').hidden = (tab === 'add');
    if (tab === 'list') renderList();
    if (tab === 'report') renderReport();
    if (tab === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }
  document.querySelector('.tabbar').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (b) go(b.dataset.tab);
  });
  $('fab').onclick = function () { resetForm(false); go('add'); $('fAmount').focus(); };

  window.addEventListener('scroll', function () {
    $('topbar').classList.toggle('scrolled', window.scrollY > 4);
  }, { passive: true });

  /* ---------------- راه‌اندازی ---------------- */

  function renderAll() {
    renderForm();
    renderRecent();
    if (currentTab === 'list') renderList();
    if (currentTab === 'report') renderReport();
    if (currentTab === 'settings') renderSettings();
    var t = Jalali.isoToJalali(Jalali.todayIso());
    $('topSub').textContent = 'امروز ' + toFa(t.jd) + ' ' + Jalali.MONTHS[t.jm - 1] + ' ' + toFa(t.jy);
  }

  state = load();
  $('appVersion').textContent = toFa(APP_VERSION).replace('.', '٫');
  renderAll();
  go('add');

  /* ---------------- همگام‌سازی بین دستگاه‌ها ---------------- */

  function syncFields(r) {
    return {
      amount: Math.round(Number(r.amount) || 0),
      title: r.title || '',
      entityId: r.entityId || null,
      categoryId: r.categoryId || null,
      date: r.date || Jalali.todayIso(),
      note: r.note || '',
      createdAt: Number(r.createdAt) || Number(r.updatedAt) || Date.now(),
      updatedAt: Number(r.updatedAt) || 0,
      deleted: !!r.deleted,
      syncedAt: Number(r.updatedAt) || 0
    };
  }

  function bindSync() {
    if (!window.Sync) return;

    Sync.bind({
      /* رکوردهایی که هنوز روی سرور ثبت نشده‌اند */
      getDirty: function () {
        return state.expenses.filter(function (x) {
          return !x.syncedAt || x.updatedAt > x.syncedAt;
        });
      },
      markSynced: function (ids, stamp) {
        var set = {};
        ids.forEach(function (i) { set[i] = 1; });
        state.expenses.forEach(function (x) {
          if (set[x.id]) x.syncedAt = Math.max(Number(x.updatedAt) || 0, stamp);
        });
        save(true);
      },
      /* ادغام رکوردهای سرور با محلی — تازه‌ترین نسخه برنده است */
      mergeRemote: function (remote) {
        var byId = {}, changed = 0;
        state.expenses.forEach(function (x) { byId[x.id] = x; });
        remote.forEach(function (r) {
          var local = byId[r.id];
          var f = syncFields(r);
          if (!local) {
            f.id = r.id;
            state.expenses.push(f);
            byId[r.id] = f;
            changed++;
          } else if (f.updatedAt > (Number(local.updatedAt) || 0)) {
            Object.keys(f).forEach(function (k) { local[k] = f[k]; });
            changed++;
          } else if (f.updatedAt === (Number(local.updatedAt) || 0) && !local.syncedAt) {
            local.syncedAt = f.updatedAt;
          }
        });
        if (changed) save(true);
        return changed;
      },
      getMeta: function () {
        return {
          entities: state.entities,
          categories: state.categories,
          updatedAt: Number(state.metaUpdatedAt) || 0
        };
      },
      setMeta: function (key, items, updatedAt) {
        state[key] = items;
        state.metaUpdatedAt = updatedAt;
        save(true);
      },
      afterSync: function (info) {
        renderAll();
        if (info.pulled) {
          toast(toFa(info.pulled) + ' مورد از دستگاه‌های دیگر دریافت شد');
        }
      }
    });

    Sync.onStatus(renderSyncStatus);
    Sync.start();
  }

  var SYNC_LABELS = {
    off: 'خاموش',
    idle: 'روشن',
    syncing: 'در حال همگام‌سازی…',
    offline: 'بدون اینترنت',
    error: 'خطا'
  };

  function renderSyncStatus(s) {
    var badge = $('syncStatus');
    if (!badge) return;
    badge.textContent = SYNC_LABELS[s.state] || s.state;
    badge.style.color = s.state === 'error' ? 'var(--danger)'
      : (s.state === 'idle' ? 'var(--brand)' : 'var(--muted)');

    var on = window.Sync && Sync.isOn();
    $('syncOff').hidden = on || !$('syncForm').hidden;
    $('syncOn').hidden = !on;
    if (on) {
      var cfg = Sync.getConfig();
      $('syncBookShow').value = cfg.book;
      var note = '';
      if (s.state === 'error') note = 'مشکل: ' + s.message;
      else if (s.state === 'offline') note = 'وقتی اینترنت وصل شود، خودکار همگام می‌شود.';
      else if (s.lastAt) note = 'آخرین همگام‌سازی: ' + clockFa(s.lastAt);
      else note = 'در انتظار اولین همگام‌سازی…';
      $('syncNote').textContent = note;
    }
  }

  function clockFa(ms) {
    var d = new Date(ms);
    return toFa(Jalali.pad2(d.getHours()) + ':' + Jalali.pad2(d.getMinutes()));
  }

  function showSyncForm(show) {
    $('syncForm').hidden = !show;
    $('syncOff').hidden = show || (window.Sync && Sync.isOn());
    if (show) {
      var cfg = (window.Sync && Sync.getConfig()) || {};
      $('syncApiKey').value = cfg.apiKey || '';
      $('syncProjectId').value = cfg.projectId || '';
      $('syncBook').value = cfg.book || '';
    }
  }

  if ($('syncSetupBtn')) {
    $('syncSetupBtn').onclick = function () { showSyncForm(true); };
    $('syncCancel').onclick = function () { showSyncForm(false); };
    $('syncNewCode').onclick = function () {
      $('syncBook').value = Sync.newCode();
      toast('کد ساخته شد — آن را جایی یادداشت کنید');
    };
    $('syncSave').onclick = function () {
      var apiKey = $('syncApiKey').value.trim();
      var projectId = $('syncProjectId').value.trim();
      var book = Sync.normalizeCode($('syncBook').value);
      if (!apiKey) { toast('کلید API را وارد کنید'); return; }
      if (!projectId) { toast('شناسه پروژه را وارد کنید'); return; }
      if (book.replace(/-/g, '').length < 24) {
        toast('کد خانواده باید حداقل ۲۴ حرف باشد — «ساخت کد جدید» را بزنید');
        return;
      }
      /* هزینه‌های موجود باید یک‌بار به سرور بروند */
      state.expenses.forEach(function (x) { x.syncedAt = 0; });
      save(true);
      Sync.setConfig({ apiKey: apiKey, projectId: projectId, book: book });
      showSyncForm(false);
      renderSyncStatus(Sync.status());
      toast('همگام‌سازی روشن شد');
    };
    $('syncCopy').onclick = function () {
      var el = $('syncBookShow');
      el.select();
      var done = false;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(el.value);
        done = true;
      } else {
        try { done = document.execCommand('copy'); } catch (e) { done = false; }
      }
      toast(done ? 'کد کپی شد' : 'کد را دستی بردارید');
    };
    $('syncNow').onclick = function () {
      toast('در حال همگام‌سازی…');
      Sync.syncNow({ full: true });
    };
    $('syncOffBtn').onclick = function () {
      askConfirm('خاموش کردن همگام‌سازی',
        'اطلاعات روی این دستگاه می‌ماند، ولی دیگر با دستگاه‌های دیگر همگام نمی‌شود. ادامه می‌دهید؟',
        function () {
          Sync.setConfig(null);
          showSyncForm(false);
          renderSyncStatus(Sync.status());
          toast('همگام‌سازی خاموش شد');
        });
    };
  }

  bindSync();

  /* نصب برنامه */
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    $('btnInstall').hidden = false;
  });
  $('btnInstall').onclick = function () {
    if (!deferredPrompt) { toast('از منوی مرورگر گزینه نصب را بزنید'); return; }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () {
      deferredPrompt = null;
      $('btnInstall').hidden = true;
    });
  };

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (e) {
        console.warn('service worker ثبت نشد', e);
      });
    });
  }

  /* برای دیباگ دستی */
  window.__hesab = {
    get state() { return state; },
    save: save,
    reset: function () { state = defaultState(); save(); renderAll(); }
  };
})();
