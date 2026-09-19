/* ============================================================================
 * 校园机会雷达 · 应用逻辑
 * ----------------------------------------------------------------------------
 * 三块核心：
 *   1. 状态机  —— 以「现在」为基准推算每条信息当前处于什么状态（今天/将截止/已截止/待回放…）
 *   2. 合并    —— 把补充通知挂到主信息上，列表里一件事只出现一次
 *   3. 完整度  —— 用实际字段算出信息完整度，来源质量差异一眼可见
 * ========================================================================== */
(function () {
  'use strict';

  /* ========================= 常量与工具 ========================= */

  var WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  var LS = {
    fav: 'cr_favs',
    join: 'cr_joins',
    posts: 'cr_posts',
    base: 'cr_timebase',
    fb: 'cr_feedback',
    users: 'cr_users',
    session: 'cr_session',
    signups: 'cr_signups'
  };

  /* 元数据；data.js 没加载时兜底，避免整页崩掉 */
  var CATS = (typeof window !== 'undefined' && window.CATEGORY_META) || {};
  var CAT_ORDER = (typeof window !== 'undefined' && window.CATEGORY_ORDER) || [];
  var SOURCES = (typeof window !== 'undefined' && window.SOURCE_META) || {};
  var SOURCE_ORDER = (typeof window !== 'undefined' && window.SOURCE_ORDER) || [];
  var COLLEGES = (typeof window !== 'undefined' && window.COLLEGES) || [];
  var SOURCE_UNKNOWN = 'unknown';

  /* 内容审核（js/moderation.js）；没加载时降级为"全部放行"，不影响主流程 */
  var checkFields = (typeof window !== 'undefined' && window.checkFields) ||
    function () { return { ok: true, hits: [] }; };

  /* ---- 时间基准 ----
   * 演示数据的时间背景是 2026 年 9 月 16 日。首次打开默认锁在这天，
   * 保证每个人看到的演示效果一致；设置里可以随时切回真实时间。
   * 存 "real" 表示用真实时间，存 ISO 字符串表示锁定在某天。
   * 这个值同时决定了「今天」是哪天、哪些活动正在进行、倒计时剩多久。 */
  var DEFAULT_BASE = (typeof window !== 'undefined' && window.DEFAULT_TIMEBASE) || '2026-09-16T09:00:00';
  var REAL = 'real';

  function initialTimebase() {
    var v = readLS(LS.base, null);
    if (v === null || v === undefined || v === '') return DEFAULT_BASE;
    return v;
  }

  function isRealTime() { return !state.timebase || state.timebase === REAL; }
  var WINDOWS = (typeof window !== 'undefined' && window.DEADLINE_WINDOWS) || { urgentDays: 3, soonDays: 7 };

  function readLS(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function writeLS(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ========================= 本地账号 =========================
   * 作品是纯静态页面，没有服务端，所以这**不是真实认证**：
   * 账号只存在这台设备的浏览器里，换设备、换浏览器、清缓存就没了。
   * 它的作用是让「谁发布的」有个归属，并挡住同设备上的随手冒名。
   * 密码不存明文，存的是 每个账号独立随机盐 + SHA-256。
   * ========================================================== */

  function currentUser() {
    var s = readLS(LS.session, null);
    return s && typeof s === 'object' ? s : null;
  }

  function randomSalt() {
    var a = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(a, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }

  /* 优先用 SubtleCrypto 的 SHA-256；不可用（file:// 或老浏览器）时退回一个
     非加密散列，只为了避免明文落盘，安全性由上面的说明兜底。 */
  function hashPassword(pass, salt) {
    var input = salt + '::' + pass;
    if (window.crypto && crypto.subtle && crypto.subtle.digest && window.TextEncoder) {
      return crypto.subtle
        .digest('SHA-256', new TextEncoder().encode(input))
        .then(function (buf) {
          return Array.prototype.map.call(new Uint8Array(buf), function (b) {
            return ('0' + b.toString(16)).slice(-2);
          }).join('');
        })
        .catch(function () { return weakHash(input); });
    }
    return Promise.resolve(weakHash(input));
  }

  function weakHash(str) {
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h1 = ((h1 ^ c) * 16777619) >>> 0;
      h2 = ((h2 + c) * 2654435761) >>> 0;
    }
    return 'w' + h1.toString(16) + h2.toString(16);
  }

  function findUser(name) {
    var users = readLS(LS.users, {});
    var key = String(name || '').trim().toLowerCase();
    return users[key] || null;
  }

  /* 账号资料（身份、单位）跟着会话走，发布时要用 */
  function sessionOf(u) {
    return { name: u.name, role: u.role || 'student', org: u.org || '', sid: u.sid || '',
             at: new Date().toISOString() };
  }

  function registerUser(name, pass, profile) {
    var key = String(name || '').trim().toLowerCase();
    var users = readLS(LS.users, {});
    var salt = randomSalt();
    profile = profile || {};
    return hashPassword(pass, salt).then(function (hash) {
      users[key] = {
        name: String(name).trim(), salt: salt, hash: hash,
        role: profile.role || 'student', org: profile.org || '', sid: profile.sid || '',
        createdAt: new Date().toISOString()
      };
      writeLS(LS.users, users);
      writeLS(LS.session, sessionOf(users[key]));
      return users[key];
    });
  }

  function loginUser(name, pass) {
    var u = findUser(name);
    if (!u) return Promise.resolve({ ok: false, msg: '没有找到这个账号，先注册一个吧' });
    return hashPassword(pass, u.salt).then(function (hash) {
      if (hash !== u.hash) return { ok: false, msg: '密码不对' };
      writeLS(LS.session, sessionOf(u));
      return { ok: true, user: u };
    });
  }

  /* ========================= 报名 =========================
   * 结构：{ [活动id]: [ {id, name, phone, org, account, at} ] }
   * 发布者在「我的」和自己的活动详情里可以看到报名名单（含手机号）。
   * 注意：和账号一样存在本机浏览器里，跨设备不会同步。
   * ====================================================== */

  function signupsOf(itemId) {
    var all = readLS(LS.signups, {});
    return all[itemId] || [];
  }

  function setSignups(itemId, arr) {
    var all = readLS(LS.signups, {});
    if (arr.length) all[itemId] = arr; else delete all[itemId];
    writeLS(LS.signups, all);
  }

  function regCount(itemId) { return signupsOf(itemId).length; }

  function addSignup(itemId, rec) {
    var arr = signupsOf(itemId);
    arr.push(rec);
    setSignups(itemId, arr);
  }

  function mySignup(itemId) {
    var me = currentUser();
    if (!me) return null;
    return signupsOf(itemId).filter(function (s) { return s.account === me.name; })[0] || null;
  }

  function removeMySignup(itemId) {
    var me = currentUser();
    if (!me) return;
    setSignups(itemId, signupsOf(itemId).filter(function (s) { return s.account !== me.name; }));
  }

  /* 中国大陆手机号 */
  function validPhone(p) { return /^1[3-9]\d{9}$/.test(String(p || '').trim()); }

  /* 报名区块：发布者看到名单，其他人看到报名表单 */
  function signupSection(item) {
    if (!item.userPost) return '';
    if (item.needSignup === false) return '';

    var me = currentUser();
    var regs = signupsOf(item.id);
    var mine = mySignup(item.id);
    var owner = isMine(item);
    var h = '';

    h += '<section class="sec sec--signup">';
    h += '<h3>📝 报名' + (regs.length ? '（' + regs.length + ' 人）' : '') + '</h3>';

    if (owner) {
      /* 发布者视角：看得到报名同学的姓名和手机号 */
      h += '<p class="sec__desc">这是你发布的内容。下面是同学的报名信息，只有你（发布者）能看到。</p>';
      if (!regs.length) {
        h += '<p class="signupEmpty">还没有人报名。把这条分享到群里，同学点「我要报名」就会出现在这里。</p>';
      } else {
        h += '<div class="regList">' + regs.map(function (s, i) {
          return '<div class="regRow">' +
            '<span class="regRow__no">' + (i + 1) + '</span>' +
            '<div class="regRow__body">' +
              '<div class="regRow__name">' + esc(s.name) +
                (s.org ? '<span class="regRow__org">' + esc(s.org) + '</span>' : '') + '</div>' +
              '<a class="regRow__tel" href="tel:' + esc(s.phone) + '">' + esc(s.phone) + '</a>' +
              '<span class="regRow__at">' + esc(relTimeShort(s.at)) + ' 报名</span>' +
            '</div>' +
            '<button type="button" class="mini mini--danger" data-delreg="' +
              esc(item.id) + ':' + esc(s.id) + '">移除</button>' +
          '</div>';
        }).join('') + '</div>';
        h += '<button type="button" class="btn btn--ghost btn--wide" data-copyregs="' + esc(item.id) + '">' +
          '📋 复制报名名单</button>';
      }
    } else if (mine) {
      h += '<div class="signedBox">' +
        '<b>✅ 你已经报过名了</b>' +
        '<p>姓名 ' + esc(mine.name) + ' · 手机 ' + esc(mine.phone) + '</p>' +
        '<p class="tbd">报名信息已提交给发布者</p>' +
        '</div>' +
        '<button type="button" class="btn btn--ghost btn--wide" data-unsignup="' + esc(item.id) + '">取消报名</button>';
    } else if (!me) {
      h += '<p class="sec__desc">报名需要先登录，这样发布者才知道是谁报的名、怎么联系你。</p>' +
        '<button type="button" class="btn btn--primary btn--wide" data-auth="open">登录后报名</button>';
    } else {
      h += '<form class="signupForm" id="signupForm" data-item="' + esc(item.id) + '">' +
        '<div class="fld fld--2col">' +
          '<label class="fld"><span>姓名 <b>*</b></span>' +
            '<input name="sname" required maxlength="20" value="' + esc(me.name) + '"></label>' +
          '<label class="fld"><span>手机号 <b>*</b></span>' +
            '<input name="sphone" required inputmode="numeric" maxlength="11" placeholder="11 位手机号"></label>' +
        '</div>' +
        '<label class="fld"><span>学院 / 班级（选填）</span>' +
          '<input name="sorg" maxlength="30" value="' + esc(me.org || '') + '"></label>' +
        '<p class="sec__desc sec__desc--tip">手机号只提供给发布者，用于联系你，不会公开显示。</p>' +
        '<div class="signupNote" id="signupNote"></div>' +
        '<button type="submit" class="btn btn--primary btn--wide">提交报名</button>' +
      '</form>';
    }

    h += '</section>';
    return h;
  }

  /* 「我的」页面里，每条我发布的内容下面挂一块报名名单 */
  function regPanel(item) {
    if (item.needSignup === false) return '';
    var regs = signupsOf(item.id);

    if (!regs.length) {
      return '<div class="regPanel regPanel--empty">' +
        '📝 还没有人报名 · 同学在活动详情里可以填姓名和手机号报名</div>';
    }

    return '<div class="regPanel">' +
      '<div class="regPanel__head">📝 <b>' + regs.length + ' 人报名</b>' +
        '<button type="button" class="mini" data-copyregs="' + esc(item.id) + '">复制名单</button>' +
      '</div>' +
      '<div class="regList">' + regs.map(function (s, i) {
        return '<div class="regRow">' +
          '<span class="regRow__no">' + (i + 1) + '</span>' +
          '<div class="regRow__body">' +
            '<div class="regRow__name">' + esc(s.name) +
              (s.org ? '<span class="regRow__org">' + esc(s.org) + '</span>' : '') + '</div>' +
            '<a class="regRow__tel" href="tel:' + esc(s.phone) + '">' + esc(s.phone) + '</a>' +
            '<span class="regRow__at">' + esc(relTimeShort(s.at)) + ' 报名</span>' +
          '</div>' +
          '<button type="button" class="mini mini--danger" data-delreg="' +
            esc(item.id) + ':' + esc(s.id) + '">移除</button>' +
        '</div>';
      }).join('') + '</div>' +
    '</div>';
  }

  /* 「3 分钟前」这种短格式，用于报名时间 */
  function relTimeShort(iso) {
    if (!iso) return '';
    var diff = currentTime().getTime() - new Date(iso).getTime();
    var mins = Math.round(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return mins + ' 分钟前';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + ' 小时前';
    return Math.round(hrs / 24) + ' 天前';
  }

  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function sameDay(a, b) { return startOfDay(a).getTime() === startOfDay(b).getTime(); }
  function dayDiff(a, b) { return Math.round((startOfDay(a) - startOfDay(b)) / 86400000); }

  function fmtTime(d) {
    if (!d) return '';
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /* 「9月21日(周一) 19:30」这种人类读得懂的格式 */
  function fmtDateTime(iso, opts) {
    opts = opts || {};
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var now = currentTime();
    var dd = dayDiff(d, now);
    var head, tail = '';
    if (dd === 0) head = '今天';                       /* 今天不用再报星期几 */
    else if (dd === 1) { head = '明天'; tail = '(' + WD[d.getDay()] + ')'; }
    else if (dd === 2) { head = '后天'; tail = '(' + WD[d.getDay()] + ')'; }
    else if (dd === -1) { head = '昨天'; tail = '(' + WD[d.getDay()] + ')'; }
    else { head = (d.getMonth() + 1) + '月' + d.getDate() + '日'; tail = '(' + WD[d.getDay()] + ')'; }
    var t = opts.dateOnly ? '' : ' ' + fmtTime(d);
    return head + tail + t;
  }

  function fmtMonthDay(iso) {
    var d = new Date(iso);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  /* 相对时间：「还有 21 小时」「已过去 2 天」 */
  function relative(iso) {
    var now = currentTime();
    var d = new Date(iso);
    var diff = d - now;
    var abs = Math.abs(diff);
    var mins = Math.round(abs / 60000);
    var s;
    if (mins < 60) s = mins + ' 分钟';
    else if (mins < 60 * 48) s = Math.round(mins / 60) + ' 小时';
    else s = Math.round(mins / 1440) + ' 天';
    return diff >= 0 ? '还有 ' + s : '已过 ' + s;
  }

  /* ========================= 时间基准 ========================= */

  function currentTime() {
    if (isRealTime()) return new Date();
    return new Date(state.timebase);
  }

  /* ========================= 状态机 ========================= */
  /*
   * 返回 { key, label, tone, tier, deadline }
   * tier 越小越靠前，列表默认按 tier 排序。
   */
  function statusOf(item, now) {
    now = now || currentTime();
    var ms = now.getTime();

    var dls = (item.deadlines || []).filter(function (d) { return d.at; })
      .map(function (d) { return { d: d, t: new Date(d.at).getTime() }; })
      .sort(function (a, b) { return a.t - b.t; });

    var nextDl = dls.filter(function (x) { return x.t > ms; })[0] || null;
    var hasPassedDl = dls.some(function (x) { return x.t <= ms; });
    var allPassed = dls.length > 0 && !nextDl;

    /* ---- 活动本身的时间 ---- */
    var events = (item.schedule || []).filter(function (s) { return s.at; })
      .map(function (s) {
        var st = new Date(s.at).getTime();
        var en = s.endAt ? new Date(s.endAt).getTime()
          : st + (item.duration ? item.duration * 60000 : 3600000);
        return { s: s, st: st, en: en };
      });

    var live = events.filter(function (e) { return ms >= e.st && ms <= e.en; })[0];
    var todayStart = events.filter(function (e) { return sameDay(new Date(e.st), now); })[0];
    var nextStart = events.filter(function (e) { return e.st > ms; })
      .sort(function (a, b) { return a.st - b.st; })[0];
    var allEnded = events.length > 0 && events.every(function (e) { return e.en < ms; });

    /* ---- 优先级判断 ---- */
    if (live) {
      return { key: 'live', label: '正在进行', tone: 'live', tier: 0, deadline: nextDl };
    }
    if (todayStart) {
      var label = todayStart.st > ms
        ? '今天 ' + fmtTime(new Date(todayStart.st)) + ' 开始'
        : '今天已开始';
      return { key: 'today', label: label, tone: 'live', tier: 1, deadline: nextDl };
    }

    /* 报名截止相关 */
    if (nextDl) {
      var left = nextDl.t - ms;
      if (left <= 48 * 3600000) {
        return {
          key: 'closing',
          label: (nextDl.d.label || '报名') + ' ' + relative(nextDl.d.at),
          tone: 'urgent', tier: 2, deadline: nextDl
        };
      }
      return {
        key: 'open',
        label: (nextDl.d.label || '报名') + ' ' + relative(nextDl.d.at),
        tone: 'open', tier: 4, deadline: nextDl
      };
    }

    if (allPassed && item.standby) {
      return { key: 'standby', label: '报名已截止 · 可候补', tone: 'warn', tier: 3, deadline: null };
    }
    if (allPassed && !allEnded) {
      return { key: 'expired', label: '报名已截止', tone: 'mute', tier: 6, deadline: null };
    }
    if (allEnded) {
      if (item.replay) {
        return { key: 'replay', label: '已结束 · 回放待上传', tone: 'replay', tier: 5, deadline: null };
      }
      return { key: 'ended', label: '已结束', tone: 'mute', tier: 8, deadline: null };
    }
    if (hasPassedDl && nextDl === null && !item.standby) {
      return { key: 'expired', label: '报名已截止', tone: 'mute', tier: 6, deadline: null };
    }
    if (nextStart) {
      return {
        key: 'upcoming', label: fmtDateTime(nextStart.s.at), tone: 'open', tier: 4, deadline: null
      };
    }
    return { key: 'ongoing', label: '长期开放', tone: 'green', tier: 7, deadline: null };
  }

  /* 按"现在该先看哪个"排序：状态优先级 → 最近的时间点 */
  function byUrgency(now) {
    return function (a, b) {
      var sa = statusOf(a, now), sb = statusOf(b, now);
      if (sa.tier !== sb.tier) return sa.tier - sb.tier;
      var ta = sa.deadline ? sa.deadline.t : (nextEventTime(a) || Infinity);
      var tb = sb.deadline ? sb.deadline.t : (nextEventTime(b) || Infinity);
      return ta - tb;
    };
  }

  /* ========================= 截止倒计时 =========================
   * 把「最近要截止的事」单独拎出来，按今天的日期算还剩多久。
   * 窗口：≤3 天算紧急，3—7 天算近期。已经过期的截止时间不进来。
   * 只统计传进来的列表，所以它会跟着当前的筛选条件走，不会和下面的列表打架。
   * ============================================================ */

  function deadlineBuckets(list, now) {
    now = now || currentTime();
    var ms = now.getTime();
    var urgentMs = WINDOWS.urgentDays * 86400000;
    var soonMs = WINDOWS.soonDays * 86400000;
    var urgent = [], soon = [];

    (list || []).forEach(function (it) {
      (it.deadlines || []).forEach(function (d) {
        if (!d.at) return;                 /* 通知没给具体时间的，不进倒计时 */
        var t = new Date(d.at).getTime();
        if (isNaN(t) || t <= ms) return;   /* 已经过去的不要 */
        var left = t - ms;
        var entry = { item: it, dl: d, t: t, left: left };
        if (left <= urgentMs) urgent.push(entry);
        else if (left <= soonMs) soon.push(entry);
      });
    });

    var byTime = function (a, b) { return a.t - b.t; };
    urgent.sort(byTime);
    soon.sort(byTime);
    return { urgent: urgent, soon: soon };
  }

  /* 「还有 22 小时」——按剩余时长选最合适的单位 */
  function countdownText(msLeft) {
    var hours = msLeft / 3600000;
    if (hours < 1) return Math.max(1, Math.round(msLeft / 60000)) + ' 分钟';
    if (hours < 48) return Math.round(hours) + ' 小时';
    return Math.round(hours / 24) + ' 天';
  }

  /* 剩余越少，色越重 */
  function urgencyTone(msLeft) {
    var hours = msLeft / 3600000;
    if (hours <= 24) return 'now';
    if (hours <= 72) return 'soon';
    return 'later';
  }

  function cdRow(e) {
    var it = e.item;
    var cat = CATS[it.category] || {};
    var dlText = e.dl.precision === 'day'
      ? fmtMonthDay(e.dl.at) + '（未注明具体时间）'
      : fmtDateTime(e.dl.at);
    return '<button class="cdrow" data-open="' + esc(it.id) + '">' +
      '<span class="cdrow__cat cdrow__cat--' + esc(cat.color || 'gray') + '">' + esc(cat.code || '·') + '</span>' +
      '<span class="cdrow__body">' +
        '<span class="cdrow__title">' + esc(it.title) + '</span>' +
        '<span class="cdrow__label">' + esc(e.dl.label || '截止') + ' · ' + esc(dlText) + '</span>' +
      '</span>' +
      '<span class="cdrow__left cdrow__left--' + urgencyTone(e.left) + '">' +
        '还剩<br><b>' + esc(countdownText(e.left)) + '</b>' +
      '</span>' +
    '</button>';
  }

  function countdownPanel(list, now) {
    var bk = deadlineBuckets(list, now);
    if (!bk.urgent.length && !bk.soon.length) return '';

    var h = '<section class="cd">';
    h += '<div class="cd__head">' +
      '<h2>⏳ 距截止还剩 ' + WINDOWS.urgentDays + ' 天</h2>' +
      '<span class="cd__sub">按今天 ' + fmtMonthDay(now.toISOString()) + ' 算' +
        (bk.urgent.length ? ' · ' + bk.urgent.length + ' 项' : '') + '</span>' +
      '</div>';

    if (!bk.urgent.length) {
      h += '<p class="cd__none">这 ' + WINDOWS.urgentDays + ' 天内没有要截止的事。</p>';
    } else {
      h += '<div class="cd__list">' + bk.urgent.map(cdRow).join('') + '</div>';
    }

    if (bk.soon.length) {
      h += '<details class="cd__more">' +
        '<summary>再看 ' + WINDOWS.urgentDays + '–' + WINDOWS.soonDays + ' 天内的 ' +
          bk.soon.length + ' 项</summary>' +
        '<div class="cd__list cd__list--soon">' + bk.soon.map(cdRow).join('') + '</div>' +
        '</details>';
    }

    h += '</section>';
    return h;
  }

  /* ========================= 信息完整度 ========================= */
  /*
   * 不用主观打分，只检查 6 个对学生决策最关键的事实字段有没有。
   * 多来源信息质量参差，靠这个让用户一眼看出哪条“说不清楚”。
   */
  var KEY_FIELDS = [
    { k: '时间', has: function (it) { return (it.schedule || []).some(function (s) { return s.at; }); } },
    { k: '地点', has: function (it) { return (it.schedule || []).some(function (s) { return s.place && !s.placeTBD; }); } },
    { k: '面向对象', has: function (it) { return !!it.audience && it.audience !== '未注明'; } },
    { k: '是否需报名', has: function (it) { return it.needSignup === true || it.needSignup === false; } },
    { k: '报名截止', has: function (it) { return (it.deadlines || []).some(function (d) { return d.at || d.text; }); } },
    { k: '费用', has: function (it) { return it.fee !== null && it.fee !== undefined; } }
  ];

  function completeness(item) {
    var ok = KEY_FIELDS.filter(function (f) { return f.has(item); });
    var miss = KEY_FIELDS.filter(function (f) { return !f.has(item); }).map(function (f) { return f.k; });
    return { score: ok.length, total: KEY_FIELDS.length, missing: miss };
  }

  /* ========================= 新生适配 ========================= */
  /*
   * 三档：ok（新生可冲） / warn（有门槛或信息不明，先确认） / no（新生不符合）
   * 完全由材料里的字面条件推导，不额外揣测。
   */
  function newbieFit(item) {
    if ((item.audienceExclude || []).indexOf('大一') >= 0) {
      return { key: 'no', label: '新生暂不符合', icon: '⛔' };
    }
    if (item.zeroBase === true && item.needSignup === false) {
      return { key: 'ok', label: '新生友好 · 直接去', icon: '✅' };
    }
    if (item.zeroBase === true) {
      return { key: 'ok', label: '零基础可参加', icon: '✅' };
    }
    /* 注意：账号发布的内容不会填 zeroBase，是 undefined 而不是 null。
       之前只判 null，导致自己发的内容被错误标成「需一定基础」。 */
    if (item.zeroBase == null) {
      if ((item.missing || []).length >= 3) {
        return { key: 'warn', label: '信息不明，需先确认', icon: '⚠️' };
      }
      return { key: 'warn', label: '未说明基础要求', icon: '⚠️' };
    }
    return { key: 'warn', label: '需一定基础', icon: '⚠️' };
  }

  /* ========================= 数据装配 ========================= */

  function allItems() {
    var live = RAW_ITEMS.filter(function (it) { return !it.mergedInto; });
    var posts = readLS(LS.posts, []).map(function (p) {
      p.userPost = true;
      p.source = p.source || 'student';
      return p;
    });
    return live.concat(posts);
  }

  function getItem(id) {
    return allItems().filter(function (it) { return it.id === id; })[0] || null;
  }

  /* 主信息 + 它的补充通知原文里，被合并进来的那些条目 */
  function mergedOriginals(item) {
    return (item.updates || []).map(function (u) {
      return RAW_ITEMS.filter(function (r) { return r.id === u.fromId; })[0];
    }).filter(Boolean);
  }

  /* ========================= 应用状态 ========================= */

  var state = {
    tab: 'search',
    q: '',
    source: 'all',
    category: 'all',
    newbie: false,
    onlyActionable: false,
    timebase: initialTimebase(),
    openId: null,
    publishOpen: false,
    editId: null,
    authOpen: false,
    authMode: 'login',
    joinOpen: null,      /* 正在填参与信息的活动 id */
    riskOpen: null,      /* 正在展示风险提醒的活动 id */
    riskThen: null,      /* 风险提醒点「继续」之后要执行的动作 */
    pendingSignup: null, /* 风险提醒期间暂存的报名表单内容 */
    settingsOpen: false,
    toast: null
  };

  var favs = readLS(LS.fav, []);
  var feedback = readLS(LS.fb, {});

  /* ---- 「我要参加」的登记记录 ----
   * 结构：{ [活动id]: { name, phone, at } }
   * 点「我要参加」必须留下姓名和联系电话，之后组织者才找得到人。
   * 旧版本存的是 ["01","03"] 这种纯 id 数组，这里自动迁移一次。 */
  function joinsMap() {
    var raw = readLS(LS.join, null);
    if (Array.isArray(raw)) {
      var migrated = {};
      raw.forEach(function (id) {
        migrated[id] = { name: '', phone: '', at: null, legacy: true };
      });
      writeLS(LS.join, migrated);
      return migrated;
    }
    return raw && typeof raw === 'object' ? raw : {};
  }

  function joinInfo(id) { return joinsMap()[id] || null; }
  function isJoined(id) { return !!joinsMap()[id]; }

  function setJoin(id, info) {
    var m = joinsMap();
    m[id] = info;
    writeLS(LS.join, m);
  }

  function removeJoin(id) {
    var m = joinsMap();
    delete m[id];
    writeLS(LS.join, m);
  }

  function joinIds() { return Object.keys(joinsMap()); }

  /* ---- 风险识别 ----
   * 两个来源：数据里预先标注的 risk，以及内容命中审核规则。
   * 后者是兜底——万一有内容绕过了发布时的检查（比如规则后来更新了）。 */
  function riskOf(item) {
    var out = [];
    if (item.risk && item.risk.reason) {
      out.push({
        level: item.risk.level || 'low',
        reason: item.risk.reason,
        advice: item.risk.advice || []
      });
    }

    /* 审核规则作为兜底：只有这条数据本身没有风险标注时才用它。
       否则同一条内容会被两个来源各说一遍，读起来像骂了两遍。 */
    if (out.length) return out;

    var mod = checkFields({
      '标题': item.title,
      '内容': item.content || item.oneLiner || ''
    });
    if (!mod.ok) {
      var cats = {};
      mod.hits.forEach(function (h) { cats[h.catName] = true; });
      out.push({
        level: 'high',
        reason: '这条内容包含风险表述：' + Object.keys(cats).join('、') + '。',
        advice: ['不要按内容里的指引私下联系或转账', '遇到可疑情况可以向平台反馈']
      });
    }
    return out;
  }

  function isRisky(item) { return riskOf(item).length > 0; }

  /* 取最严重的一条，用来决定提醒的措辞 */
  function topRisk(item) {
    var r = riskOf(item);
    if (!r.length) return null;
    return r.filter(function (x) { return x.level === 'high'; })[0] || r[0];
  }

  /* ========================= 过滤 ========================= */

  /* 把命中的搜索词标出来，让人一眼看到"为什么这条会被搜到"。
   * 先转义再匹配：文本和关键词走同一套转义，所以中文、& < > 都不会错位。 */
  function hl(text, q) {
    var s = esc(text == null ? '' : text);
    var needle = String(q || '').trim();
    if (!needle) return s;
    var pat = esc(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      return s.replace(new RegExp(pat, 'gi'), function (m) {
        return '<mark class="hl">' + m + '</mark>';
      });
    } catch (e) { return s; }
  }

  /* 当前搜索词，卡片渲染时用 */
  function curQ() { return state.q.trim(); }

  /* 一条信息里所有可被搜到的文本。
   * 之前漏了 content（用户发布的正文）和发布者，还写了一个根本不存在的
   * it.publisher 字段，导致自己发的正文搜不到。这里统一收口，加字段只改这一处。 */
  function searchText(it) {
    var cat = CATS[it.category] || {};
    var author = it.author || {};
    return [
      it.title,
      it.content,          /* 用户发布的正文 */
      it.oneLiner,
      it.audience,
      it.sourceName,       /* 发布方 */
      author.name,         /* 发布者姓名 */
      author.org,
      cat.code,
      cat.label,           /* 「竞赛」这类词也能搜到 */
      (it.tags || []).join(' '),
      (it.deadlines || []).map(function (d) { return d.label; }).join(' '),
      (it.schedule || []).map(function (s) { return (s.place || '') + ' ' + (s.text || ''); }).join(' '),
      it.raw
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function visibleItems() {
    var now = currentTime();
    var q = state.q.trim().toLowerCase();

    var list = allItems().filter(function (it) {
      if (state.source !== 'all' && it.source !== state.source) return false;
      if (state.category !== 'all' && it.category !== state.category) return false;

      if (state.newbie) {
        var fit = newbieFit(it);
        if (fit.key === 'no') return false;
      }

      if (state.onlyActionable) {
        var st = statusOf(it, now);
        if (['expired', 'ended', 'replay'].indexOf(st.key) >= 0) return false;
      }

      if (q && searchText(it).indexOf(q) < 0) return false;
      return true;
    });

    list.sort(function (a, b) {
      var sa = statusOf(a, now), sb = statusOf(b, now);
      if (sa.tier !== sb.tier) return sa.tier - sb.tier;
      var ta = sa.deadline ? sa.deadline.t : (nextEventTime(a) || Infinity);
      var tb = sb.deadline ? sb.deadline.t : (nextEventTime(b) || Infinity);
      if (ta !== tb) return ta - tb;
      return a.id < b.id ? -1 : 1;
    });

    return list;
  }

  function nextEventTime(it) {
    var now = currentTime().getTime();
    var ts = (it.schedule || []).filter(function (s) { return s.at; })
      .map(function (s) { return new Date(s.at).getTime(); })
      .filter(function (t) { return t >= now; });
    return ts.length ? Math.min.apply(null, ts) : null;
  }

  /* ========================= 渲染：卡片 ========================= */

  function statusChip(st) {
    return '<span class="chip chip--' + st.tone + '">' + esc(st.label) + '</span>';
  }

  function sourceChip(item) {
    var meta = SOURCES[item.source] || SOURCES.unknown ||
      { icon: '❓', short: '未注明', label: '发布方未注明', desc: '' };
    return '<span class="chip chip--src chip--src-' + esc(item.source) + '" title="' +
      esc(meta.desc || meta.label) + '">' + meta.icon + ' ' + esc(meta.short) + '</span>';
  }

  /* 门类徽章：A—F，配色和倒计时面板、筛选按钮保持一致 */
  function catChip(category) {
    var c = CATS[category];
    if (!c) return '';
    return '<span class="chip chip--cat chip--cat-' + esc(c.color) + '" title="' + esc(c.desc) + '">' +
      esc(c.code) + ' ' + esc(c.label) + '</span>';
  }

  /* 这条是不是当前登录的人发的 */
  function isMine(item) {
    var me = currentUser();
    if (!item.userPost || !me) return false;
    return item.author && item.author.name === me.name;
  }

  /* 学生发布的内容，把「谁发的、身份确认了没有」直接写在卡片上 */
  function publisherLine(item) {
    var a = item.author || {};
    var who = a.name || item.sourceName || '未署名';
    var org = a.org ? ' · ' + a.org : '';
    return '<span class="pub__mark pub__mark--' + (item.verified ? 'ok' : 'warn') + '">' +
        (item.verified ? '✅ 发布者已确认身份' : '⚠️ 发布者身份未确认') + '</span>' +
      '<span class="pub__who">由 <b>' + esc(who) + '</b>' + esc(org) + ' 发布</span>';
  }

  /* 卡片上的关键事实行：只显示「有」的，没有的合并成一句提示 */
  function factLine(item) {
    var out = [];
    var sch = (item.schedule || []).filter(function (s) { return s.at || s.text; })[0];
    if (sch) {
      var t = sch.at ? (sch.timeTBD ? sch.text : fmtDateTime(sch.at)) : sch.text;
      out.push('<span class="fact"><i>🕒</i>' + esc(t) + '</span>');
    }
    if (sch && sch.place) {
      out.push('<span class="fact"><i>📍</i>' + esc(sch.place) + '</span>');
    } else if (sch && sch.placeTBD) {
      out.push('<span class="fact fact--tbd"><i>📍</i>地点待确认</span>');
    }

    /* 报名相关：有截止时间就报时间；没有的话，至少要让用户知道要不要报名 */
    var dl = (item.deadlines || [])[0];
    if (dl) {
      var dtxt = dl.at
        ? (dl.precision === 'day' ? fmtMonthDay(dl.at) + '（当天截止）' : fmtDateTime(dl.at))
        : (dl.text || '未注明');
      out.push('<span class="fact"><i>✍️</i>' + esc(dl.label || '截止') + ' ' + esc(dtxt) + '</span>');
    } else if (item.needSignup === false) {
      out.push('<span class="fact"><i>✍️</i>无需报名</span>');
    } else if (item.needSignup === true) {
      out.push('<span class="fact fact--tbd"><i>✍️</i>需报名 · 截止时间未注明</span>');
    } else {
      out.push('<span class="fact fact--tbd"><i>✍️</i>是否需报名未注明</span>');
    }
    if (item.commitment) {
      out.push('<span class="fact"><i>⏳</i>' + esc(item.commitment) + '</span>');
    }
    return out.join('');
  }

  function cardHTML(item, st) {
    var fit = newbieFit(item);
    var isFav = favs.indexOf(item.id) >= 0;
    var isJoin = isJoined(item.id);
    var updates = (item.updates || []).length;
    var risk = item.risk && item.risk.level === 'high';

    var cls = 'card';
    if (risk) cls += ' card--risky';
    if (st.tone === 'urgent' || st.tone === 'live') cls += ' card--hot';

    return '' +
      '<article class="' + cls + '" data-open="' + esc(item.id) + '" tabindex="0" role="button">' +
        '<div class="card__top">' +
          statusChip(st) +
          catChip(item.category) +
          sourceChip(item) +
          (updates ? '<span class="chip chip--merged">🔗 已合并 ' + updates + ' 条后续通知</span>' : '') +
          (isMine(item) ? '<span class="chip chip--mine">我发布的</span>' : '') +
          (item.userPost && regCount(item.id)
            ? '<span class="chip chip--reg">📝 ' + regCount(item.id) + ' 人报名</span>' : '') +
        '</div>' +
        '<h3 class="card__title">' + hl(item.title, curQ()) + '</h3>' +
        '<p class="card__one">' + hl(item.oneLiner || '', curQ()) + '</p>' +
        (item.userPost ? '<div class="pubLine">' + publisherLine(item) + '</div>' : '') +
        '<div class="card__facts">' + factLine(item) + '</div>' +
        '<div class="card__bottom">' +
          '<span class="fit fit--' + fit.key + '">' + fit.icon + ' ' + esc(fit.label) + '</span>' +
          '<div class="card__acts">' +
            '<button class="iconbtn' + (isJoin ? ' is-on' : '') + '" data-join="' + esc(item.id) + '" ' +
              'title="我要参加（需填姓名和联系电话）" aria-label="我要参加">' + (isJoin ? '✅' : '🎯') + '</button>' +
            '<button class="iconbtn' + (isFav ? ' is-on' : '') + '" data-fav="' + esc(item.id) + '" ' +
              'title="收藏" aria-label="收藏">' + (isFav ? '⭐' : '☆') + '</button>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  /* ========================= 渲染：雷达页 ========================= */

  /* 搜索页外壳：搜索框 + 筛选条件。
   *
   * 这一层在输入过程中**不会重建**，只有下面的 #results 会更新。
   * 之前的写法是每敲一个字就把整个视图重新 innerHTML，输入框被销毁重建，
   * 中文输入法的候选状态被硬生生打断，结果就是中文根本打不进去。
   */
  function renderSearch() {
    var all = allItems();

    /* 筛选按钮上的条数是全局统计，不随搜索词变化，所以放在外壳里 */
    var catCount = {}, srcCount = {};
    all.forEach(function (it) {
      catCount[it.category] = (catCount[it.category] || 0) + 1;
      srcCount[it.source] = (srcCount[it.source] || 0) + 1;
    });

    var html = '';

    html += '<div class="searchBar">' +
      '<span class="searchBar__icon">🔍</span>' +
      '<input id="q" type="search" autocomplete="off" spellcheck="false" ' +
        'placeholder="搜活动、门类、地点、发布者…比如「零基础」「Git」「计算机学院」" ' +
        'aria-label="搜索校园信息" value="' + esc(state.q) + '">' +
      (state.q ? '<button class="search__clear" data-clear-q="1" aria-label="清空搜索">✕</button>' : '') +
    '</div>';

    html += '<div class="filters">';

    html += '<div class="chiprow" role="group" aria-label="门类筛选">';
    html += filtChip('category', 'all', '全部门类');
    CAT_ORDER.forEach(function (c) {
      if (!catCount[c]) return;
      html += filtChip('category', c, CATS[c].code + ' ' + CATS[c].label + ' ' + catCount[c]);
    });
    html += '</div>';

    html += '<div class="chiprow" role="group" aria-label="发布者身份筛选">';
    html += filtChip('source', 'all', '全部发布者');
    SOURCE_ORDER.forEach(function (s) {
      if (!srcCount[s]) return;
      html += filtChip('source', s, SOURCES[s].icon + ' ' + SOURCES[s].short + ' ' + srcCount[s]);
    });
    if (srcCount.unknown) {
      html += filtChip('source', 'unknown', SOURCES[SOURCE_UNKNOWN].icon + ' ' +
        SOURCES[SOURCE_UNKNOWN].short + ' ' + srcCount.unknown);
    }
    html += '</div>';

    html += '<div class="chiprow chiprow--toggle">' +
      '<button type="button" class="toggle' + (state.newbie ? ' is-on' : '') + '" data-toggle="newbie">' +
        '<span class="toggle__dot"></span>新生模式' +
        '<em>只看新生能参加的</em></button>' +
      '<button type="button" class="toggle' + (state.onlyActionable ? ' is-on' : '') + '" data-toggle="onlyActionable">' +
        '<span class="toggle__dot"></span>只看还能参加' +
        '<em>隐藏已截止和已结束</em></button>' +
      '</div>';

    html += '</div>';

    html += '<div id="results">' + renderResults() + '</div>';

    return html;
  }

  /* 结果区：只重绘这一块，输入框不受影响 */
  function renderResults() {
    var now = currentTime();
    var list = visibleItems();
    var all = allItems();

    /* 提醒条跟下面的列表用同一份筛选结果，避免「上面说有 3 场、下面一场都看不到」 */
    var closing = list.filter(function (it) { return statusOf(it, now).key === 'closing'; });
    var todayLive = list.filter(function (it) {
      var k = statusOf(it, now).key; return k === 'today' || k === 'live';
    });

    var alerts = [];
    if (todayLive.length) {
      var times = todayLive.map(function (i) { return nextEventTime(i) || now.getTime(); })
        .sort(function (a, b) { return a - b; });
      alerts.push('<button class="alert alert--live" data-goto-today="1">' +
        '🔔 <b>今天有 ' + todayLive.length + ' 场活动</b>，最早一场 ' +
        esc(fmtTime(new Date(times[0]))) + ' 开始 · 点这里看时间线</button>');
    }
    if (closing.length) {
      var soonest = closing.slice().sort(function (a, b) {
        return new Date(a.deadlines[0].at) - new Date(b.deadlines[0].at);
      })[0];
      alerts.push('<button class="alert alert--urgent" data-open="' + esc(soonest.id) + '">' +
        '⏰ <b>' + closing.length + ' 项即将截止报名</b>，最近的是「' +
        esc(soonest.title) + '」· ' + esc(relative(soonest.deadlines[0].at)) + '</button>');
    }

    var bk = deadlineBuckets(list, now);

    var html = '';

    html += '<div class="alerts">' + alerts.join('') + '</div>';

    /* 搜索结果提示：让人知道搜到了什么、是不是在筛选 */
    if (state.q.trim() || state.category !== 'all' || state.source !== 'all' ||
        state.newbie || state.onlyActionable) {
      html += '<div class="resultBar">' +
        '<span>找到 <b>' + list.length + '</b> 条' +
          (state.q.trim() ? '含「' + esc(state.q.trim()) + '」的信息' : '') + '</span>' +
        '<button type="button" class="mini" data-reset="1">清空条件</button>' +
      '</div>';
    }

    /* 只留两个数：一共有多少条、其中多少条快截止。
       条数用 allItems() 实时算，所以账号发布之后这里会跟着涨。 */
    html += '<div class="summary">' +
      '<div class="summary__item"><b>' + all.length + '</b><span>条信息</span></div>' +
      '<div class="summary__item' + (bk.urgent.length ? ' is-alert' : '') + '"><b>' + bk.urgent.length +
        '</b><span>' + WINDOWS.urgentDays + ' 天内截止</span></div>' +
    '</div>';

    html += countdownPanel(list, now);

    if (!list.length) {
      html += '<div class="empty">' +
        '<div class="empty__icon">🫥</div>' +
        '<p>' + (state.q.trim()
          ? '没有搜到含「' + esc(state.q.trim()) + '」的信息'
          : '没有符合条件的信息') + '</p>' +
        '<button type="button" class="btn btn--ghost" data-reset="1">清空筛选条件</button>' +
        '</div>';
      return html;
    }

    groupByTier(list, now).forEach(function (g) {
      html += '<section class="group">' +
        '<h2 class="group__title">' + g.title +
          (g.note ? '<span class="group__note">' + g.note + '</span>' : '') + '</h2>' +
        '<div class="cards">' + g.items.map(function (it) {
          return cardHTML(it, statusOf(it, now));
        }).join('') + '</div></section>';
    });

    return html;
  }

  /* 只重绘结果区。搜索输入时走这条路径，输入框本身不动。 */
  function renderResultsOnly() {
    var el = document.getElementById('results');
    if (el) el.innerHTML = renderResults();
  }

  function filtChip(key, val, label) {
    var on = state[key] === val;
    return '<button class="chipbtn' + (on ? ' is-on' : '') + '" data-filt="' + key + '" data-val="' + esc(val) + '">' +
      esc(label) + '</button>';
  }

  /* 按状态分组，比单纯按时间排更符合「我现在能做什么」的直觉 */
  function groupByTier(list, now) {
    var buckets = {
      now: { title: '⚡ 现在 / 今天', note: '正在进行或今天开始', items: [] },
      close: { title: '⏰ 快到截止时间了', note: '48 小时内截止报名', items: [] },
      open: { title: '✅ 还能报名', note: '', items: [] },
      maybe: { title: '🤔 报名已过，但还有机会', note: '', items: [] },
      long: { title: '📌 长期开放 / 持续招募', note: '', items: [] },
      done: { title: '📁 已结束 / 已截止', note: '仍可查看原通知，部分有回放', items: [] }
    };
    list.forEach(function (it) {
      var st = statusOf(it, now);
      var b;
      switch (st.key) {
        case 'live': case 'today': b = 'now'; break;
        case 'closing': b = 'close'; break;
        case 'standby': b = 'maybe'; break;
        case 'open': case 'upcoming': b = 'open'; break;
        case 'ongoing': b = 'long'; break;
        default: b = 'done';
      }
      buckets[b].items.push(it);
    });
    var order = ['now', 'close', 'open', 'maybe', 'long', 'done'];
    var out = [];
    order.forEach(function (k) {
      if (buckets[k].items.length) {
        out.push({
          title: buckets[k].title,
          note: buckets[k].note ? '<em>' + buckets[k].note + '</em>' : '',
          items: buckets[k].items
        });
      }
    });
    return out;
  }

  /* ========================= 渲染：今日时间线 ========================= */

  function renderToday() {
    var now = currentTime();
    var html = '';

    html += '<div class="todayHead">' +
      '<div class="todayHead__date">' + (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + WD[now.getDay()] + '</div>' +
      '<div class="todayHead__time">时间基准 ' + fmtTime(now) + ' · 按这个时间点推算状态</div>' +
    '</div>';

    /* 今天 */
    var todays = allItems().filter(function (it) {
      return (it.schedule || []).some(function (s) { return s.at && sameDay(new Date(s.at), now); });
    }).sort(function (a, b) {
      return new Date((a.schedule.filter(function (s) { return s.at; })[0]).at) -
             new Date((b.schedule.filter(function (s) { return s.at; })[0]).at);
    });

    html += '<section class="group"><h2 class="group__title">📍 今天</h2>';
    if (!todays.length) {
      html += '<div class="empty empty--sm">今天没有已录入的线下活动</div>';
    } else {
      html += '<div class="timeline">';
      todays.forEach(function (it) {
        var s = it.schedule.filter(function (x) { return x.at; })[0];
        var st = statusOf(it, now);
        html += '<div class="tl" data-open="' + esc(it.id) + '" tabindex="0" role="button">' +
          '<div class="tl__time">' + fmtTime(new Date(s.at)) + '</div>' +
          '<div class="tl__line"><span class="tl__dot tl__dot--' + st.tone + '"></span></div>' +
          '<div class="tl__body">' +
            '<div class="tl__title">' + esc(it.title) + '</div>' +
            '<div class="tl__meta">' +
              (s.place ? '📍 ' + esc(s.place) : (s.placeTBD ? '📍 地点未注明' : '📍 地点未注明')) +
              (it.needSignup === false ? ' · 无需报名' : '') +
              (s.endAt ? ' · 至 ' + fmtTime(new Date(s.endAt)) : '') +
            '</div>' +
            '<div class="tl__status">' + statusChip(st) + '</div>' +
          '</div></div>';
      });
      html += '</div>';
    }
    html += '</section>';

    /* 明天及以后 */
    ['tomorrow', 'week'].forEach(function (scope) {
      var items = allItems().filter(function (it) {
        var fut = (it.schedule || []).filter(function (s) { return s.at && new Date(s.at) > now; });
        if (!fut.length) return false;
        var t = Math.min.apply(null, fut.map(function (s) { return new Date(s.at).getTime(); }));
        var d = dayDiff(new Date(t), now);
        return scope === 'tomorrow' ? d === 1 : (d >= 2 && d <= 7);
      }).sort(function (a, b) {
        return (nextEventTime(a) || Infinity) - (nextEventTime(b) || Infinity);
      });

      if (!items.length) return;
      html += '<section class="group"><h2 class="group__title">' +
        (scope === 'tomorrow' ? '📅 明天' : '🗓️ 未来 7 天') + '</h2><div class="cards">';
      items.forEach(function (it) { html += cardHTML(it, statusOf(it, now)); });
      html += '</div></section>';
    });

    /* 只有截止时间、没有活动时间的那些，也别漏掉 */
    var dlOnly = allItems().filter(function (it) {
      var noEv = !(it.schedule || []).some(function (s) { return s.at && new Date(s.at) > now; });
      var dl = (it.deadlines || []).filter(function (d) { return d.at && new Date(d.at) > now; });
      return noEv && dl.length;
    }).sort(function (a, b) {
      return new Date(a.deadlines.filter(function (d) { return d.at; })[0].at) -
             new Date(b.deadlines.filter(function (d) { return d.at; })[0].at);
    });

    if (dlOnly.length) {
      html += '<section class="group"><h2 class="group__title">⏳ 只有截止时间，别错过<em>这些暂时还没有确定的活动时间，但报名会先截止</em></h2><div class="cards">';
      dlOnly.forEach(function (it) { html += cardHTML(it, statusOf(it, now)); });
      html += '</div></section>';
    }

    return html;
  }

  /* ========================= 渲染：我的 ========================= */

  function renderMine() {
    var now = currentTime();
    var html = '';

    var me = currentUser();

    html += '<div class="mineHead">' +
      '<div><h2>我的</h2><p>收藏、已报名和发布的内容都存在这台设备上，关掉页面再打开还在。</p></div>' +
      '<button class="btn btn--primary" data-publish="1">＋ 发布内容</button>' +
    '</div>';

    /* ---- 账号 / 发布者身份 ---- */
    if (me) {
      var rm = SOURCES[me.role] || SOURCES.student;
      html += '<div class="acct acct--in">' +
        '<span class="acct__avatar">' + esc(me.name.slice(0, 1)) + '</span>' +
        '<div class="acct__body">' +
          '<div class="acct__line"><b>' + esc(me.name) + '</b>' +
            '<span class="chip chip--src chip--src-' + esc(me.role) + '">' +
              rm.icon + ' ' + esc(rm.label) + '</span>' +
            '<span class="chip chip--ok">✅ 身份已确认</span>' +
          '</div>' +
          '<p>' + esc(me.org || '未填写学院 / 单位') + (me.sid ? ' · ' + esc(me.sid) : '') + '</p>' +
        '</div>' +
        '<button class="mini" data-auth="logout">退出登录</button>' +
      '</div>';
    } else {
      html += '<div class="acct acct--out">' +
        '<span class="acct__avatar">🔒</span>' +
        '<div class="acct__body">' +
          '<b>还没有登录</b>' +
          '<p>登录后可以发布内容，并带上你的发布者身份（学校 / 学院 / 老师 / 同学自主发布）。</p>' +
        '</div>' +
        '<button class="btn btn--primary" data-auth="open">登录 / 注册</button>' +
      '</div>';
    }

    /* ---- 三个分类：收藏 / 参与 / 发布 ----
     * 同一条内容可以同时出现在多个分类里（比如自己发的又收藏了，
     * 或者收藏了并且报了名），所以是三个独立的过滤，不是互斥分组。 */
    var all = allItems();

    var favList = all.filter(function (it) { return favs.indexOf(it.id) >= 0; })
      .sort(byUrgency(now));

    var joinList = all.filter(function (it) {
      return isJoined(it.id) || !!mySignup(it.id);
    }).sort(byUrgency(now));

    var postList = all.filter(function (it) { return it.userPost; })
      .sort(function (a, b) {
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });

    var regTotal = joinList.reduce(function (n, it) { return n + regCount(it.id); }, 0);

    /* 左侧项目栏 */
    var side = [
      { id: 'sec-fav', icon: '🔖', name: '我的收藏', n: favList.length },
      { id: 'sec-join', icon: '🎯', name: '我参与的', n: joinList.length },
      { id: 'sec-pub', icon: '📝', name: '我发布的', n: postList.length }
    ];

    html += '<div class="mineLayout">';

    html += '<aside class="mineSide" aria-label="我的分类">' +
      side.map(function (s) {
        return '<button type="button" class="mineSide__item" data-jump="' + s.id + '">' +
          '<span class="mineSide__name">' + s.icon + ' ' + s.name + '</span>' +
          '<b>' + s.n + '</b></button>';
      }).join('') +
      (regTotal ? '<p class="mineSide__note">收到 ' + regTotal + ' 条报名</p>' : '') +
    '</aside>';

    html += '<div class="mineMain">';

    /* 1. 我的收藏 */
    html += '<section class="group jumpSec" id="sec-fav">' +
      '<h2 class="group__title">🔖 我的收藏<em>在列表里点 ☆ 加进来，共 ' + favList.length + ' 条</em></h2>';
    if (!favList.length) {
      html += '<div class="empty empty--sm">还没有收藏。在搜索页的卡片上点 ☆ 就会出现在这里。</div>';
    } else {
      html += '<div class="cards">' + favList.map(function (it) {
        return cardHTML(it, statusOf(it, now));
      }).join('') + '</div>';
    }
    html += '</section>';

    /* 2. 我参与的 */
    html += '<section class="group jumpSec" id="sec-join">' +
      '<h2 class="group__title">🎯 我参与的<em>标记了「我要参加」，或者已经报过名的，共 ' +
        joinList.length + ' 条</em></h2>';
    if (!joinList.length) {
      html += '<div class="empty empty--sm">还没有参与任何活动。在卡片上点 🎯，' +
        '或者在账号发布的内容里报名，就会出现在这里。</div>';
    } else {
      html += '<div class="cards">' + joinList.map(function (it) {
        var mineReg = mySignup(it.id);
        var mineJoin = joinInfo(it.id);
        var line = '';
        if (mineJoin && !mineJoin.legacy) {
          line += '<div class="myReg">🎯 我已登记参加：<b>' + esc(mineJoin.name) + '</b> · ' +
            esc(mineJoin.phone) +
            (mineJoin.org ? ' · ' + esc(mineJoin.org) : '') +
            '<button type="button" class="mini" data-join="' + esc(it.id) + '">修改</button></div>';
        } else if (mineJoin && mineJoin.legacy) {
          line += '<div class="myReg myReg--legacy">🎯 已标记参加，但还没填姓名和电话' +
            '<button type="button" class="mini" data-join="' + esc(it.id) + '">去补填</button></div>';
        }
        if (mineReg) {
          line += '<div class="myReg myReg--reg">📝 我已报名：<b>' + esc(mineReg.name) + '</b> · ' +
            esc(mineReg.phone) + '</div>';
        }
        return '<div class="cardWrap">' + cardHTML(it, statusOf(it, now)) + line + '</div>';
      }).join('') + '</div>';
    }
    html += '</section>';

    /* 3. 我发布的 */
    html += '<section class="group jumpSec" id="sec-pub">' +
      '<h2 class="group__title">📝 我发布的<em>发布后会进入正常浏览流程，其他同学也能看到，共 ' +
        postList.length + ' 条</em></h2>';
    if (!postList.length) {
      html += '<div class="empty empty--sm">还没有发布过内容。同学可以发约球、找搭子、组队这类信息。</div>';
    } else {
      html += '<div class="cards">' + postList.map(function (it) {
        return '<div class="cardWrap">' + cardHTML(it, statusOf(it, now)) +
          regPanel(it) +
          '<div class="cardWrap__tools">' +
            '<button class="mini" data-edit="' + esc(it.id) + '">编辑</button>' +
            '<button class="mini mini--danger" data-del="' + esc(it.id) + '">删除</button>' +
          '</div></div>';
      }).join('') + '</div>';
    }
    html += '</section>';

    html += '</div></div>';   /* mineMain / mineLayout */

    /* 设置 */
    html += '<section class="group"><h2 class="group__title">⚙️ 设置</h2>' +
      '<div class="settings">' +
        '<div class="settings__row">' +
          '<div><b>时间基准</b><p>所有状态都是按这个时间点推算的。' +
            '演示数据的时间背景是 2026 年 9 月 16 日，默认就锁在这天；' +
            '也可以切回真实时间，看这套数据在当下是什么样子。</p></div>' +
          '<div class="settings__ctrl">' +
            '<button type="button" class="mini' + (isRealTime() ? ' is-on' : '') + '" data-base="real">' +
              '使用真实时间</button>' +
            '<button type="button" class="mini' + (!isRealTime() ? ' is-on' : '') + '" data-base="data">' +
              '锁定在 2026年9月16日</button>' +
          '</div>' +
        '</div>' +
        '<div class="settings__row">' +
          '<div><b>清空本地数据</b><p>删除收藏、已报名标记和我发布的内容。</p></div>' +
          '<div class="settings__ctrl"><button class="mini mini--danger" data-wipe="1">清空</button></div>' +
        '</div>' +
      '</div>' +
    '</section>';

    html += '<footer class="foot">校园活动雷达<br>' +
      '页面中的活动、通知与招募信息均为演示用模拟数据，不代表任何学校的真实通知。<br>' +
      '未注明的事实一律标注为「未注明」，不做推测。</footer>';

    return html;
  }

  /* ========================= 详情弹层 ========================= */

  function renderDetail(item) {
    var now = currentTime();
    var st = statusOf(item, now);
    var fit = newbieFit(item);
    var comp = completeness(item);
    var isFav = favs.indexOf(item.id) >= 0;
    var isJoin = isJoined(item.id);
    var cat = CATS[item.category] || { label: '未分类', code: '?', desc: '' };

    var h = '';

    h += '<div class="sheet__head">' +
      '<div class="sheet__chips">' + statusChip(st) + catChip(item.category) + sourceChip(item) + '</div>' +
      '<h2 class="sheet__title">' + esc(item.title) + '</h2>' +
      '<p class="sheet__pub">门类：<b>' + esc(cat.code) + ' ' + esc(cat.label) + '</b> · ' + esc(cat.desc) + '</p>' +
      (item.sourceName ? '<p class="sheet__pub">发布方：' + esc(item.sourceName) + '</p>' : '') +
      (item.userPost ? '<p class="sheet__pub">' + publisherLine(item) + '</p>' : '') +
      '<p class="sheet__one">' + esc(item.oneLiner || '') + '</p>' +
    '</div>';

    h += '<div class="sheet__acts">' +
      '<button class="btn ' + (isJoin ? 'btn--primary' : 'btn--ghost') + '" data-join="' + esc(item.id) + '">' +
        (isJoin ? '✅ 已登记参加' : '🎯 我要参加') + '</button>' +
      '<button class="btn ' + (isFav ? 'btn--primary' : 'btn--ghost') + '" data-fav="' + esc(item.id) + '">' +
        (isFav ? '⭐ 已收藏' : '☆ 收藏') + '</button>' +
      '<button class="btn btn--ghost" data-ics="' + esc(item.id) + '"' +
        (hasCalendarTime(item) ? '' : ' disabled title="这条信息没有确定的活动时间，无法加入日历"') +
        '>📅 加入日历</button>' +
      '<button class="btn btn--ghost" data-copy="' + esc(item.id) + '">📋 复制信息</button>' +
    '</div>';

    /* 状态解释：为什么显示这个状态 */
    h += '<div class="note note--' + st.tone + '">' + statusExplain(item, st) + '</div>';

    /* 风险提示放最上面，这类内容要先看到 */
    if (item.risk) {
      h += '<section class="sec sec--risk sec--risk-' + item.risk.level + '">' +
        '<h3>' + (item.risk.level === 'high' ? '⚠️ 这条信息需要当心' : 'ℹ️ 参与前请确认') + '</h3>' +
        '<p>' + esc(item.risk.reason) + '</p>' +
        (item.risk.advice ? '<ul>' + item.risk.advice.map(function (a) {
          return '<li>' + esc(a) + '</li>';
        }).join('') + '</ul>' : '') +
      '</section>';
    }

    if (item.warn) {
      h += '<div class="note note--warn">💡 ' + esc(item.warn) + '</div>';
    }

    /* 用户发布的原文内容 */
    if (item.content) {
      h += '<section class="sec"><h3>发布内容</h3>' +
        '<p class="postBody">' + esc(item.content).replace(/\n/g, '<br>') + '</p>' +
        (item.contact ? '<p class="sec__desc" style="margin-top:10px">联系方式：<b>' + esc(item.contact) + '</b></p>' : '') +
      '</section>';
    }

    /* 关键信息 */
    h += '<section class="sec"><h3>关键信息</h3><div class="kv">';
    if (item.audience) {
      h += kvRow('面向对象', esc(item.audience), (item.audienceExclude || []).length ? '不含' + item.audienceExclude.join('、') : '');
    }
    h += kvRow('是否需要报名',
      item.needSignup === true ? '需要' : item.needSignup === false ? '不需要，直接到场' : '通知未说明');
    if (item.commitment) h += kvRow('时间投入', esc(item.commitment));
    if (item.fee) h += kvRow('费用', esc(item.fee));
    if (item.capacity) h += kvRow('名额', esc(item.capacityText || item.capacity + ' 人'));
    if (item.zeroBase !== null && item.zeroBase !== undefined) {
      h += kvRow('基础要求', item.zeroBase ? '零基础可参加' : '需要一定基础');
    }
    h += '</div></section>';

    /* 时间与截止 */
    if ((item.schedule || []).length || (item.deadlines || []).length) {
      h += '<section class="sec"><h3>时间安排</h3><div class="timeline-list">';
      (item.schedule || []).forEach(function (s) {
        var past = s.at && new Date(s.at) < now;
        h += '<div class="tlrow' + (past ? ' is-past' : '') + '">' +
          '<div class="tlrow__label">' + esc(s.label) + '</div>' +
          '<div class="tlrow__val">' +
            esc(s.at ? (s.timeTBD ? s.text : fmtDateTime(s.at) + (s.endAt ? '—' + fmtTime(new Date(s.endAt)) : '')) : s.text) +
            (s.place ? ' · ' + esc(s.place) : '') +
            (s.placeTBD ? ' · <span class="tbd">地点待确认</span>' : '') +
            (past ? ' <span class="tbd">已结束</span>' : '') +
            (s.note ? ' <span class="tbd">' + esc(s.note) + '</span>' : '') +
          '</div></div>';
      });
      (item.deadlines || []).forEach(function (d) {
        var past = d.at && new Date(d.at) < now;
        var val;
        if (d.at) {
          val = d.precision === 'day'
            ? fmtMonthDay(d.at) + '（通知只写了日期，未注明具体时间）'
            : fmtDateTime(d.at);
        } else {
          val = d.text || '未注明';
        }
        h += '<div class="tlrow tlrow--dl' + (past ? ' is-past' : '') + '">' +
          '<div class="tlrow__label">' + esc(d.label || '截止') + '</div>' +
          '<div class="tlrow__val">' + esc(val) +
            (past ? ' <span class="tbd">已过</span>' : (d.at ? ' <span class="tbd">' + esc(relative(d.at)) + '</span>' : '')) +
            (d.note ? '<br><span class="tbd">' + esc(d.note) + '</span>' : '') +
          '</div></div>';
      });
      h += '</div></section>';
    }

    /* 我该做什么 */
    var todos = buildTodos(item, now);
    if (todos.length) {
      h += '<section class="sec"><h3>我要做什么</h3><ul class="todo">' +
        todos.map(function (t) {
          return '<li class="todo__item todo__item--' + t.kind + '"><span>' + t.icon + '</span><div>' + t.text + '</div></li>';
        }).join('') + '</ul></section>';
    }

    /* 补充通知 */
    if ((item.updates || []).length) {
      h += '<section class="sec sec--merged"><h3>🔗 已合并的后续通知</h3>' +
        '<p class="sec__desc">同一件事有多条通知时，这里会自动合并，以最新一条为准，不用你自己比对。</p>';
      (item.updates || []).forEach(function (u) {
        h += '<div class="upd"><div class="upd__head">' +
          '<span class="upd__id">原信息 ' + esc(u.fromId) + '</span>' + esc(u.title) + '</div>' +
          '<p>' + esc(u.text) + '</p></div>';
      });
      if (item.conflictNote) {
        h += '<div class="note note--warn">⚖️ ' + esc(item.conflictNote) + '</div>';
      }
      h += '</section>';
    }

    /* 信息完整度 */
    h += '<section class="sec"><h3>信息完整度</h3>' +
      '<div class="meter"><div class="meter__bar"><i style="width:' +
        Math.round(comp.score / comp.total * 100) + '%"></i></div>' +
        '<span class="meter__txt">' + comp.score + '/' + comp.total + ' 项关键信息已提供</span></div>';
    if (comp.missing.length) {
      h += '<p class="sec__desc">这条通知没有说明：</p><div class="chips-inline">' +
        comp.missing.map(function (m) {
          return '<span class="chip chip--miss">' + esc(m) + ' 未注明</span>';
        }).join('') + '</div>' +
        '<p class="sec__desc sec__desc--tip">这些字段保持空白，是因为原通知里确实没写。报名或出行前请先向发布方确认。</p>';
    } else {
      h += '<p class="sec__desc">关键信息齐全。</p>';
    }
    h += '</section>';

    /* 原始通知 */
    if (item.raw) {
      h += '<section class="sec"><h3>原始通知</h3>' +
        '<details class="raw"><summary>展开查看材料原文（信息 ' + esc(item.id) + '）</summary>' +
        '<blockquote>' + esc(item.raw) + '</blockquote>' +
        ((item.updates || []).length ? (mergedOriginals(item).map(function (r) {
          return '<blockquote><span class="raw__tag">信息 ' + esc(r.id) + '</span>' + esc(r.raw) + '</blockquote>';
        }).join('')) : '') +
        '<p class="sec__desc sec__desc--tip">页面上的所有结论都基于以上原文，没有添加材料之外的事实。</p>' +
        '</details></section>';
    }

    /* 报名（只对账号发布的内容出现） */
    h += signupSection(item);

    /* 反馈 */
    h += '<section class="sec sec--fb">' +
      '<button class="btn btn--ghost btn--wide' + (feedback[item.id] ? ' is-done' : '') + '" data-fb="' + esc(item.id) + '">' +
        (feedback[item.id] ? '✓ 已反馈信息有误，等待核实' : '🚩 信息有误？点这里反馈') +
      '</button>' +
      '<p class="sec__desc sec__desc--tip">反馈会记录在本机，用于标记这条信息需要复核。</p>' +
    '</section>';

    return h;
  }

  function kvRow(k, v, extra) {
    return '<div class="kv__row"><div class="kv__k">' + esc(k) + '</div>' +
      '<div class="kv__v">' + v + (extra ? ' <span class="tbd">（' + esc(extra) + '）</span>' : '') + '</div></div>';
  }

  /* 只有还没发生的活动才能加进日历；已经过去的没必要导 .ics。
     这里按当前时间实时判断，不依赖数据里写死的标记。 */
  function hasCalendarTime(item) {
    var ms = currentTime().getTime();
    return (item.schedule || []).some(function (s) {
      return s.at && !s.timeTBD && new Date(s.at).getTime() >= ms;
    });
  }

  function statusExplain(item, st) {
    var now = currentTime();
    switch (st.key) {
      case 'live': return '这场活动正在进行中（按当前时间基准推算）。';
      case 'today': return '今天就会开始，注意别错过时间。';
      case 'closing': return '报名截止时间很近了，' + esc(relative(st.deadline.d.at)) + '，要报就现在。';
      case 'standby': return '正式报名通道已经关闭。发布方说明现场仍有余位时可候补入场，但不保证有位置。';
      case 'expired': return '报名截止时间已经过了。仍可查看原通知，也可以联系发布方问问是否还能补报。';
      case 'replay': return '活动已经结束，发布方提到会有回放，具体发布方式和时间未确定。';
      case 'ended': return '活动已经结束。';
      case 'ongoing': return '这条信息没有明确的截止时间，属于长期有效或持续招募，随时可以联系。';
      case 'open': return '还可以报名，截止时间 ' + esc(fmtDateTime(st.deadline.d.at)) + '。';
      default: return '活动时间 ' + esc(fmtDateTime((item.schedule || []).filter(function (s) { return s.at; })[0].at)) + '。';
    }
  }

  /* 把「我该做什么」翻译成具体动作，而不是罗列字段 */
  function buildTodos(item, now) {
    var out = [];
    var st = statusOf(item, now);

    if (st.key === 'closing') {
      out.push({ kind: 'hot', icon: '⏰', text: '<b>尽快报名</b>：' + esc(st.deadline.label || '报名截止') + ' ' + esc(relative(st.deadline.d.at)) + '。' });
    }
    if (st.key === 'standby') {
      out.push({ kind: 'warn', icon: '🎲', text: '报名已截止。<b>可以试试现场候补</b>，但先想好没位置怎么办。' });
    }
    if (st.key === 'expired') {
      out.push({ kind: 'mute', icon: '🚪', text: '报名已过。如仍想参加，可联系发布方确认是否接受补报。' });
    }
    if (st.key === 'replay') {
      out.push({ kind: 'info', icon: '🎬', text: '留意发布方上传的回放，通知里没有给出具体地址和时间。' });
    }

    if (item.needSignup === true) {
      var dl = (item.deadlines || []).filter(function (d) { return d.at && new Date(d.at) > now; })[0];
      out.push({
        kind: 'step', icon: '1️⃣',
        text: '<b>先报名</b>' + (dl ? '：在 ' + esc(fmtDateTime(dl.at)) + ' 前完成。' : '（通知未注明报名截止时间，越早越好）。')
      });
    } else if (item.needSignup === false) {
      out.push({ kind: 'step', icon: '1️⃣', text: '<b>不用报名</b>，按时间去就行。' });
    } else if (item.needSignup === null) {
      out.push({ kind: 'warn', icon: '❓', text: '<b>是否要报名没说清楚</b>，去之前先找发布方确认一下。' });
    }

    var place = (item.schedule || []).filter(function (s) { return s.place || s.placeTBD; })[0];
    if (place && place.placeTBD) {
      out.push({ kind: 'warn', icon: '📍', text: '<b>地点还没定</b>，出发前记得再确认一次。' });
    } else if (!place || !place.place) {
      out.push({ kind: 'warn', icon: '📍', text: '<b>通知里没有写地点</b>，去之前先问清楚。' });
    }

    if (item.risk && item.risk.level === 'high') {
      out.push({ kind: 'danger', icon: '🛡️', text: '<b>先别急着联系对方</b>，这条信息的来源和内容都无法核实。' });
    }

    if (item.updates && item.updates.length) {
      out.push({ kind: 'info', icon: '🔗', text: '这条活动有 <b>' + item.updates.length + ' 条后续通知</b>，上方已合并，以最新一条为准。' });
    }

    return out;
  }

  /* ========================= 发布 / 编辑 ========================= */

  function blankPost() {
    return {
      id: '', title: '', content: '', category: '', source: 'student',
      oneLiner: '', schedule: [], deadlines: [], audience: '全校学生',
      zeroBase: null, needSignup: null, fee: null, commitment: null,
      capacity: null, missing: [], tags: [], raw: ''
    };
  }

  function renderPublish(item) {
    item = item || blankPost();
    var isEdit = !!item.id;
    var s0 = (item.schedule || [])[0] || {};
    var d0 = (item.deadlines || [])[0] || {};

    function toLocalInput(iso) {
      if (!iso) return '';
      var d = new Date(iso);
      if (isNaN(d)) return '';
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0') + 'T' + String(d.getHours()).padStart(2, '0') + ':' +
        String(d.getMinutes()).padStart(2, '0');
    }

    var me = currentUser();
    var h = '';

    h += '<div class="sheet__head">' +
      '<h2 class="sheet__title">' + (isEdit ? '编辑我发布的内容' : '发布内容') + '</h2>' +
      '<p class="sheet__one">同学之间约球、找搭子、组队都可以发。发布后会直接出现在列表里，其他同学也能看到。' +
        '<b>门类、发布内容、截止时间三项必填。</b></p>' +
    '</div>';

    /* ---- 发布者身份：必须先确认，发布内容才有归属 ---- */
    if (!me) {
      h += '<div class="idbox idbox--out">' +
        '<span class="idbox__icon">🔒</span>' +
        '<div class="idbox__body">' +
          '<b>发布前需要先登录，确认发布者身份</b>' +
          '<p>登录后发布的内容会记在你名下，其他同学能看到是谁发的、有没有确认过身份。</p>' +
        '</div>' +
        '<button type="button" class="btn btn--primary" data-auth="open">去登录 / 注册</button>' +
      '</div>';
    } else {
      h += '<div class="idbox idbox--in">' +
        '<span class="idbox__avatar">' + esc(me.name.slice(0, 1)) + '</span>' +
        '<div class="idbox__body">' +
          '<b>发布者：' + esc(me.name) + ' <span class="idbox__ok">✅ 身份已确认</span></b>' +
          '<p>' + esc((me.org || '未填写学院') + (me.sid ? ' · ' + me.sid : '')) + '</p>' +
        '</div>' +
        '<button type="button" class="mini" data-auth="logout">切换账号</button>' +
      '</div>';
    }

    h += '<form class="form" id="postForm">';

    /* ---- 1. 门类（必选） ---- */
    h += '<label class="fld"><span>属于哪个门类 <b>*</b></span>' +
      '<select name="category" required>' +
        '<option value=""' + (item.category ? '' : ' selected') + ' disabled>请选择门类（必选）</option>' +
        CAT_ORDER.map(function (c) {
          return '<option value="' + c + '"' + (item.category === c ? ' selected' : '') + '>' +
            CATS[c].code + ' · ' + CATS[c].label + '　—— ' + CATS[c].desc + '</option>';
        }).join('') +
      '</select>' +
      '<em class="fld__hint">同学自发发布的内容一般选 F；如果是替某个组织转发，选对应的 A—E。</em>' +
    '</label>';

    /* ---- 2. 发布内容（必填） ---- */
    h += '<label class="fld"><span>标题 <b>*</b></span>' +
      '<input name="title" required maxlength="40" placeholder="例：周末羽毛球约球" value="' + esc(item.title) + '"></label>';

    h += '<label class="fld"><span>发布内容 <b>*</b></span>' +
      '<textarea name="content" required rows="4" maxlength="300" ' +
        'placeholder="说清楚这是什么活动、怎么参加、有什么要求。例：这周六下午4点在体育馆打球，计划6—8人，场地费AA，想来的私我拉群。">' +
        esc(item.content || '') + '</textarea>' +
      '<em class="fld__hint">这段话会作为活动详情展示给其他同学。</em>' +
    '</label>';

    /* ---- 3. 截止时间（必填） ---- */
    h += '<label class="fld"><span>截止时间 <b>*</b></span>' +
      '<input type="datetime-local" name="deadline" required value="' + toLocalInput(d0.at) + '">' +
      '<em class="fld__hint">报名或报名的最后期限。这个时间会进入「距截止还剩 3 天」的倒计时列表。</em>' +
    '</label>';

    h += '<details class="optional"' + (isEdit ? ' open' : '') + '><summary>补充信息（可选，但填了同学更容易决定）</summary>' +
      '<div class="optional__body">' +

      '<label class="fld"><span>活动开始时间</span>' +
        '<input type="datetime-local" name="startAt" value="' + toLocalInput(s0.at) + '"></label>' +

      '<label class="fld"><span>地点</span>' +
        '<input name="place" maxlength="30" placeholder="例：体育馆3号场" value="' + esc(s0.place || '') + '"></label>' +

      '<label class="fld"><span>面向对象</span>' +
        '<input name="audience" maxlength="20" placeholder="例：全校学生" value="' + esc(item.audience || '全校学生') + '"></label>' +

      '<div class="fld fld--2col">' +
        '<label class="fld"><span>费用</span>' +
          '<input name="fee" maxlength="20" placeholder="例：AA / 免费 / 每人20元" value="' + esc(item.fee || '') + '"></label>' +
        '<label class="fld"><span>人数上限</span>' +
          '<input name="capacity" type="number" min="1" max="999" placeholder="例：8" value="' + esc(item.capacity || '') + '"></label>' +
      '</div>' +

      '<label class="fld"><span>联系方式</span>' +
        '<input name="contact" maxlength="40" placeholder="例：微信号 / 群号" value="' + esc(item.contact || '') + '"></label>' +

      '</div></details>';

    /* ---- 4. 发布者确认 ---- */
    h += '<label class="confirm">' +
      '<input type="checkbox" name="confirmIdentity" required' + (me ? '' : ' disabled') + '>' +
      '<span>我确认以上内容<strong>由本人发布且信息属实</strong>，并愿意为此负责。' +
        '虚假内容会被其他同学反馈，并标记为「身份存疑」。</span>' +
    '</label>';

    /* 发布时的完整度自检：填得越全，同学越找得到 */
    h += '<div class="precheck" id="precheck"></div>';

    h += '<div class="form__acts">' +
      '<button type="button" class="btn btn--ghost" data-close-sheet="1">取消</button>' +
      '<button type="submit" class="btn btn--primary"' + (me ? '' : ' disabled') + '>' +
        (me ? (isEdit ? '保存修改' : '确认身份并发布') : '请先登录') + '</button>' +
    '</div>';

    h += '</form>';
    return h;
  }

  /* 实时自检：必填项没齐就一直提示；齐了再提示哪些可选信息还缺 */
  function updatePrecheck() {
    var box = document.getElementById('precheck');
    if (!box) return;
    var f = document.getElementById('postForm');
    if (!f) return;
    var g = function (n) { var el = f.elements[n]; return el ? String(el.value || '').trim() : ''; };

    /* 必填三项 */
    var must = [
      { k: '门类', ok: !!g('category') },
      { k: '标题', ok: !!g('title') },
      { k: '发布内容', ok: !!g('content') },
      { k: '截止时间', ok: !!g('deadline') }
    ];
    var mustMiss = must.filter(function (x) { return !x.ok; }).map(function (x) { return x.k; });

    if (mustMiss.length) {
      box.className = 'precheck precheck--must';
      box.innerHTML = '<p>必填项还差：<b>' + mustMiss.join('、') + '</b>。' +
        '这四项（门类、标题、内容、截止时间）不填完不能发布。</p>';
      return;
    }

    /* 内容审核：命中风险词直接拦下，必须改完才能发 */
    var mod = checkFields({ '标题': g('title'), '发布内容': g('content'), '联系方式': g('contact') });
    if (!mod.ok) {
      var groups = {};
      mod.hits.forEach(function (h) { (groups[h.cat] = groups[h.cat] || []).push(h); });
      box.className = 'precheck precheck--block';
      box.innerHTML =
        '<p class="precheck__hd">🚫 <b>检测到 ' + mod.hits.length + ' 处风险表述，暂时不能发布</b></p>' +
        '<p class="precheck__sub">改掉下面标出的词之后就能发。</p>' +
        Object.keys(groups).map(function (k) {
          var g0 = groups[k][0];
          return '<div class="precheck__cat">' +
            '<div class="precheck__catName">' + g0.icon + ' ' + esc(g0.catName) + '</div>' +
            '<div class="precheck__words">' + groups[k].map(function (h) {
              return '<span class="badword">' + esc(h.field) + '：「' + esc(h.word) + '」</span>';
            }).join('') + '</div>' +
            '<div class="precheck__why">' + esc(g0.desc) + '</div>' +
          '</div>';
        }).join('');
      return;
    }

    /* 可选但很影响别人判断的字段 */
    var nice = [
      { k: '活动时间', ok: !!g('startAt') },
      { k: '地点', ok: !!g('place') },
      { k: '费用', ok: !!g('fee') },
      { k: '联系方式', ok: !!g('contact') }
    ];
    var niceMiss = nice.filter(function (x) { return !x.ok; }).map(function (x) { return x.k; });
    var done = nice.length - niceMiss.length;

    box.className = 'precheck';
    box.innerHTML = '<div class="precheck__bar"><i style="width:' +
        Math.round(done / nice.length * 100) + '%"></i></div>' +
      '<p>' + (niceMiss.length
        ? '必填项齐了，可以发布。还差 <b>' + niceMiss.join('、') + '</b> 没填——' +
          '不填的话，同学看到之后还得再来问你一次。'
        : '👌 必填和补充信息都齐了，同学可以直接判断要不要参加。') + '</p>';
  }

  /* ========================= 登录 / 注册 ========================= */

  function renderAuth(mode) {
    mode = mode || 'login';
    var isReg = mode === 'register';
    var h = '';

    h += '<div class="sheet__head">' +
      '<h2 class="sheet__title">' + (isReg ? '注册发布者身份' : '登录') + '</h2>' +
      '<p class="sheet__one">' +
        (isReg
          ? '发布前先确认你是哪一类发布者。发布的内容会挂在你的身份下，其他同学能看到是谁发的。'
          : '登录后可以发布内容，也能管理自己发过的信息。') +
      '</p>' +
    '</div>';

    h += '<div class="authtabs">' +
      '<button type="button" class="authtab' + (isReg ? '' : ' is-on') + '" data-authmode="login">登录</button>' +
      '<button type="button" class="authtab' + (isReg ? ' is-on' : '') + '" data-authmode="register">注册</button>' +
    '</div>';

    h += '<form class="form" id="authForm">';

    if (isReg) {
      h += '<div class="fld"><span>发布者身份 <b>*</b></span><div class="roles">' +
        SOURCE_ORDER.map(function (s, i) {
          return '<label class="role">' +
            '<input type="radio" name="role" value="' + s + '"' + (i === 3 ? ' checked' : '') + '>' +
            '<span><b>' + SOURCES[s].icon + ' ' + SOURCES[s].label + '</b>' +
            '<em>' + esc(SOURCES[s].desc) + '</em></span>' +
          '</label>';
        }).join('') + '</div>' +
        '<em class="fld__hint">这个身份会显示在你发布的每一条内容上。</em></div>';
    }

    h += '<label class="fld"><span>' + (isReg ? '显示名称' : '昵称') + ' <b>*</b></span>' +
      '<input name="name" required maxlength="20" autocomplete="username" placeholder="' +
        (isReg ? '同学填姓名或昵称；学院发布填学院名；老师填「姓 + 老师」' : '注册时填的名称') + '"></label>';

    if (isReg) {
      h += '<label class="fld"><span>所属学院 / 单位</span>' +
        '<select name="org">' +
          '<option value="">请选择（可留空）</option>' +
          COLLEGES.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') +
          '<option value="学校部门">学校部门（如教务处、学生工作处）</option>' +
          '<option value="其他">其他 / 非学院单位</option>' +
        '</select>' +
        '<em class="fld__hint">选「学院发布」时，这里要和显示名称一致，同学才知道是谁在发布。</em>' +
      '</label>';
      h += '<label class="fld"><span>学号 / 工号</span>' +
        '<input name="sid" maxlength="20" placeholder="选填，只在本站内用于标识身份"></label>';
    }

    h += '<label class="fld"><span>密码 <b>*</b></span>' +
      '<input type="password" name="pass" required minlength="4" autocomplete="' +
        (isReg ? 'new-password' : 'current-password') + '" placeholder="至少 4 位"></label>';

    h += '<div class="authnote authnote--info">' +
      '🔐 本站没有服务端，账号只保存在<strong>这台设备的浏览器</strong>里：' +
      '换设备、换浏览器或清缓存就没了，密码也不会传到任何地方。' +
      '它的作用是让发布内容有明确归属，<strong>不是真实身份认证</strong>。' +
    '</div>';

    h += '<div class="authnote" id="authNote"></div>';

    h += '<div class="form__acts">' +
      '<button type="button" class="btn btn--ghost" data-close-sheet="1">取消</button>' +
      '<button type="submit" class="btn btn--primary">' + (isReg ? '注册并登录' : '登录') + '</button>' +
    '</div>';

    h += '</form>';
    return h;
  }

  function openAuth(mode) {
    state.authMode = mode || 'login';
    state.authOpen = true;
    state.openId = null; state.publishOpen = false; state.editId = null;
    openSheet(renderAuth(state.authMode), 'sheet--form');
  }

  /* ========================= 我要参加 · 登记姓名电话 =========================
   * 点「我要参加」必须留下姓名和联系电话：组织者或群主才找得到人，
   * 也避免出现"点了一堆参加、真到现场谁也没来"的空报名。
   * ====================================================================== */

  function openJoin(id) {
    var item = getItem(id);
    if (!item) return;
    state.joinOpen = id;
    state.openId = null; state.publishOpen = false; state.editId = null;
    state.authOpen = false; state.riskOpen = null;
    openSheet(renderJoin(item), 'sheet--form');
  }

  function renderJoin(item) {
    var me = currentUser();
    var cur = joinInfo(item.id);
    var isEdit = !!cur;
    var r = topRisk(item);
    var h = '';

    h += '<div class="sheet__head">' +
      '<h2 class="sheet__title">' + (isEdit ? '修改参与信息' : '登记参加') + '</h2>' +
      '<p class="sheet__one">参加「' + esc(item.title) + '」' +
        (isEdit ? '，可以改一下你的信息。' : '需要留下姓名和联系电话。') +
        '这样组织者或群主才能联系到你。</p>' +
    '</div>';

    /* 风险项目在填信息之前再提醒一次 */
    if (r) {
      h += '<div class="riskMini riskMini--' + r.level + '">' +
        (r.level === 'high' ? '⚠️ ' : 'ℹ️ ') + esc(r.reason) +
        (r.level === 'high' ? '<br><b>建议先核实清楚再登记。</b>' : '') +
      '</div>';
    }

    h += '<form class="form" id="joinForm" data-item="' + esc(item.id) + '">';

    h += '<label class="fld"><span>参与姓名 <b>*</b></span>' +
      '<input name="jname" required maxlength="20" placeholder="填真实姓名，方便现场核对" ' +
        'value="' + esc(cur ? cur.name : (me ? me.name : '')) + '"></label>';

    h += '<label class="fld"><span>联系电话 <b>*</b></span>' +
      '<input name="jphone" required inputmode="numeric" maxlength="11" ' +
        'placeholder="11 位手机号" value="' + esc(cur ? cur.phone : '') + '">' +
      '<em class="fld__hint">只在你参加的活动里使用，用来联系你本人。</em></label>';

    h += '<label class="fld"><span>学院 / 班级（选填）</span>' +
      '<input name="jorg" maxlength="30" placeholder="例：计算机学院 2026 级" ' +
        'value="' + esc(me && me.org ? me.org : '') + '"></label>';

    h += '<label class="fld"><span>备注（选填）</span>' +
      '<input name="jnote" maxlength="40" placeholder="例：会晚到 10 分钟"></label>';

    h += '<div class="signupNote" id="joinNote"></div>';

    h += '<div class="form__acts">' +
      '<button type="button" class="btn btn--ghost" data-close-sheet="1">取消</button>' +
      '<button type="submit" class="btn btn--primary">' + (isEdit ? '保存修改' : '确认参加') + '</button>' +
    '</div>';

    if (isEdit) {
      h += '<button type="button" class="btn btn--ghost btn--wide" data-unjoin="' + esc(item.id) + '">' +
        '取消参加</button>';
    }

    h += '</form>';
    return h;
  }

  /* ========================= 风险提醒弹层 =========================
   * 在风险项目上点「报名」「收藏」「我要参加」时先弹出来，
   * 把风险讲清楚，用户确认后才继续。
   * ============================================================ */

  function openRisk(id, then) {
    var item = getItem(id);
    if (!item) return;
    state.riskOpen = id;
    state.riskThen = then;          /* 'join' | 'fav' | 'signup' */
    state.openId = null; state.publishOpen = false; state.editId = null;
    state.authOpen = false; state.joinOpen = null;
    openSheet(renderRisk(item, then), 'sheet--form');
  }

  var ACTION_NAME = { join: '我要参加', fav: '收藏', signup: '报名' };

  function renderRisk(item, then) {
    var risks = riskOf(item);
    var high = risks.some(function (r) { return r.level === 'high'; });
    var comp = completeness(item);
    var h = '';

    h += '<div class="sheet__head">' +
      '<div class="riskBadge riskBadge--' + (high ? 'high' : 'low') + '">' +
        (high ? '⚠️ 高风险信息' : 'ℹ️ 请注意') + '</div>' +
      '<h2 class="sheet__title">这条信息存在风险，确认要继续吗？</h2>' +
      '<p class="sheet__one">你正在对「' + esc(item.title) + '」执行' +
        '<b>「' + esc(ACTION_NAME[then] || '该操作') + '」</b>。</p>' +
    '</div>';

    h += '<section class="sec sec--risk sec--risk-' + (high ? 'high' : 'low') + '">' +
      '<h3>系统识别到的问题</h3>' +
      risks.map(function (r) {
        return '<p>' + esc(r.reason) + '</p>' +
          (r.advice && r.advice.length
            ? '<ul>' + r.advice.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>'
            : '');
      }).join('') +
    '</section>';

    h += '<section class="sec"><h3>这条信息的基本情况</h3><div class="kv">' +
      kvRow('发布者身份', SOURCES[item.source]
        ? SOURCES[item.source].icon + ' ' + esc(SOURCES[item.source].label) : '未注明') +
      kvRow('发布方', esc(item.sourceName || '未注明')) +
      kvRow('信息完整度', comp.score + ' / ' + comp.total + ' 项关键信息已提供') +
    '</div></section>';

    h += '<div class="riskActions">' +
      '<button type="button" class="btn btn--ghost" data-close-sheet="1">' +
        (high ? '算了，不操作了' : '先不了') + '</button>' +
      '<button type="button" class="btn btn--primary" data-riskgo="1">' +
        (high ? '我已了解风险，仍要继续' : '知道了，继续') + '</button>' +
    '</div>';

    h += '<p class="sec__desc sec__desc--tip" style="margin-top:12px">' +
      '风险提示只代表这条信息有疑点，不代表已经确认有问题。' +
      '但如果对方要求转账、索要身份证银行卡、或让你添加私人微信，请直接停止操作。</p>';

    return h;
  }

  /* ========================= 日历导出 ========================= */

  function toICS(item) {
    var s = (item.schedule || []).filter(function (x) { return x.at && !x.timeTBD; })[0];
    if (!s) return null;
    var st = new Date(s.at);
    var en = s.endAt ? new Date(s.endAt) : new Date(st.getTime() + (item.duration || 120) * 60000);

    function z(d) {
      /* Date 本身已经是一个确定的时间点，toISOString 出来的就是 UTC，
         日历里必须写 UTC，否则会按设备时区再偏移一次，活动时间直接错 8 小时。 */
      return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    }
    function fold(str) {
      return String(str).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    }

    var desc = (item.oneLiner || '') + '\\n\\n' +
      '面向：' + (item.audience || '未注明') + '\\n' +
      '报名：' + (item.needSignup === true ? '需要' : item.needSignup === false ? '不需要' : '未说明') + '\\n' +
      '来源：校园机会雷达（信息 ' + item.id + '）';

    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CampusRadar//CN', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:campus-radar-' + item.id + '@local',
      'DTSTAMP:' + z(new Date()),
      'DTSTART:' + z(st),
      'DTEND:' + z(en),
      'SUMMARY:' + fold(item.title),
      'LOCATION:' + fold(s.place || '地点未注明（见原通知）'),
      'DESCRIPTION:' + fold(desc),
      'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:提醒', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  }

  function downloadICS(item) {
    var ics = toICS(item);
    if (!ics) { toast('这条信息没有确定的活动时间，无法加入日历'); return; }
    var blob = new Blob(['\ufeff' + ics], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = item.title.replace(/[\\/:*?"<>|]/g, '') + '.ics';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    toast('日历文件已生成，用手机打开即可加入日程');
  }

  function copyItem(item) {
    var s = (item.schedule || []).filter(function (x) { return x.at; })[0];
    var txt = '【' + item.title + '】\n' +
      (item.oneLiner || '') + '\n' +
      (s ? '时间：' + fmtDateTime(s.at) + (s.endAt ? '—' + fmtTime(new Date(s.endAt)) : '') + '\n' : '') +
      (s && s.place ? '地点：' + s.place + '\n' : (s && s.placeTBD ? '地点：待确认\n' : '')) +
      ((item.deadlines || [])[0] ? (item.deadlines[0].label || '截止') + '：' +
        (item.deadlines[0].at ? fmtDateTime(item.deadlines[0].at) : item.deadlines[0].text) + '\n' : '') +
      (item.audience ? '面向：' + item.audience + '\n' : '') +
      '（来源：校园机会雷达）';

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast('已复制，可以直接粘到群里'); },
        function () { fallbackCopy(txt); });
    } else { fallbackCopy(txt); }
  }

  function fallbackCopy(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('复制失败，请手动选择'); }
    document.body.removeChild(ta);
  }

  /* ========================= Toast ========================= */

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-on'); }, 2200);
  }

  /* ========================= 主渲染 ========================= */

  function render() {
    var view = document.getElementById('view');
    if (state.tab === 'search') view.innerHTML = renderSearch();
    else if (state.tab === 'today') view.innerHTML = renderToday();
    else view.innerHTML = renderMine();

    /* tab 高亮 */
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-tab') === state.tab);
    });

    /* 顶部日期 */
    var now = currentTime();
    var dEl = document.getElementById('nowDate');
    if (dEl) {
      var real = isRealTime();
      dEl.textContent = (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + WD[now.getDay()] +
        (real ? '' : ' · 演示时间');
      dEl.classList.toggle('is-demo', !real);
    }
    document.getElementById('hdrSub').textContent =
      state.tab === 'search' ? '把散落各处的校园信息，整理成你现在就能决定的事'
      : state.tab === 'today' ? '今天和接下来几天，按时间排好'
      : '收藏、参加和发布的内容';
  }

  /* ========================= 弹层 ========================= */

  function openSheet(contentHTML, cls) {
    var root = document.getElementById('sheetRoot');
    root.innerHTML = '<div class="sheet__backdrop" data-close-sheet="1"></div>' +
      '<div class="sheet ' + (cls || '') + '" role="dialog" aria-modal="true">' +
        '<button class="sheet__close" data-close-sheet="1" aria-label="关闭">✕</button>' +
        '<div class="sheet__scroll">' + contentHTML + '</div>' +
      '</div>';
    root.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    root.querySelector('.sheet__scroll').scrollTop = 0;
  }

  function closeSheet() {
    var root = document.getElementById('sheetRoot');
    root.classList.remove('is-open');
    root.innerHTML = '';
    document.body.style.overflow = '';
    state.openId = null; state.publishOpen = false; state.editId = null; state.authOpen = false;
    state.joinOpen = null; state.riskOpen = null; state.riskThen = null; state.pendingSignup = null;
  }

  function refreshSheet() {
    if (state.riskOpen) {
      var ri = getItem(state.riskOpen);
      if (ri) openSheet(renderRisk(ri, state.riskThen), 'sheet--form');
      else closeSheet();
    } else if (state.joinOpen) {
      var ji = getItem(state.joinOpen);
      if (ji) openSheet(renderJoin(ji), 'sheet--form');
      else closeSheet();
    } else if (state.authOpen) {
      openSheet(renderAuth(state.authMode), 'sheet--form');
    } else if (state.publishOpen || state.editId) {
      var it = state.editId ? getItem(state.editId) : null;
      openSheet(renderPublish(it), 'sheet--form');
      updatePrecheck();
      var f = document.getElementById('postForm');
      if (f) f.addEventListener('input', updatePrecheck);
    } else if (state.openId) {
      var item = getItem(state.openId);
      if (item) openSheet(renderDetail(item));
      else closeSheet();
    }
  }

  /* ========================= 事件 ========================= */

  function toggleIn(arr, id) {
    var i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1); else arr.push(id);
    return arr;
  }

  /* 收藏的统一入口：风险项目要先过提醒 */
  function doFav(id) {
    toggleIn(favs, id);
    writeLS(LS.fav, favs);
    toast(favs.indexOf(id) >= 0 ? '已收藏，可在「我的」里查看' : '已取消收藏');
    render(); refreshSheet();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tab],[data-open],[data-fav],[data-join],[data-filt],[data-toggle],' +
      '[data-reset],[data-clear-q],[data-goto-today],[data-publish],[data-edit],[data-del],' +
      '[data-close-sheet],[data-base],[data-wipe],[data-ics],[data-copy],[data-fb],' +
      '[data-auth],[data-authmode],[data-delreg],[data-unsignup],[data-copyregs],[data-jump],' +
      '[data-riskgo],[data-unjoin]');
    if (!t) return;

    /* ---- 风险提醒：「继续」之后才真正执行 ---- */
    if (t.hasAttribute('data-riskgo')) {
      var rid = state.riskOpen;
      var then = state.riskThen;
      state.riskOpen = null; state.riskThen = null;
      if (!rid) { closeSheet(); return; }
      if (then === 'fav') { doFav(rid); }
      else if (then === 'join') { openJoin(rid); }
      else if (then === 'signup') {
        var pending = state.pendingSignup;
        state.pendingSignup = null;
        if (pending && pending.itemId === rid) {
          /* 表单填好的信息先存着，确认完直接落库，不用重填 */
          completeSignup(rid, pending.payload);
        } else {
          var si = getItem(rid);
          if (si) { state.openId = rid; openSheet(renderDetail(si)); }
          else closeSheet();
        }
      } else { closeSheet(); }
      return;
    }

    /* ---- 取消参加 ---- */
    if (t.hasAttribute('data-unjoin')) {
      var ujid = t.getAttribute('data-unjoin');
      if (!confirm('取消参加？你的姓名和电话会从这条记录里删掉。')) return;
      removeJoin(ujid);
      toast('已取消参加');
      closeSheet();
      render();
      return;
    }

    /* ---- 左侧项目栏：跳到对应分类 ---- */
    if (t.hasAttribute('data-jump')) {
      var target = document.getElementById(t.getAttribute('data-jump'));
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        /* 高亮当前分类，让用户知道跳到了哪 */
        Array.prototype.forEach.call(
          document.querySelectorAll('.mineSide__item'),
          function (b) { b.classList.remove('is-on'); });
        t.classList.add('is-on');
      }
      return;
    }

    /* ---- 报名名单：发布者移除某条报名 ---- */
    if (t.hasAttribute('data-delreg')) {
      var parts = t.getAttribute('data-delreg').split(':');
      var pid = parts[0], sid = parts[1];
      if (confirm('把这条报名移出名单？')) {
        setSignups(pid, signupsOf(pid).filter(function (s) { return s.id !== sid; }));
        toast('已移除');
        render(); refreshSheet();
      }
      return;
    }

    /* ---- 报名者自己取消报名 ---- */
    if (t.hasAttribute('data-unsignup')) {
      var uid = t.getAttribute('data-unsignup');
      if (!confirm('取消报名？发布者的名单里会去掉你的信息。')) return;
      removeMySignup(uid);
      toast('已取消报名');
      render(); refreshSheet();
      return;
    }

    /* ---- 复制报名名单（姓名 + 手机号）---- */
    if (t.hasAttribute('data-copyregs')) {
      var cid = t.getAttribute('data-copyregs');
      var item0 = getItem(cid);
      var regs = signupsOf(cid);
      if (!regs.length) { toast('还没有人报名'); return; }
      var lines = regs.map(function (s, i) {
        return (i + 1) + '. ' + s.name + (s.org ? '（' + s.org + '）' : '') + '  ' + s.phone;
      });
      var txt = '【' + (item0 ? item0.title : '报名名单') + '】共 ' + regs.length + ' 人\n' + lines.join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { toast('名单已复制'); },
          function () { fallbackCopy(txt); });
      } else { fallbackCopy(txt); }
      return;
    }

    /* ---- 账号 ---- */
    if (t.hasAttribute('data-authmode')) {
      state.authMode = t.getAttribute('data-authmode');
      refreshSheet();
      return;
    }
    if (t.hasAttribute('data-auth')) {
      var act = t.getAttribute('data-auth');
      if (act === 'open') { openAuth('login'); return; }
      if (act === 'logout') {
        if (!confirm('退出登录？退出后不能发布内容，已发布的内容会保留。')) return;
        try { localStorage.removeItem(LS.session); } catch (err) {}
        closeSheet();
        state.tab = 'mine';
        render();
        toast('已退出登录');
        return;
      }
    }

    /* 面板内按钮不冒泡到卡片 */
    if (t.hasAttribute('data-fav')) {
      e.stopPropagation();
      var id = t.getAttribute('data-fav');
      var favItem = getItem(id);
      /* 取消收藏不用提醒；新增收藏风险项目要先弹风险提醒 */
      if (favItem && favs.indexOf(id) < 0 && isRisky(favItem)) { openRisk(id, 'fav'); return; }
      doFav(id);
      return;
    }
    if (t.hasAttribute('data-join')) {
      e.stopPropagation();
      var jid = t.getAttribute('data-join');
      var jItem = getItem(jid);
      if (!jItem) return;
      /* 已参加过的点进来就是修改/取消，不用再提醒一遍 */
      if (isJoined(jid)) { openJoin(jid); return; }
      if (isRisky(jItem)) { openRisk(jid, 'join'); return; }
      openJoin(jid);
      return;
    }
    if (t.hasAttribute('data-ics')) { e.stopPropagation(); downloadICS(getItem(t.getAttribute('data-ics'))); return; }
    if (t.hasAttribute('data-copy')) { e.stopPropagation(); copyItem(getItem(t.getAttribute('data-copy'))); return; }
    if (t.hasAttribute('data-fb')) {
      e.stopPropagation();
      var fid = t.getAttribute('data-fb');
      feedback[fid] = true; writeLS(LS.fb, feedback);
      toast('已记录反馈，感谢帮忙核实');
      refreshSheet(); return;
    }

    if (t.hasAttribute('data-tab')) {
      state.tab = t.getAttribute('data-tab');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      render(); return;
    }

    if (t.hasAttribute('data-goto-today')) { state.tab = 'today'; render(); return; }

    if (t.hasAttribute('data-open')) {
      state.openId = t.getAttribute('data-open');
      var item = getItem(state.openId);
      if (item) openSheet(renderDetail(item));
      return;
    }

    if (t.hasAttribute('data-filt')) {
      state[t.getAttribute('data-filt')] = t.getAttribute('data-val');
      render(); return;
    }
    if (t.hasAttribute('data-toggle')) {
      var k = t.getAttribute('data-toggle');
      state[k] = !state[k];
      render(); return;
    }
    if (t.hasAttribute('data-reset')) {
      state.q = ''; state.source = 'all'; state.category = 'all';
      state.newbie = false; state.onlyActionable = false;
      render(); return;
    }
    if (t.hasAttribute('data-clear-q')) {
      state.q = '';
      var qi = document.getElementById('q');
      if (qi) { qi.value = ''; qi.focus(); }
      renderResultsOnly();
      syncClearBtn();
      return;
    }

    if (t.hasAttribute('data-publish')) {
      state.publishOpen = true; state.editId = null;
      openSheet(renderPublish(null), 'sheet--form');
      updatePrecheck();
      var f2 = document.getElementById('postForm');
      if (f2) f2.addEventListener('input', updatePrecheck);
      return;
    }
    if (t.hasAttribute('data-edit')) {
      state.editId = t.getAttribute('data-edit'); state.publishOpen = false;
      openSheet(renderPublish(getItem(state.editId)), 'sheet--form');
      updatePrecheck();
      var f3 = document.getElementById('postForm');
      if (f3) f3.addEventListener('input', updatePrecheck);
      return;
    }
    if (t.hasAttribute('data-del')) {
      var did = t.getAttribute('data-del');
      if (confirm('确定删除这条发布吗？删除后不会出现在列表里。')) {
        var posts = readLS(LS.posts, []).filter(function (p) { return p.id !== did; });
        writeLS(LS.posts, posts);
        toast('已删除');
        render();
      }
      return;
    }

    if (t.hasAttribute('data-close-sheet')) { closeSheet(); return; }

    if (t.hasAttribute('data-base')) {
      if (t.getAttribute('data-base') === 'real') {
        state.timebase = REAL;
        writeLS(LS.base, REAL);
        toast('已切换到真实时间，所有状态按现在重新推算');
      } else {
        state.timebase = DEFAULT_BASE;
        writeLS(LS.base, DEFAULT_BASE);
        toast('已锁定在 2026年9月16日');
      }
      render(); return;
    }
    if (t.hasAttribute('data-wipe')) {
      if (confirm('清空本机保存的收藏、参加标记和发布内容？')) {
        [LS.fav, LS.join, LS.posts, LS.fb].forEach(function (k) {
          try { localStorage.removeItem(k); } catch (err) {}
        });
        favs = []; feedback = {};
        toast('已清空');
        render();
      }
      return;
    }
  });

  /* 键盘操作 */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeSheet(); return; }
    if (e.key === 'Enter' && document.activeElement && document.activeElement.hasAttribute('data-open')) {
      document.activeElement.click();
    }
  });

  /* ---- 搜索输入 ----
   * 两条保护：
   *   1. 输入法组合期间（打拼音还没选字）不重绘，否则候选框会被打断，
   *      中文就打不进去。compositionend 时再补一次。
   *   2. 重绘只更新 #results，输入框本身不动，光标和输入法状态都不会丢。
   */
  var composing = false;

  document.addEventListener('compositionstart', function (e) {
    if (e.target && e.target.id === 'q') composing = true;
  });

  document.addEventListener('compositionend', function (e) {
    if (e.target && e.target.id === 'q') {
      composing = false;
      state.q = e.target.value;
      renderResultsOnly();
      syncClearBtn();
    }
  });

  document.addEventListener('input', function (e) {
    if (!e.target || e.target.id !== 'q') return;
    state.q = e.target.value;
    if (composing || e.isComposing) return;   /* 组合中：先不重绘 */
    renderResultsOnly();
    syncClearBtn();
  });

  /* 输入框右侧的 ✕ 按钮在有内容时才出现 */
  function syncClearBtn() {
    var bar = document.querySelector('.searchBar');
    var input = document.getElementById('q');
    if (!bar || !input) return;
    var btn = bar.querySelector('.search__clear');
    var has = input.value.length > 0;
    if (has && !btn) {
      btn = document.createElement('button');
      btn.className = 'search__clear';
      btn.setAttribute('data-clear-q', '1');
      btn.setAttribute('aria-label', '清空搜索');
      btn.textContent = '✕';
      bar.appendChild(btn);
    } else if (!has && btn) {
      btn.parentNode.removeChild(btn);
    }
  }

  /* 登录 / 注册表单提交 */
  document.addEventListener('submit', function (e) {
    if (!e.target || e.target.id !== 'authForm') return;
    e.preventDefault();

    var f = e.target;
    var g = function (n) { var el = f.elements[n]; return el ? String(el.value || '').trim() : ''; };
    var note = document.getElementById('authNote');
    var say = function (html, kind) {
      if (note) { note.className = 'authnote authnote--' + (kind || 'err'); note.innerHTML = html; }
    };

    var name = g('name'), pass = g('pass');
    if (!name) { say('请先填名称'); return; }
    if (pass.length < 4) { say('密码至少 4 位'); return; }

    var isReg = state.authMode === 'register';

    if (!isReg) {
      if (note) note.textContent = '正在登录…';
      loginUser(name, pass).then(function (r) {
        if (!r.ok) { say(r.msg); return; }
        closeSheet();
        state.tab = 'mine';
        render();
        toast('已登录：' + r.user.name);
      });
      return;
    }

    /* 注册 */
    if (findUser(name)) { say('这个名称已经被注册了，换一个，或者直接去登录'); return; }
    var role = (f.querySelector('input[name=role]:checked') || {}).value || 'student';
    if (role === 'college' && !g('org')) {
      say('选择「学院发布」时，请同时在下方选择所属学院');
      return;
    }

    if (note) note.textContent = '正在创建账号…';

    registerUser(name, pass, { role: role, org: g('org'), sid: g('sid') }).then(function () {
      closeSheet();
      state.tab = 'mine';
      render();
      toast('注册成功，已登录为「' + SOURCES[role].label + '」');
    }).catch(function () { say('注册失败，请重试'); });
  });

  /* 「我要参加」登记表单提交 */
  document.addEventListener('submit', function (e) {
    if (!e.target || e.target.id !== 'joinForm') return;
    e.preventDefault();

    var f = e.target;
    var itemId = f.getAttribute('data-item');
    var g = function (n) { var el = f.elements[n]; return el ? String(el.value || '').trim() : ''; };
    var note = document.getElementById('joinNote');
    var say = function (msg) {
      if (note) { note.className = 'signupNote signupNote--err'; note.textContent = msg; }
    };

    var name = g('jname');
    var phone = g('jphone');
    if (!name) { say('请填写参与姓名'); return; }
    if (!validPhone(phone)) { say('手机号格式不对，请填 11 位手机号（1 开头）'); return; }

    setJoin(itemId, {
      name: name,
      phone: phone,
      org: g('jorg'),
      note: g('jnote'),
      at: new Date().toISOString()
    });

    closeSheet();
    state.tab = 'mine';
    render();
    toast('已登记参加，姓名和电话已记录');
  });

  /* 报名表单提交 */
  document.addEventListener('submit', function (e) {
    if (!e.target || e.target.id !== 'signupForm') return;
    e.preventDefault();

    var f = e.target;
    var itemId = f.getAttribute('data-item');
    var g = function (n) { var el = f.elements[n]; return el ? String(el.value || '').trim() : ''; };
    var note = document.getElementById('signupNote');
    var say = function (msg) { if (note) { note.className = 'signupNote signupNote--err'; note.textContent = msg; } };

    var me = currentUser();
    if (!me) { closeSheet(); openAuth('login'); toast('报名前需要先登录'); return; }

    var item = getItem(itemId);
    if (!item) { say('这条内容已经不在了'); return; }

    var name = g('sname'), phone = g('sphone');
    if (!name) { say('请填写姓名'); return; }
    if (!validPhone(phone)) { say('手机号格式不对，请填 11 位手机号（1 开头）'); return; }
    if (mySignup(itemId)) { say('你已经报过名了'); return; }

    var payload = { name: name, phone: phone, org: g('sorg'), account: me.name };

    /* 风险项目：先弹提醒，用户确认后再落库。填好的信息先存着，别让人重填。 */
    if (isRisky(item)) {
      state.pendingSignup = { itemId: itemId, payload: payload };
      openRisk(itemId, 'signup');
      return;
    }

    completeSignup(itemId, payload);
  });

  /* 真正写入报名记录 */
  function completeSignup(itemId, payload) {
    if (mySignup(itemId)) return;
    addSignup(itemId, {
      id: 'R' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: payload.name,
      phone: payload.phone,
      org: payload.org || '',
      account: payload.account,
      at: new Date().toISOString()
    });
    toast('报名成功，发布者能看到你的姓名和手机号');
    state.openId = itemId;
    render(); refreshSheet();
  }

  /* 发布表单提交 */
  document.addEventListener('submit', function (e) {
    if (!e.target || e.target.id !== 'postForm') return;
    e.preventDefault();

    var f = e.target;
    var g = function (n) { var el = f.elements[n]; return el ? String(el.value || '').trim() : ''; };

    /* ---- 发布必须先确认身份 ---- */
    var me = currentUser();
    if (!me) { closeSheet(); openAuth('login'); toast('发布前需要先登录，确认发布者身份'); return; }

    /* ---- 三项必填，缺一不可 ---- */
    var cat = g('category');
    var title = g('title');
    var content = g('content');
    var dl = g('deadline');
    var lack = [];
    if (!cat) lack.push('门类');
    if (!title) lack.push('标题');
    if (!content) lack.push('发布内容');
    if (!dl) lack.push('截止时间');
    if (lack.length) { toast('还差：' + lack.join('、')); return; }

    var lackConfirm = f.elements.confirmIdentity && !f.elements.confirmIdentity.checked;
    if (lackConfirm) { toast('请先勾选「我确认以上内容由本人发布」'); return; }

    /* 内容审核：命中风险词一律不放行，提示改哪里 */
    var mod = checkFields({
      '标题': title, '发布内容': content, '联系方式': g('contact')
    });
    if (!mod.ok) {
      updatePrecheck();
      var box0 = document.getElementById('precheck');
      if (box0 && box0.scrollIntoView) box0.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('有 ' + mod.hits.length + ' 处风险表述，改掉之后才能发布');
      return;
    }

    var startAt = g('startAt');
    var place = g('place');
    var need = (f.querySelector('input[name=needSignup]:checked') || {}).value;

    /* 补充信息没填的，如实记下来，展示时会提示同学去确认 */
    var missing = [];
    if (!startAt) missing.push('活动时间');
    if (!place) missing.push('地点');
    if (!g('fee')) missing.push('费用');
    if (!g('contact')) missing.push('联系方式');
    if (!g('audience')) missing.push('面向对象');

    var isEdit = !!state.editId;
    var id = isEdit ? state.editId : 'U' + Date.now().toString(36);

    /* 发布者身份带上：谁发的、属于哪一类、单位是什么 */
    var role = me.role || 'student';
    var author = { name: me.name, role: role, org: me.org || '', sid: me.sid || '' };

    var item = {
      id: id,
      title: title,
      content: content,
      source: role,                       /* 学校 / 学院 / 老师 / 同学 四类之一 */
      sourceName: me.org ? me.name + '（' + me.org + '）' : me.name,
      category: cat,
      tags: [],
      oneLiner: content.replace(/\s+/g, ' ').slice(0, 60),
      schedule: startAt ? [{
        label: '活动时间',
        at: new Date(startAt).toISOString(),
        place: place || null,
        placeTBD: !place
      }] : [],
      deadlines: [{ label: '报名截止', at: new Date(dl).toISOString() }],
      audience: g('audience') || '未注明',
      zeroBase: null,
      needSignup: need === 'yes' ? true : need === 'no' ? false : null,
      fee: g('fee') || null,
      commitment: null,
      capacity: g('capacity') ? Number(g('capacity')) : null,
      contact: g('contact') || null,
      missing: missing,
      author: author,
      verified: true,                     /* 已登录并勾选确认，算身份已确认 */
      raw: '【' + SOURCES[role].label + '】' + me.name + (me.org ? '（' + me.org + '）' : '') +
        '：' + content +
        (startAt ? '；活动时间 ' + fmtDateTime(new Date(startAt).toISOString()) : '') +
        (place ? '；地点 ' + place : '') +
        '；截止 ' + fmtDateTime(new Date(dl).toISOString()) +
        (g('contact') ? '；联系方式 ' + g('contact') : ''),
      userPost: true,
      createdAt: new Date().toISOString()
    };

    /* 只有同学自主发布才自动挂风险提示；学院/学校/老师发布不预设风险 */
    if (role === 'student' && missing.length) {
      item.risk = {
        level: 'low',
        reason: '这条由同学自行发布，发布时未填写：' + missing.join('、') + '。内容未经核实，请注意甄别。',
        advice: ['信息为同学自行发布，参与前建议先与发布者确认']
      };
    }

    var posts = readLS(LS.posts, []).filter(function (p) { return p.id !== id; });
    posts.unshift(item);
    writeLS(LS.posts, posts);

    closeSheet();
    state.tab = 'search';
    /* 清掉搜索词和筛选：否则刚发的内容可能被当前的筛选条件挡住，
       用户会以为没发成功。同时整页重绘，概览里的条数跟着一起涨。 */
    state.q = '';
    state.category = 'all';
    state.source = 'all';
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    var total = allItems().length;
    toast('发布成功，现在共有 ' + total + ' 条信息' +
      (missing.length ? '（有 ' + missing.length + ' 项补充信息没填）' : ''));
  });

  /* ========================= 启动 ========================= */

  /* 暴露给自测脚本用（不影响页面本身） */
  window.__campusRadar = {
    render: render, statusOf: statusOf, allItems: allItems, completeness: completeness,
    newbieFit: newbieFit, state: state, renderDetail: renderDetail, toICS: toICS,
    deadlineBuckets: deadlineBuckets, countdownText: countdownText, renderAuth: renderAuth,
    registerUser: registerUser, loginUser: loginUser, currentUser: currentUser,
    publisherLine: publisherLine, catChip: catChip, searchText: searchText,
    signupsOf: signupsOf, addSignup: addSignup, mySignup: mySignup, validPhone: validPhone,
    signupSection: signupSection, regPanel: regPanel, renderSearch: renderSearch,
    renderResults: renderResults, visibleItems: visibleItems, renderResultsOnly: renderResultsOnly,
    favs: favs, hl: hl, byUrgency: byUrgency, isJoined: isJoined, joinInfo: joinInfo,
    isRealTime: isRealTime, DEFAULT_BASE: DEFAULT_BASE, initialTimebase: initialTimebase,
    setJoin: setJoin, removeJoin: removeJoin, joinIds: joinIds,
    riskOf: riskOf, isRisky: isRisky, topRisk: topRisk, renderJoin: renderJoin, renderRisk: renderRisk,
    RAW_ITEMS: RAW_ITEMS
  };

  render();

  /* 每分钟刷新一次状态，避免页面开着不动时状态过期 */
  setInterval(function () {
    if (!state.openId && !state.publishOpen && !state.editId) render();
  }, 60000);
})();
