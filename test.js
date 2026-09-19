/* ============================================================================
 * 自测脚本（node test.js）
 * ----------------------------------------------------------------------------
 * 用最小的 DOM 桩把页面逻辑跑起来，验证：
 *   1. 26 条信息在 2026-09-19 14:00 这个时间基准下的状态判断是否正确
 *   2. 补充通知（09、20）是否已被合并、不再单独出现
 *   3. 三个页签、详情弹层、日历导出是否都能正常渲染不报错
 * 不是单元测试框架，就是一次跑完的冒烟检查。
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;

/* ---------- 最小 DOM 桩 ---------- */
function makeEl(id) {
  const el = {
    id, _html: '', textContent: '', style: {}, dataset: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    addEventListener() {}, removeEventListener() {}, focus() {}, click() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, getAttribute() { return null; }, hasAttribute() { return false; },
    appendChild() {}, removeChild() {}, setSelectionRange() {}, select() {},
    elements: new Proxy({}, { get: () => ({ value: '', checked: false }) }),
    scrollTop: 0, selectionStart: 0
  };
  return el;
}

const els = {};
function getEl(id) { return (els[id] = els[id] || makeEl(id)); }

const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};

const document = {
  getElementById: getEl,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: makeEl,
  body: { style: {}, appendChild() {}, removeChild() {} },
  activeElement: null
};

const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
  document, localStorage, Promise,
  navigator: {},
  location: { href: '' },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  Blob: function () {},
  /* 不提供 crypto.subtle，让 hashPassword 走弱散列回退分支，
     正好覆盖「file:// 等不安全上下文下也能用」这条路径 */
  crypto: {},
  Math, Date, JSON, String, Number, Array, Object, Proxy, isNaN, parseInt, parseFloat, Infinity
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
sandbox.window.confirm = () => true;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8'), sandbox, { filename: 'data.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/moderation.js'), 'utf8'), sandbox, { filename: 'moderation.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8'), sandbox, { filename: 'app.js' });

const R = sandbox.window.__campusRadar;

/* ---------- 断言小工具 ---------- */
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + (extra ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n\x1b[1m' + t + '\x1b[0m'); }

/* 锁定时间基准：数据的时间背景 2026-09-19 14:00 */
R.state.timebase = '2026-09-19T14:00:00';
const NOW = new Date(R.state.timebase);

/* ===================== 1. 状态推断 ===================== */
section('1. 时间状态推断（时间基准 2026-09-19 14:00，周六）');

const expect = {
  '01': 'open',     // 9/24 截止，还有 5 天
  '02': 'today',    // 今晚 19:00
  '03': 'open',     // 9/22 截止
  '04': 'replay',   // 直播已结束，等回放
  '05': 'closing',  // 9/20 12:00 截止，不到 24 小时
  '06': 'upcoming', // 报名截止未注明，只能按开班时间 9/23 提示
  '07': 'open',     // 9/21 18:00 意向登记，还有 2 天多
  '08': 'ongoing',  // 长期招募
  '10': 'today',    // 今天 15:00
  '11': 'upcoming', // 9/21 开讲，未注明是否需报名
  '12': 'open',     // 10/5
  '13': 'open',     // 9/21
  '14': 'upcoming', // 9/21 开课，预约截止未注明
  '15': 'open',     // 9/23
  '16': 'ongoing',  // 长期招募
  '17': 'open',     // 网盘有效期 9/22
  '18': 'today',    // 今天 19:30
  '19': 'standby',  // 报名已截止但可候补
  '21': 'upcoming', // 9/20 19:00，无截止时间
  '22': 'upcoming', // 9/20 16:00
  '23': 'upcoming', // 9/21 晚
  '26': 'upcoming'  // 9/21 15:00
};

Object.keys(expect).sort().forEach(id => {
  const it = R.allItems().filter(x => x.id === id)[0];
  if (!it) return check(id + ' 存在', false, '找不到该条目');
  const st = R.statusOf(it, NOW);
  check(id + ' ' + it.title.slice(0, 14) + ' → ' + st.label,
    st.key === expect[id], '期望 ' + expect[id] + '，实际 ' + st.key + '（' + st.label + '）');
});

/* 9月20日的三条：到了明天应该变成 today */
const n20 = new Date('2026-09-20T10:00:00');
['21', '22'].forEach(id => {
  const it = R.allItems().filter(x => x.id === id)[0];
  const st = R.statusOf(it, n20);
  check('时间推进到 9/20 后，' + id + ' 变成 today', st.key === 'today', '实际 ' + st.key);
});

/* 9月25日：只有单一截止时间的活动应该已经报不上了 */
const n25 = new Date('2026-09-25T10:00:00');
['01', '03', '05', '13', '14'].forEach(id => {
  const it = R.allItems().filter(x => x.id === id)[0];
  const st = R.statusOf(it, n25);
  check('时间推进到 9/25 后，' + id + ' 已不能报名',
    ['expired', 'ended'].includes(st.key), '实际 ' + st.key + '（' + st.label + '）');
});

/* 07、15 是「两个节点」的活动：近的那个过了，远的还在，应当保持可参与 */
['07', '15'].forEach(id => {
  const it = R.allItems().filter(x => x.id === id)[0];
  const st = R.statusOf(it, n25);
  check(id + ' 在 9/25 仍可参与（下一个节点还没到）',
    st.key === 'open' && st.deadline && st.deadline.t > n25.getTime(),
    '实际 ' + st.key + '：' + (st.deadline ? new Date(st.deadline.d.at).toISOString() : '无'));
});

/* ===================== 2. 补充通知合并 ===================== */
section('2. 补充通知合并');

const ids = R.allItems().map(i => i.id);
check('09 不再作为独立条目出现（已并入 01）', !ids.includes('09'));
check('20 不再作为独立条目出现（已并入 03）', !ids.includes('20'));
check('列表条目数 = 26 - 2 = 24', R.allItems().length === 24, '实际 ' + R.allItems().length);

const i01 = R.allItems().filter(x => x.id === '01')[0];
check('01 上挂了 1 条补充通知', (i01.updates || []).length === 1);
check('01 的首次训练时间已采用补充通知的 9月21日19:30',
  i01.schedule[0].at === '2026-09-21T19:30' && i01.schedule[0].place === '实验楼A402',
  JSON.stringify(i01.schedule[0]));

const i03 = R.allItems().filter(x => x.id === '03')[0];
check('03 上挂了 1 条补充通知', (i03.updates || []).length === 1);

/* ===================== 3. 完整度与新生适配 ===================== */
section('3. 信息完整度与新生适配');

[['24', 0], ['25', 1]].forEach(([id, max]) => {
  const it = R.allItems().filter(x => x.id === id)[0];
  const c = R.completeness(it);
  check(id + ' 完整度很低（' + c.score + '/' + c.total + '，缺 ' + c.missing.join('、') + '）', c.score <= max);
});

['24', '25'].forEach(id => {
  const it = R.allItems().filter(x => x.id === id)[0];
  check(id + ' 被标记为高风险', it.risk && it.risk.level === 'high');
});

const i13 = R.allItems().filter(x => x.id === '13')[0];
check('13（仅限大二及以上）对新生判定为不符合', R.newbieFit(i13).key === 'no');

const i17 = R.allItems().filter(x => x.id === '17')[0];
check('17 保留了「网盘有效期」这个容易漏掉的截止时间',
  (i17.deadlines || []).some(d => d.at && d.note && d.note.includes('统一更新')));

/* ===================== 4. 渲染冒烟检查 ===================== */
section('4. 渲染冒烟检查');

function tryRender(name, fn) {
  try {
    const out = fn();
    check(name + ' 渲染成功（' + out.length + ' 字符）', out.length > 200);
    return out;
  } catch (e) {
    check(name + ' 渲染成功', false, e.message);
    return '';
  }
}

const radarHTML = tryRender('搜索页', () => { R.state.tab = 'search'; R.render(); return getEl('view').innerHTML; });
check('列表里出现了已合并的角标', radarHTML.includes('已合并'));
check('列表里出现了新生适配标签', radarHTML.includes('fit--ok'));
check('高风险条目有视觉标记', radarHTML.includes('card--risky'));
check('没有报名信息的条目不静默留空，而是标注「是否需报名未注明」',
  radarHTML.includes('是否需报名未注明'));
check('今天的活动不再重复显示星期几', radarHTML.includes('今天 19:00') && !radarHTML.includes('今天(周六)'));

const todayHTML = tryRender('今日安排页', () => { R.state.tab = 'today'; R.render(); return getEl('view').innerHTML; });
check('今日页出现「今天开始」的活动', todayHTML.includes('今天'));

const mineHTML = tryRender('我的页', () => { R.state.tab = 'mine'; R.render(); return getEl('view').innerHTML; });
check('我的页有发布入口', mineHTML.includes('data-publish'));

/* 筛选 */
R.state.tab = 'search';
R.state.newbie = true;
let filtered = tryRender('新生模式筛选后', () => { R.render(); return getEl('view').innerHTML; });
check('新生模式下排除了 13 号', !filtered.includes('科研助理招募'));
R.state.newbie = false;

R.state.source = 'student';
filtered = tryRender('只看学生发布', () => { R.render(); return getEl('view').innerHTML; });
check('学生来源下出现 22 号约球', filtered.includes('周末羽毛球约球'));
check('学生来源下不出现官方发布的 21 号', !filtered.includes('计算机学院AI产品设计分享会'));
R.state.source = 'all';

R.state.q = '零基础';
filtered = tryRender('搜索「零基础」', () => { R.render(); return getEl('view').innerHTML; });
check('搜索能命中结果', filtered.includes('card__title'));
R.state.q = '';

/* 详情弹层 */
section('5. 详情弹层');
try {
  const d = R.renderDetail(i01);
  check('01 详情渲染成功（' + d.length + ' 字符）', d.length > 500);
  check('详情里显示了合并的补充通知', d.includes('已合并的后续通知'));
  check('详情里显示了原始通知', d.includes('原始通知'));
  check('详情里显示了信息完整度', d.includes('信息完整度'));
  check('详情里给出了「我要做什么」', d.includes('我要做什么'));
} catch (e) {
  check('01 详情渲染成功', false, e.message);
}

try {
  const d24 = R.renderDetail(R.allItems().filter(x => x.id === '24')[0]);
  check('24 号详情带出风险提示', d24.includes('这条信息需要当心') && d24.includes('不要提供身份证'));
} catch (e) {
  check('24 号详情渲染成功', false, e.message);
}

/* ===================== 6. 日历导出 ===================== */
section('6. 日历导出');
const ics = R.toICS(i01);
check('.ics 生成成功', !!ics && ics.startsWith('BEGIN:VCALENDAR'));
check('.ics 里时间是 UTC 11:30（= 北京 19:30）', ics.includes('DTSTART:20260921T113000Z'),
  (ics.match(/DTSTART:\S+/) || [''])[0]);
check('.ics 里带地点与提醒', ics.includes('实验楼A402') && ics.includes('TRIGGER:-PT2H'));
check('没有确定时间的条目不生成 .ics（19 号地点待确认但有时间 → 应有）',
  !!R.toICS(R.allItems().filter(x => x.id === '22')[0]));

/* ===================== 7. 门类 A—F ===================== */
section('7. 门类归属（对照《校园活动分类整理》）');

/* 与分类文件逐条核对，26 项每项唯一门类 */
const CAT_MAP = {
  '01': 'A', '02': 'C', '03': 'B', '04': 'C', '05': 'D', '06': 'B', '07': 'A',
  '08': 'B', '09': 'A', '10': 'C', '11': 'C', '12': 'A', '13': 'B', '14': 'C',
  '15': 'A', '16': 'B', '17': 'E', '18': 'C', '19': 'D', '20': 'B', '21': 'C',
  '22': 'F', '23': 'F', '24': 'F', '25': 'F', '26': 'C'
};
let catBad = [];
R.RAW_ITEMS.forEach(it => {
  if (it.category !== CAT_MAP[it.id]) catBad.push(it.id + '(期望' + CAT_MAP[it.id] + '实际' + it.category + ')');
});
check('26 项全部门类与分类文件一致', catBad.length === 0, catBad.join(' '));

const vis = R.allItems();
const cnt = {};
vis.forEach(i => { cnt[i.category] = (cnt[i.category] || 0) + 1; });
check('六个门类都有内容，且总数为 24（26 减去 2 条已合并）',
  Object.keys(cnt).length === 6 && vis.length === 24, JSON.stringify(cnt));
check('A 竞赛与训练营 = 4 条（09 已并入 01）', cnt.A === 4, '实际 ' + cnt.A);
check('F 学生个人发起 = 4 条', cnt.F === 4, '实际 ' + cnt.F);
check('E 学习资源 = 1 条', cnt.E === 1, '实际 ' + cnt.E);

check('门类徽章能正常渲染', R.catChip('A').includes('竞赛与训练营') && R.catChip('F').includes('学生个人发起'));
check('未知门类不炸', R.catChip('ZZZ') === '');

/* ===================== 8. 发布者身份 ===================== */
section('8. 发布者身份');

const srcMap = { '21': 'college', '26': 'college', '22': 'student', '23': 'student', '24': 'student', '25': 'student' };
let srcBad = [];
R.RAW_ITEMS.forEach(it => {
  const want = srcMap[it.id] || 'unknown';
  if (it.source !== want) srcBad.push(it.id);
});
check('只有明确写了发布方的 6 条被认领，其余如实标为「未注明」', srcBad.length === 0, srcBad.join(' '));

const unknownCount = vis.filter(i => i.source === 'unknown').length;
check('未注明发布方的有 18 条（不替材料编造身份）', unknownCount === 18, '实际 ' + unknownCount);
check('学院发布 2 条', vis.filter(i => i.source === 'college').length === 2);

/* ===================== 9. 距截止还剩 N 天 ===================== */
section('9. 距截止还剩 3 天 / 3–7 天');

const bk = R.deadlineBuckets(vis, NOW);
const urgentIds = bk.urgent.map(e => e.item.id);
const soonIds = Array.from(new Set(bk.soon.map(e => e.item.id)));

check('3 天内截止的正好是 05、07、13',
  urgentIds.length === 3 && urgentIds.join(',') === '05,07,13', urgentIds.join(','));
check('3—7 天内的是 03、17、15、01',
  soonIds.length === 4 && soonIds.join(',') === '03,17,15,01', soonIds.join(','));
check('已经过期的截止时间不进倒计时（19 号报名 9/18 已过）', !urgentIds.includes('19') && !soonIds.includes('19'));
check('没有具体时间的截止不进倒计时（06 号「满员即止」）',
  !urgentIds.includes('06') && !soonIds.includes('06'));

check('倒计时文案：22 小时', R.countdownText(22 * 3600000) === '22 小时', R.countdownText(22 * 3600000));
check('倒计时文案：不足 1 小时按分钟', R.countdownText(40 * 60000) === '40 分钟', R.countdownText(40 * 60000));
check('倒计时文案：5.3 天显示为 5 天', R.countdownText(5.3 * 86400000) === '5 天', R.countdownText(5.3 * 86400000));

/* 时间推到 9/22，紧急的那批应该已经过期，倒计时列表要跟着换 */
const bk22 = R.deadlineBuckets(vis, new Date('2026-09-22T10:00:00'));
check('时间推进到 9/22 后，倒计时列表随之更新（05/07/13 已过期）',
  !bk22.urgent.map(e => e.item.id).includes('05') && bk22.urgent.map(e => e.item.id).includes('15'),
  bk22.urgent.map(e => e.item.id).join(','));

/* ===================== 10. 账号与发布者身份确认 ===================== */
section('10. 账号与发布者身份确认');

check('未登录时 currentUser 为 null', R.currentUser() === null);
check('注册表单会要求选发布者身份', R.renderAuth('register').includes('发布者身份'));
check('注册表单带上了 18 个学院', R.renderAuth('register').includes('计算机学院') &&
  R.renderAuth('register').includes('美术设计与建筑学院'));

Promise.resolve()
  .then(() => R.registerUser('张三', '1234', { role: 'student', org: '计算机学院', sid: '2026xxxx' }))
  .then(() => {
    const me = R.currentUser();
    check('注册后自动登录', !!me && me.name === '张三');
    check('会话里带上了发布者身份', me.role === 'student' && me.org === '计算机学院');
    return R.loginUser('张三', '错误的密码');
  })
  .then(r => {
    check('密码错误时拒绝登录', r.ok === false);
    return R.loginUser('张三', '1234');
  })
  .then(r => {
    check('密码正确时登录成功', r.ok === true);
    const line = R.publisherLine({
      userPost: true, verified: true, author: { name: '张三', org: '计算机学院' }
    });
    check('已确认身份的发布者会显示名字和单位',
      line.includes('已确认身份') && line.includes('张三') && line.includes('计算机学院'));
    const line2 = R.publisherLine({ userPost: true, verified: false, author: { name: '李四' } });
    check('未确认身份的发布者会被标出', line2.includes('未确认'));
  })
  .then(() => {
    /* ============ 11. 账号发布的内容能被搜到（回归） ============
     * 之前的搜索匹配范围漏了 content 正文，还引用了一个不存在的
     * it.publisher 字段，导致自己发布的内容搜不出来。 */
    section('11. 账号发布的内容能被搜到');

    const myPost = {
      id: 'U1', title: '周末羽毛球约球',
      content: '这周六下午四点，在体育馆三号场打球，计划六到八人，场地费大家AA，想来的私我拉群。',
      source: 'student', sourceName: '张三（计算机学院）',
      category: 'F', userPost: true, verified: true, needSignup: true,
      oneLiner: '这周六下午四点，在体育馆三号场打球',
      author: { name: '张三', org: '计算机学院', role: 'student' },
      schedule: [{ label: '活动时间', at: '2026-09-20T16:00', place: '体育馆三号场' }],
      deadlines: [{ label: '报名截止', at: '2026-09-21T18:00' }],
      audience: '全校学生', tags: [], missing: [], raw: '【同学自主发布】张三：这周六下午四点…'
    };
    store['cr_posts'] = JSON.stringify([myPost]);

    check('发布的内容进入了列表', R.allItems().some(i => i.id === 'U1'));

    const hay = R.searchText(myPost);
    check('搜索范围包含发布正文', hay.includes('体育馆三号场') && hay.includes('场地费'));
    check('搜索范围包含发布者姓名', hay.includes('张三'));
    check('搜索范围包含门类名称', hay.includes('学生个人发起'));
    check('不再引用不存在的 publisher 字段', !/publisher/.test(hay));

    /* 真的走一遍筛选：搜正文里的词 */
    const tries = [
      ['体育馆三号场', '正文里的地点'],
      ['场地费', '正文里的词'],
      ['张三', '发布者姓名'],
      ['计算机学院', '发布者单位'],
      ['学生个人发起', '门类名']
    ];
    tries.forEach(([q, what]) => {
      R.state.q = q;
      const hit = R.visibleItems().some(i => i.id === 'U1');
      check('搜「' + q + '」（' + what + '）能搜到自己发布的内容', hit, '没搜到');
    });
    R.state.q = '量子力学';
    check('搜不相关的词时自己发布的内容不会被误命中',
      !R.visibleItems().some(i => i.id === 'U1'));
    R.state.q = '';
  })
  .then(() => {
    /* ============ 12. 搜索页结构（中文输入的前提） ============ */
    section('12. 搜索页结构');

    R.state.tab = 'search';
    R.render();
    const shell = getEl('view').innerHTML;

    check('搜索框在结果区之外（输入时不会重建输入框）',
      shell.includes('id="q"') && shell.includes('id="results"') &&
      shell.indexOf('id="q"') < shell.indexOf('id="results"'));
    check('页签里没有「全部信息」，改成「搜索」',
      !shell.includes('全部信息') && R.renderSearch().includes('全部信息') === false);

    /* 只重绘结果区时，搜索框所在的外壳不受影响 */
    R.state.q = '零基础';
    R.renderResultsOnly();
    check('只重绘结果区能正常出结果', getEl('results').innerHTML.includes('card__title'));
    R.state.q = '';
  })
  .then(() => {
    /* ============ 13. 报名与报名名单 ============ */
    section('13. 报名与报名名单');

    check('手机号校验：11 位合法号', R.validPhone('13800138000') === true);
    check('手机号校验：位数不够拒绝', R.validPhone('1380013') === false);
    check('手机号校验：非 1 开头拒绝', R.validPhone('23800138000') === false);
    check('手机号校验：带字母拒绝', R.validPhone('1380013800a') === false);

    const it0 = R.allItems().filter(i => i.id === 'U1')[0];
    check('还没人报名时，报名名单为空', R.signupsOf('U1').length === 0);
    check('发布者看到的是「还没有人报名」', R.signupSection(it0).includes('还没有人报名'));

    /* 另一个同学来报名 */
    R.addSignup('U1', {
      id: 'R1', name: '李四', phone: '13800138000', org: '外国语学院',
      account: '李四', at: new Date().toISOString()
    });
    R.addSignup('U1', {
      id: 'R2', name: '王五', phone: '13900139000', org: '',
      account: '王五', at: new Date().toISOString()
    });

    check('两条报名已记录', R.signupsOf('U1').length === 2);

    /* 当前登录的是张三，U1 的 author 也是张三 → 发布者视角 */
    const ownerView = R.signupSection(it0);
    check('发布者能看到报名同学的姓名', ownerView.includes('李四') && ownerView.includes('王五'));
    check('发布者能看到报名同学的手机号', ownerView.includes('13800138000') && ownerView.includes('13900139000'));
    check('发布者能看到报名同学的学院', ownerView.includes('外国语学院'));
    check('发布者可以移除某条报名', ownerView.includes('data-delreg="U1:R1"'));
    check('发布者可以一键复制名单', ownerView.includes('data-copyregs="U1"'));

    /* 「我的」页面也要能看到名单 */
    const panel = R.regPanel(it0);
    check('「我的」里显示报名人数', panel.includes('2 人报名'));
    check('「我的」里带出手机号', panel.includes('13800138000'));

    /* 活动卡片上出现报名人数角标 */
    R.state.tab = 'search';
    R.render();
    check('列表卡片上有报名人数角标', getEl('view').innerHTML.includes('2 人报名'));

    /* 报名区块只出现在账号发布的内容上，官方信息不该有 */
    const official = R.allItems().filter(i => i.id === '01')[0];
    check('官方信息不会出现报名区块', R.signupSection(official) === '');
  })
  .then(() => {
    /* ============ 14. 内容审核 ============ */
    section('14. 内容审核规则');

    const mod = sandbox.window.checkContent;
    check('审核模块已加载', typeof mod === 'function' && sandbox.window.MODERATION_RULES.length >= 7);

    /* 该拦的必须拦 */
    const mustBlock = [
      ['全校第一的编程训练营', '极限用语-排名'],
      ['史上最强学习方法', '极限用语-最X'],
      ['100% 包过', '绝对化承诺'],
      ['这个偏方可以根治近视', '医疗功效'],
      ['无副作用，药到病除', '医疗功效'],
      ['稳赚不赔，零风险', '金融收益承诺'],
      ['扫码进群领资料', '站外导流'],
      ['加微信详聊', '站外导流'],
      ['算命改运，开光消灾', '封建迷信'],
      ['零门槛日结，动动手指就赚钱', '可疑兼职'],
      ['代写论文，包过', '学术违规'],
      ['全国第一的辅导班', '极限用语-排名'],
      ['错过再无，最后一天', '虚构紧迫感']
    ];
    mustBlock.forEach(([text, why]) => {
      const r = mod(text);
      check('拦截「' + text + '」（' + why + '）', r.ok === false, '没拦到');
    });

    /* 这些是校园里的正常表述，一个字都不能误伤 */
    const mustPass = [
      '第一教学楼 A201 开讲',
      '第一次参加的学生也欢迎',
      '最好提前十分钟到场',
      '本周六下午在体育馆三号场打球',
      '微信号：abc123（只给发布者看）',
      '蓝桥杯程序设计校内训练营，零基础可参加',
      '招募开发、设计、材料成员，每周投入4小时',
      '校园公益志愿服务活动，预计服务8小时',
      'Python 学习资料合集，网盘长期开放',
      '科研助理招募，仅限大二及以上'
    ];
    mustPass.forEach(text => {
      const r = mod(text);
      check('不误伤正常表述「' + text.slice(0, 18) + '…」',
        r.ok === true, r.hits.map(h => h.catName + ':' + h.word).join(' '));
    });

    /* 命中信息要能告诉用户改哪里 */
    const hit = mod('全校第一，100% 包过，加微信详聊');
    check('命中结果里带上了具体词', hit.hits.length >= 3 &&
      hit.hits.some(h => h.word.includes('全校第一')) &&
      hit.hits.some(h => h.word.includes('100%')));
    check('命中结果里带上了规则说明', hit.hits.every(h => h.catName && h.desc && h.icon));

    const f = sandbox.window.checkFields({ '标题': '正常标题', '发布内容': '稳赚不赔' });
    check('多字段检查会标出是哪一栏出的问题',
      f.ok === false && f.hits[0].field === '发布内容');

    check('空内容直接放行', mod('').ok === true && mod('   ').ok === true);
  })
  .then(() => {
    /* ============ 15. 搜索高亮与概览同步 ============ */
    section('15. 搜索高亮与概览同步');

    R.state.tab = 'search';
    R.state.q = '体育馆';
    const hlHTML = R.renderResults();
    check('命中的关键词被高亮标出', hlHTML.includes('<mark class="hl">体育馆</mark>'), '没高亮');

    R.state.q = '不存在的词xyz';
    const noHl = R.renderResults();
    check('没有命中时不产生高亮标签', !noHl.includes('<mark class="hl">'));
    R.state.q = '';

    /* 概览只保留「条信息」和「N 天内截止」两个数 */
    const res = R.renderResults();
    check('概览不再显示「条已合并」', !res.includes('条已合并'));
    check('概览不再显示「条账号发布」', !res.includes('条账号发布'));
    check('概览保留「条信息」', res.includes('条信息'));
    check('概览保留「3 天内截止」', res.includes('3 天内截止'));

    /* 条数必须跟着账号发布走 */
    const before = (res.match(/(\d+)<\/b><span>条信息/) || [])[1];
    store['cr_posts'] = JSON.stringify(JSON.parse(store['cr_posts']).concat([{
      id: 'U2', title: '找 AI 工具搭子', content: '想找人一起交流 AI 工具，零基础也行。',
      source: 'student', category: 'F', userPost: true, verified: true, needSignup: true,
      author: { name: '张三', org: '计算机学院' },
      deadlines: [{ label: '报名截止', at: '2026-09-25T18:00' }],
      audience: '全校学生', tags: [], missing: []
    }]));
    const after = (R.renderResults().match(/(\d+)<\/b><span>条信息/) || [])[1];
    check('账号发布后，概览条数同步 +1（' + before + ' → ' + after + '）',
      Number(after) === Number(before) + 1, before + ' → ' + after);
    check('新发布的内容同时能被搜到',
      (R.state.q = '搭子', R.visibleItems().some(i => i.id === 'U2')));
    R.state.q = '';
  })
  .then(() => {
    /* ============ 16. 「我的」三分类 ============ */
    section('16. 「我的」三分类与左侧项目栏');

    R.state.tab = 'mine';
    R.render();
    const mine = getEl('view').innerHTML;

    check('有左侧项目栏', mine.includes('class="mineSide"'));
    check('分类一：我的收藏', mine.includes('我的收藏') && mine.includes('data-jump="sec-fav"'));
    check('分类二：我参与的', mine.includes('我参与的') && mine.includes('data-jump="sec-join"'));
    check('分类三：我发布的', mine.includes('我发布的') && mine.includes('data-jump="sec-pub"'));
    check('三个分类各自有锚点', mine.includes('id="sec-fav"') &&
      mine.includes('id="sec-join"') && mine.includes('id="sec-pub"'));

    check('已发布的内容出现在「我发布的」里', mine.includes('周末羽毛球约球'));

    /* 注意这一条：我发的内容默认**不**出现在「我参与的」里 ——
       没参加过就是没参加过，不能因为是自己发的就算参与。 */
    const onlyPub = (mine.match(/周末羽毛球约球/g) || []).length;
    check('自己发的内容不会自动算进「我参与的」', onlyPub === 1, '出现 ' + onlyPub + ' 次');

    /* 同一条内容可以同时出现在多个分类：把它收藏，就同时进了「收藏」和「发布」 */
    R.favs.push('U1');
    R.render();
    const mine2 = getEl('view').innerHTML;
    check('同一条内容可以同时出现在多个分类里（收藏 + 发布）',
      (mine2.match(/周末羽毛球约球/g) || []).length >= 2,
      '出现 ' + (mine2.match(/周末羽毛球约球/g) || []).length + ' 次');

    /* 「我参与的」：报名了别人的活动 */
    store['cr_posts'] = JSON.stringify(JSON.parse(store['cr_posts']).concat([{
      id: 'U3', title: '李四发起的读书会', content: '每周三晚一起读书。',
      source: 'student', category: 'C', userPost: true, verified: true, needSignup: true,
      author: { name: '李四', org: '文学院' },
      deadlines: [{ label: '报名截止', at: '2026-09-26T18:00' }],
      audience: '全校学生', tags: [], missing: []
    }]));
    R.addSignup('U3', { id: 'R9', name: '张三', phone: '13700137000',
      org: '计算机学院', account: '张三', at: new Date().toISOString() });
    R.render();
    const mine3 = getEl('view').innerHTML;
    check('报名别人的活动后，它进入「我参与的」', mine3.includes('李四发起的读书会'));
    check('「我参与的」里显示我自己的报名信息', mine3.includes('我已报名') && mine3.includes('13700137000'));
    check('左侧栏统计了报名总数', mine3.includes('收到') && mine3.includes('条报名'));

    /* 取消收藏后应当从「我的收藏」消失 */
    R.favs.length = 0;
    R.render();
    check('取消收藏后从「我的收藏」消失',
      !getEl('view').innerHTML.includes('id="sec-fav"') === false &&
      getEl('view').innerHTML.includes('还没有收藏'));
  })
  .then(() => {
    /* ===================== 汇总 ===================== */
    console.log('\n' + '─'.repeat(52));
    console.log(fail === 0
      ? '\x1b[32m全部通过\x1b[0m：' + pass + ' 项'
      : '\x1b[31m' + fail + ' 项失败\x1b[0m，' + pass + ' 项通过');
    console.log('─'.repeat(52) + '\n');
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(err => {
    console.log('\n\x1b[31m测试过程抛异常：\x1b[0m ' + err.message + '\n' + err.stack);
    process.exit(1);
  });
