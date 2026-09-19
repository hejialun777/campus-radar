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
    fb: 'cr_feedback'
  };

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
    var base = state.timebase;
    return base ? new Date(base) : new Date();
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
    if (item.zeroBase === null && (item.missing || []).length >= 3) {
      return { key: 'warn', label: '信息不明，需先确认', icon: '⚠️' };
    }
    if (item.zeroBase === null) {
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
    tab: 'radar',
    q: '',
    source: 'all',
    category: 'all',
    newbie: false,
    onlyActionable: false,
    timebase: readLS(LS.base, null),
    openId: null,
    publishOpen: false,
    editId: null,
    settingsOpen: false,
    toast: null
  };

  var favs = readLS(LS.fav, []);
  var joins = readLS(LS.join, []);
  var feedback = readLS(LS.fb, {});

  /* ========================= 过滤 ========================= */

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

      if (q) {
        var hay = [it.title, it.oneLiner, it.audience, (it.tags || []).join(' '),
          it.raw, (it.publisher || '')].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
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
    var meta = SOURCE_META[item.source] || SOURCE_META.org;
    return '<span class="chip chip--src chip--src-' + item.source + '">' +
      meta.icon + ' ' + esc(meta.short) + '</span>';
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
    var isJoin = joins.indexOf(item.id) >= 0;
    var updates = (item.updates || []).length;
    var risk = item.risk && item.risk.level === 'high';

    var cls = 'card';
    if (risk) cls += ' card--risky';
    if (st.tone === 'urgent' || st.tone === 'live') cls += ' card--hot';

    return '' +
      '<article class="' + cls + '" data-open="' + esc(item.id) + '" tabindex="0" role="button">' +
        '<div class="card__top">' +
          statusChip(st) +
          sourceChip(item) +
          (updates ? '<span class="chip chip--merged">🔗 已合并 ' + updates + ' 条后续通知</span>' : '') +
          (item.userPost ? '<span class="chip chip--mine">我发布的</span>' : '') +
        '</div>' +
        '<h3 class="card__title">' + esc(item.title) + '</h3>' +
        '<p class="card__one">' + esc(item.oneLiner || '') + '</p>' +
        '<div class="card__facts">' + factLine(item) + '</div>' +
        '<div class="card__bottom">' +
          '<span class="fit fit--' + fit.key + '">' + fit.icon + ' ' + esc(fit.label) + '</span>' +
          '<div class="card__acts">' +
            '<button class="iconbtn' + (isJoin ? ' is-on' : '') + '" data-join="' + esc(item.id) + '" ' +
              'title="标记我要参加" aria-label="标记我要参加">' + (isJoin ? '✅' : '🎯') + '</button>' +
            '<button class="iconbtn' + (isFav ? ' is-on' : '') + '" data-fav="' + esc(item.id) + '" ' +
              'title="收藏" aria-label="收藏">' + (isFav ? '⭐' : '☆') + '</button>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  /* ========================= 渲染：雷达页 ========================= */

  function renderRadar() {
    var now = currentTime();
    var list = visibleItems();
    var all = allItems();

    /* 顶部提醒条：把最容易错过的信息顶到眼前 */
    var closing = all.filter(function (it) { return statusOf(it, now).key === 'closing'; });
    var todayLive = all.filter(function (it) {
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

    /* 类别统计 */
    var catCount = {};
    all.forEach(function (it) { catCount[it.category] = (catCount[it.category] || 0) + 1; });
    var mergedCount = RAW_ITEMS.filter(function (r) { return r.mergedInto; }).length;
    var lowQuality = all.filter(function (it) {
      return completeness(it).score <= 2 || (it.risk && it.risk.level === 'high');
    }).length;

    var html = '';

    html += '<div class="alerts">' + alerts.join('') + '</div>';

    /* 概览 */
    html += '<div class="summary">' +
      '<div class="summary__item"><b>' + all.length + '</b><span>条信息</span></div>' +
      '<div class="summary__item"><b>' + mergedCount + '</b><span>条已合并</span></div>' +
      '<div class="summary__item"><b>' + lowQuality + '</b><span>条信息不全/存疑</span></div>' +
      '<div class="summary__item"><b>' + (catCount.competition || 0) + '</b><span>个竞赛</span></div>' +
    '</div>';

    /* 筛选 */
    html += '<div class="filters">';
    html += '<div class="search">' +
      '<span class="search__icon">🔍</span>' +
      '<input id="q" type="search" placeholder="搜活动、搜关键词，比如「零基础」「Git」" value="' + esc(state.q) + '">' +
      (state.q ? '<button class="search__clear" data-clear-q="1" aria-label="清空">✕</button>' : '') +
      '</div>';

    html += '<div class="chiprow" role="group" aria-label="来源筛选">';
    html += filtChip('source', 'all', '全部来源');
    ['official', 'org', 'student'].forEach(function (s) {
      html += filtChip('source', s, SOURCE_META[s].icon + ' ' + SOURCE_META[s].short);
    });
    html += '</div>';

    html += '<div class="chiprow" role="group" aria-label="类型筛选">';
    html += filtChip('category', 'all', '全部类型');
    Object.keys(CATEGORY_META).forEach(function (c) {
      if (!catCount[c]) return;
      html += filtChip('category', c, CATEGORY_META[c].icon + ' ' + CATEGORY_META[c].label);
    });
    html += '</div>';

    html += '<div class="chiprow chiprow--toggle">' +
      '<button class="toggle' + (state.newbie ? ' is-on' : '') + '" data-toggle="newbie">' +
        '<span class="toggle__dot"></span>新生模式' +
        '<em>只看新生能参加的</em></button>' +
      '<button class="toggle' + (state.onlyActionable ? ' is-on' : '') + '" data-toggle="onlyActionable">' +
        '<span class="toggle__dot"></span>只看还能参加' +
        '<em>隐藏已截止和已结束</em></button>' +
      '</div>';

    html += '</div>';

    /* 列表 */
    if (!list.length) {
      html += '<div class="empty">' +
        '<div class="empty__icon">🫥</div>' +
        '<p>没有符合条件的信息</p>' +
        '<button class="btn btn--ghost" data-reset="1">清空筛选条件</button>' +
        '</div>';
    } else {
      var groups = groupByTier(list, now);
      groups.forEach(function (g) {
        html += '<section class="group">' +
          '<h2 class="group__title">' + g.title +
            (g.note ? '<span class="group__note">' + g.note + '</span>' : '') + '</h2>' +
          '<div class="cards">' + g.items.map(function (it) {
            return cardHTML(it, statusOf(it, now));
          }).join('') + '</div></section>';
      });
    }

    return html;
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

    html += '<div class="mineHead">' +
      '<div><h2>我的</h2><p>收藏、已报名和发布的内容都存在这台设备上，关掉页面再打开还在。</p></div>' +
      '<button class="btn btn--primary" data-publish="1">＋ 发布活动</button>' +
    '</div>';

    var mine = allItems().filter(function (it) {
      return favs.indexOf(it.id) >= 0 || joins.indexOf(it.id) >= 0 || it.userPost;
    });

    /* 日程：只保留还没发生的，按时间排 */
    var schedule = mine.filter(function (it) {
      var st = statusOf(it, now);
      return ['live', 'today', 'open', 'closing', 'upcoming', 'standby'].indexOf(st.key) >= 0;
    }).sort(function (a, b) {
      var ta = statusOf(a, now).deadline ? statusOf(a, now).deadline.t : (nextEventTime(a) || Infinity);
      var tb = statusOf(b, now).deadline ? statusOf(b, now).deadline.t : (nextEventTime(b) || Infinity);
      return ta - tb;
    });

    html += '<section class="group"><h2 class="group__title">📋 我的日程<em>收藏或标记了「我要参加」的，按时间排</em></h2>';
    if (!schedule.length) {
      html += '<div class="empty empty--sm">还没有收藏任何活动。在列表里点 ☆ 或 🎯 就会出现在这里。</div>';
    } else {
      html += '<div class="cards">' + schedule.map(function (it) {
        return cardHTML(it, statusOf(it, now));
      }).join('') + '</div>';
    }
    html += '</section>';

    /* 我发布的 */
    var posts = allItems().filter(function (it) { return it.userPost; });
    html += '<section class="group"><h2 class="group__title">🙋 我发布的<em>发布后会进入正常浏览流程，其他人也能看到</em></h2>';
    if (!posts.length) {
      html += '<div class="empty empty--sm">还没有发布过内容。同学可以发约球、找搭子、组队这类信息。</div>';
    } else {
      html += '<div class="cards">' + posts.map(function (it) {
        return '<div class="cardWrap">' + cardHTML(it, statusOf(it, now)) +
          '<div class="cardWrap__tools">' +
            '<button class="mini" data-edit="' + esc(it.id) + '">编辑</button>' +
            '<button class="mini mini--danger" data-del="' + esc(it.id) + '">删除</button>' +
          '</div></div>';
      }).join('') + '</div>';
    }
    html += '</section>';

    /* 设置 */
    html += '<section class="group"><h2 class="group__title">⚙️ 设置</h2>' +
      '<div class="settings">' +
        '<div class="settings__row">' +
          '<div><b>时间基准</b><p>所有状态都是按这个时间点推算的。默认跟随真实时间，方便看到当下最真实的效果。</p></div>' +
          '<div class="settings__ctrl">' +
            '<button class="mini' + (!state.timebase ? ' is-on' : '') + '" data-base="real">真实时间</button>' +
            '<button class="mini' + (state.timebase ? ' is-on' : '') + '" data-base="exam">锁定 9月19日 14:00</button>' +
          '</div>' +
        '</div>' +
        '<div class="settings__row">' +
          '<div><b>清空本地数据</b><p>删除收藏、已报名标记和我发布的内容。</p></div>' +
          '<div class="settings__ctrl"><button class="mini mini--danger" data-wipe="1">清空</button></div>' +
        '</div>' +
      '</div>' +
    '</section>';

    html += '<footer class="foot">校园机会雷达 · 珠海科技学院计算机协会软件部 2026 秋季纳新第二轮考核作品<br>' +
      '页面信息均来自考核题目提供的模拟材料，不代表学校真实通知。未注明的事实一律标注为「未注明」，不做推测。</footer>';

    return html;
  }

  /* ========================= 详情弹层 ========================= */

  function renderDetail(item) {
    var now = currentTime();
    var st = statusOf(item, now);
    var fit = newbieFit(item);
    var comp = completeness(item);
    var isFav = favs.indexOf(item.id) >= 0;
    var isJoin = joins.indexOf(item.id) >= 0;
    var meta = SOURCE_META[item.source] || SOURCE_META.org;
    var cat = CATEGORY_META[item.category] || { label: '其他', icon: '📄' };

    var h = '';

    h += '<div class="sheet__head">' +
      '<div class="sheet__chips">' + statusChip(st) + sourceChip(item) +
        '<span class="chip chip--cat">' + cat.icon + ' ' + esc(cat.label) + '</span>' +
      '</div>' +
      '<h2 class="sheet__title">' + esc(item.title) + '</h2>' +
      (item.sourceName ? '<p class="sheet__pub">发布方：' + esc(item.sourceName) + '</p>' : '') +
      '<p class="sheet__one">' + esc(item.oneLiner || '') + '</p>' +
    '</div>';

    h += '<div class="sheet__acts">' +
      '<button class="btn ' + (isJoin ? 'btn--primary' : 'btn--ghost') + '" data-join="' + esc(item.id) + '">' +
        (isJoin ? '✅ 已标记参加' : '🎯 我要参加') + '</button>' +
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
            (s.past ? ' <span class="tbd">已结束</span>' : '') +
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

  function hasCalendarTime(item) {
    return (item.schedule || []).some(function (s) { return s.at && !s.timeTBD && !s.past; });
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
      id: '', title: '', category: 'interest', source: 'student',
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

    var h = '';
    h += '<div class="sheet__head">' +
      '<h2 class="sheet__title">' + (isEdit ? '编辑我发布的活动' : '发布活动 / 招募') + '</h2>' +
      '<p class="sheet__one">同学之间约球、找搭子、组队都可以发。发布后会直接出现在活动列表里，其他同学也能看到。</p>' +
    '</div>';

    h += '<form class="form" id="postForm">';
    h += '<label class="fld"><span>标题 <b>*</b></span>' +
      '<input name="title" required maxlength="40" placeholder="例：周末羽毛球约球" value="' + esc(item.title) + '"></label>';

    h += '<label class="fld"><span>一句话说明</span>' +
      '<input name="oneLiner" maxlength="60" placeholder="用一句话讲清楚这件事，比如：周六下午打球，6—8人，费用AA" value="' + esc(item.oneLiner) + '"></label>';

    h += '<label class="fld"><span>类型</span><select name="category">' +
      Object.keys(CATEGORY_META).map(function (c) {
        return '<option value="' + c + '"' + (item.category === c ? ' selected' : '') + '>' +
          CATEGORY_META[c].icon + ' ' + CATEGORY_META[c].label + '</option>';
      }).join('') + '</select></label>';

    h += '<label class="fld"><span>活动时间</span>' +
      '<input type="datetime-local" name="startAt" value="' + toLocalInput(s0.at) + '"></label>';

    h += '<label class="fld"><span>地点</span>' +
      '<input name="place" maxlength="30" placeholder="例：体育馆3号场" value="' + esc(s0.place || '') + '"></label>';

    h += '<label class="fld"><span>面向对象</span>' +
      '<input name="audience" maxlength="20" placeholder="例：全校学生" value="' + esc(item.audience || '全校学生') + '"></label>';

    h += '<div class="fld fld--radios"><span>需要报名吗</span><div class="radios">' +
      [['yes', '需要报名', item.needSignup === true],
       ['no', '不用报名', item.needSignup === false],
       ['unknown', '还没想好/暂不说明', item.needSignup === null || item.needSignup === undefined]]
        .map(function (r) {
          return '<label class="radio"><input type="radio" name="needSignup" value="' + r[0] + '"' +
            (r[2] ? ' checked' : '') + '><span>' + r[1] + '</span></label>';
        }).join('') + '</div></div>';

    h += '<label class="fld"><span>报名截止时间</span>' +
      '<input type="datetime-local" name="deadline" value="' + toLocalInput(d0.at) + '"></label>';

    h += '<div class="fld fld--2col">' +
      '<label class="fld"><span>费用</span>' +
        '<input name="fee" maxlength="20" placeholder="例：AA / 免费 / 每人20元" value="' + esc(item.fee || '') + '"></label>' +
      '<label class="fld"><span>时间投入</span>' +
        '<input name="commitment" maxlength="20" placeholder="例：每周约3小时" value="' + esc(item.commitment || '') + '"></label>' +
    '</div>';

    h += '<div class="fld fld--2col">' +
      '<label class="fld"><span>人数上限</span>' +
        '<input name="capacity" type="number" min="1" max="999" placeholder="例：8" value="' + esc(item.capacity || '') + '"></label>' +
      '<label class="fld"><span>联系方式</span>' +
        '<input name="contact" maxlength="40" placeholder="例：微信号 / 群号" value="' + esc(item.contact || '') + '"></label>' +
    '</div>';

    /* 发布时的完整度自检：填得越全，同学越找得到 */
    h += '<div class="precheck" id="precheck"></div>';

    h += '<div class="form__acts">' +
      '<button type="button" class="btn btn--ghost" data-close-sheet="1">取消</button>' +
      '<button type="submit" class="btn btn--primary">' + (isEdit ? '保存修改' : '发布') + '</button>' +
    '</div>';

    h += '</form>';
    return h;
  }

  /* 实时自检 */
  function updatePrecheck() {
    var box = document.getElementById('precheck');
    if (!box) return;
    var f = document.getElementById('postForm');
    if (!f) return;
    var g = function (n) { var el = f.elements[n]; return el ? String(el.value || '').trim() : ''; };
    var need = [
      { k: '标题', ok: !!g('title') },
      { k: '活动时间', ok: !!g('startAt') },
      { k: '地点', ok: !!g('place') },
      { k: '面向对象', ok: !!g('audience') },
      { k: '费用', ok: !!g('fee') },
      { k: '联系方式', ok: !!g('contact') }
    ];
    var miss = need.filter(function (n) { return !n.ok; }).map(function (n) { return n.k; });
    var done = need.length - miss.length;

    box.innerHTML = '<div class="precheck__bar"><i style="width:' + Math.round(done / need.length * 100) + '%"></i></div>' +
      '<p>' + (miss.length
        ? '还有 <b>' + miss.join('、') + '</b> 没填。这些不填的话，同学看到之后还得再来问你一次。'
        : '👌 关键信息都齐了，同学可以直接判断要不要参加。') + '</p>';
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
    if (state.tab === 'radar') view.innerHTML = renderRadar();
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
      var isReal = !state.timebase;
      dEl.textContent = (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + WD[now.getDay()] +
        (isReal ? '' : ' · 演示时间');
      dEl.classList.toggle('is-demo', !isReal);
    }
    document.getElementById('hdrSub').textContent =
      state.tab === 'radar' ? '把散落各处的校园信息，整理成你现在就能决定的事'
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
    state.openId = null; state.publishOpen = false; state.editId = null;
  }

  function refreshSheet() {
    if (state.publishOpen || state.editId) {
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

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tab],[data-open],[data-fav],[data-join],[data-filt],[data-toggle],' +
      '[data-reset],[data-clear-q],[data-goto-today],[data-publish],[data-edit],[data-del],' +
      '[data-close-sheet],[data-base],[data-wipe],[data-ics],[data-copy],[data-fb]');
    if (!t) return;

    /* 面板内按钮不冒泡到卡片 */
    if (t.hasAttribute('data-fav')) {
      e.stopPropagation();
      var id = t.getAttribute('data-fav');
      toggleIn(favs, id); writeLS(LS.fav, favs);
      toast(favs.indexOf(id) >= 0 ? '已收藏，可在「我的」里查看' : '已取消收藏');
      render(); refreshSheet(); return;
    }
    if (t.hasAttribute('data-join')) {
      e.stopPropagation();
      var jid = t.getAttribute('data-join');
      toggleIn(joins, jid); writeLS(LS.join, joins);
      toast(joins.indexOf(jid) >= 0 ? '已标记参加，可在「我的」里查看' : '已取消标记');
      render(); refreshSheet(); return;
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
      state.q = ''; render();
      var qi = document.getElementById('q'); if (qi) qi.focus();
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
        state.timebase = null; writeLS(LS.base, null);
        try { localStorage.removeItem(LS.base); } catch (err) {}
      } else {
        state.timebase = '2026-09-19T14:00:00';
        writeLS(LS.base, state.timebase);
      }
      toast('时间基准已更新，所有状态重新推算');
      render(); return;
    }
    if (t.hasAttribute('data-wipe')) {
      if (confirm('清空本机保存的收藏、参加标记和发布内容？')) {
        [LS.fav, LS.join, LS.posts, LS.fb].forEach(function (k) {
          try { localStorage.removeItem(k); } catch (err) {}
        });
        favs = []; joins = []; feedback = {};
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

  /* 搜索输入 */
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'q') {
      state.q = e.target.value;
      var pos = e.target.selectionStart;
      render();
      var qi = document.getElementById('q');
      if (qi) { qi.focus(); try { qi.setSelectionRange(pos, pos); } catch (err) {} }
    }
  });

  /* 发布表单提交 */
  document.addEventListener('submit', function (e) {
    if (!e.target || e.target.id !== 'postForm') return;
    e.preventDefault();

    var f = e.target;
    var g = function (n) { var el = f.elements[n]; return el ? String(el.value || '').trim() : ''; };
    var title = g('title');
    if (!title) { toast('请先填写标题'); return; }

    var startAt = g('startAt');
    var place = g('place');
    var dl = g('deadline');
    var need = (f.querySelector('input[name=needSignup]:checked') || {}).value;

    var missing = [];
    if (!startAt) missing.push('活动时间');
    if (!place) missing.push('地点');
    if (!g('fee')) missing.push('费用');
    if (!g('contact')) missing.push('联系方式');
    if (need === 'yes' && !dl) missing.push('报名截止时间');

    var isEdit = !!state.editId;
    var id = isEdit ? state.editId : 'U' + Date.now().toString(36);

    var item = {
      id: id,
      title: title,
      source: 'student',
      sourceName: '我发布',
      category: g('category') || 'interest',
      oneLiner: g('oneLiner') || ('我发布的' + (CATEGORY_META[g('category')] || {}).label + '信息'),
      tags: [],
      schedule: startAt ? [{
        label: '活动时间',
        at: new Date(startAt).toISOString(),
        place: place || null,
        placeTBD: !place
      }] : [],
      deadlines: dl ? [{ label: '报名截止', at: new Date(dl).toISOString() }] : [],
      audience: g('audience') || '未注明',
      zeroBase: null,
      needSignup: need === 'yes' ? true : need === 'no' ? false : null,
      fee: g('fee') || null,
      commitment: g('commitment') || null,
      capacity: g('capacity') ? Number(g('capacity')) : null,
      contact: g('contact') || null,
      missing: missing,
      raw: '【学生自主发布 · 未核实】' + title +
        (startAt ? '；时间 ' + fmtDateTime(new Date(startAt).toISOString()) : '') +
        (place ? '；地点 ' + place : '') +
        (g('contact') ? '；联系方式 ' + g('contact') : ''),
      userPost: true,
      createdAt: new Date().toISOString()
    };

    if (missing.length) {
      item.risk = {
        level: 'low',
        reason: '这条由学生发布，发布时未填写：' + missing.join('、') + '。内容未经核实，请注意甄别。',
        advice: ['信息为同学自行发布，参与前建议先与发布者确认']
      };
    }

    var posts = readLS(LS.posts, []).filter(function (p) { return p.id !== id; });
    posts.unshift(item);
    writeLS(LS.posts, posts);

    closeSheet();
    state.tab = 'radar';
    render();
    toast(missing.length
      ? '已发布。有 ' + missing.length + ' 项信息没填，页面上会提示同学注意'
      : '发布成功，已经出现在列表里了');
  });

  /* ========================= 启动 ========================= */

  /* 暴露给自测脚本用（不影响页面本身） */
  window.__campusRadar = {
    render: render, statusOf: statusOf, allItems: allItems, completeness: completeness,
    newbieFit: newbieFit, state: state, renderDetail: renderDetail, toICS: toICS,
    RAW_ITEMS: RAW_ITEMS
  };

  render();

  /* 每分钟刷新一次状态，避免页面开着不动时状态过期 */
  setInterval(function () {
    if (!state.openId && !state.publishOpen && !state.editId) render();
  }, 60000);
})();
