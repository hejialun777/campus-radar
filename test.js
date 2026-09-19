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

const ROOT = path.join(__dirname, 'projects', 'campus-radar');

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
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8'), sandbox, { filename: 'app.js' });

const R = sandbox.window.__campusRadar;

/* ---------- 断言小工具 ---------- */
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + (extra ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n\x1b[1m' + t + '\x1b[0m'); }

/* 锁定时间基准：考核当日 14:00 */
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

const radarHTML = tryRender('全部信息页', () => { R.state.tab = 'radar'; R.render(); return getEl('view').innerHTML; });
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
R.state.tab = 'radar';
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
