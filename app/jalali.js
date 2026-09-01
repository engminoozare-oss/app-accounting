/* تبدیل تاریخ میلادی و شمسی (بر پایه الگوریتم جلالی) */
(function (global) {
  'use strict';

  var breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
    1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

  function div(a, b) { return ~~(a / b); }
  function mod(a, b) { return a - ~~(a / b) * b; }

  function jalCal(jy) {
    var bl = breaks.length, gy = jy + 621, leapJ = -14, jp = breaks[0],
      jm, jump, leap, n, i;
    if (jy < jp || jy >= breaks[bl - 1]) throw new Error('سال خارج از محدوده: ' + jy);
    for (i = 1; i < bl; i += 1) {
      jm = breaks[i];
      jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    var leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    var march = 20 + leapJ - leapG;
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
    return { leap: leap, gy: gy, march: march };
  }

  function jalToJd(jy, jm, jd) {
    var r = jalCal(jy);
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  }

  function jdToJal(jdn) {
    var gy = d2g(jdn).gy, jy = gy - 621, r = jalCal(jy), jdn1f = g2d(gy, 3, r.march),
      jd, jm, k;
    k = jdn - jdn1f;
    if (k >= 0) {
      if (k <= 185) {
        jm = 1 + div(k, 31);
        jd = mod(k, 31) + 1;
        return { jy: jy, jm: jm, jd: jd };
      } else { k -= 186; }
    } else {
      jy -= 1;
      k += 179;
      if (r.leap === 1) k += 1;
    }
    jm = 7 + div(k, 30);
    jd = mod(k, 30) + 1;
    return { jy: jy, jm: jm, jd: jd };
  }

  function g2d(gy, gm, gd) {
    var d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
      + div(153 * mod(gm + 9, 12) + 2, 5)
      + gd - 34840408;
    d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
    return d;
  }

  function d2g(jdn) {
    var j, i, gd, gm, gy;
    j = 4 * jdn + 139361631;
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    i = div(mod(j, 1461), 4) * 5 + 308;
    gd = div(mod(i, 153), 5) + 1;
    gm = mod(div(i, 153), 12) + 1;
    gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return { gy: gy, gm: gm, gd: gd };
  }

  var JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  var WEEK_DAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
  var WEEK_DAYS_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

  /* «YYYY-MM-DD» میلادی  ->  {jy,jm,jd} */
  function isoToJalali(iso) {
    var p = iso.split('-').map(Number);
    return jdToJal(g2d(p[0], p[1], p[2]));
  }

  /* {jy,jm,jd}  ->  «YYYY-MM-DD» میلادی */
  function jalaliToIso(jy, jm, jd) {
    var g = d2g(jalToJd(jy, jm, jd));
    return g.gy + '-' + pad2(g.gm) + '-' + pad2(g.gd);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* تعداد روزهای یک ماه شمسی */
  function jalaliMonthLength(jy, jm) {
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    return jalCal(jy).leap === 0 ? 30 : 29;
  }

  /* شماره روز هفته (۰ = شنبه) برای یک تاریخ شمسی */
  function jalaliWeekDay(jy, jm, jd) {
    var iso = jalaliToIso(jy, jm, jd);
    var p = iso.split('-').map(Number);
    var g = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return (g.getUTCDay() + 1) % 7; // یکشنبه‌ی میلادی = ۱ در تقویم ما
  }

  /* «۱۴۰۳/۰۵/۱۲» از روی تاریخ میلادی */
  function formatIso(iso, opts) {
    var j = isoToJalali(iso);
    if (opts && opts.long) {
      return j.jd + ' ' + JALALI_MONTHS[j.jm - 1] + ' ' + j.jy;
    }
    return j.jy + '/' + pad2(j.jm) + '/' + pad2(j.jd);
  }

  /* کلید ماه شمسی مثل «۱۴۰۳-۰۵» برای گروه‌بندی */
  function jalaliMonthKey(iso) {
    var j = isoToJalali(iso);
    return j.jy + '-' + pad2(j.jm);
  }

  function jalaliMonthLabel(key) {
    var p = key.split('-');
    return JALALI_MONTHS[Number(p[1]) - 1] + ' ' + p[0];
  }

  /* بازه‌ی میلادی یک ماه شمسی: [شروع، پایان] */
  function jalaliMonthRange(jy, jm) {
    return [jalaliToIso(jy, jm, 1), jalaliToIso(jy, jm, jalaliMonthLength(jy, jm))];
  }

  global.Jalali = {
    isoToJalali: isoToJalali,
    jalaliToIso: jalaliToIso,
    todayIso: todayIso,
    monthLength: jalaliMonthLength,
    weekDay: jalaliWeekDay,
    format: formatIso,
    monthKey: jalaliMonthKey,
    monthLabel: jalaliMonthLabel,
    monthRange: jalaliMonthRange,
    MONTHS: JALALI_MONTHS,
    WEEK_DAYS: WEEK_DAYS,
    WEEK_DAYS_SHORT: WEEK_DAYS_SHORT,
    pad2: pad2
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
