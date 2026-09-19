/* ============================================================================
 * 校园机会雷达 · 数据层
 * ----------------------------------------------------------------------------
 * 全部条目来自《计算机协会软件部2026年秋季纳新第二轮考核题目》第四节材料（01—26）。
 *
 * 数据层的三条原则：
 *   1. 材料里没写的事实，一律留 null，由 UI 显示为「通知未注明」，绝不推测补全。
 *   2. 补充通知（09、20）不单独成为一条信息，而是挂到主信息（01、03）的 updates 上，
 *      避免同一件事在列表里出现两次、让用户自己判断哪条更新。
 *   3. 时间一律写成 ISO 字符串，交给 UI 按「今天 = 2026-09-19」实时推算状态。
 *
 * 字段说明：
 *   precision:'day'  —— 通知只给了日期没给时间，按当天结束处理，UI 会注明。
 *   timeTBD / placeTBD —— 通知明说「未确定」，UI 要显示成「待确认」而不是留空。
 *   risk.level='high' —— 信息严重不完整或疑似推广，降权展示 + 明确提示，但不删除。
 * ========================================================================== */
window.RAW_ITEMS = [

  /* ---------- 01 + 09：一条主通知 + 一条场地变更补充通知 ---------- */
  {
    id: '01',
    title: '“蓝桥杯”程序设计校内训练营',
    source: 'org',
    category: 'training',
    tags: ['程序设计', '竞赛', '零基础'],
    oneLiner: '零基础也能报的算法训练营，9月24日22:00截止报名。注意：首次训练因场地调整，已经改到9月21日晚上。',
    schedule: [
      { label: '首次训练', at: '2026-09-21T19:30', place: '实验楼A402', note: '场地调整后' },
      { label: '常规训练', at: null, text: '每周六 19:00', place: null }
    ],
    deadlines: [
      { label: '报名截止', at: '2026-09-24T22:00' }
    ],
    audience: '全校学生',
    zeroBase: true,
    needSignup: true,
    fee: null,
    commitment: null,
    capacity: null,
    missing: ['报名方式', '费用', '名额上限'],
    updates: [
      {
        fromId: '09',
        title: '程序设计训练营补充通知',
        text: '因场地调整，首次训练改为9月21日19:30，地点改至实验楼A402；已报名同学无需重复提交；报名截止时间不变。'
      }
    ],
    conflictNote: '原通知写的是“9月20日起每周六19:00训练”，补充通知把首次训练改到了9月21日（周一）19:30。本页以较新的补充通知为准。',
    raw: '9月24日22:00报名截止；原计划9月20日起每周六19:00训练；面向全校学生；零基础可参加'
  },

  /* ---------- 02：就在今晚 ---------- */
  {
    id: '02',
    title: 'AI应用入门公开课',
    source: 'org',
    category: 'talk',
    tags: ['AI', '零基础', '无需报名'],
    oneLiner: '今天晚上7点，在计算机学院教学楼，不用报名直接去，预计讲90分钟。',
    schedule: [
      { label: '开讲', at: '2026-09-19T19:00', place: '计算机学院教学楼' }
    ],
    deadlines: [],
    audience: '全校学生',
    zeroBase: true,
    needSignup: false,
    fee: null,
    duration: 90,
    commitment: null,
    capacity: null,
    missing: ['具体教室', '费用'],
    raw: '9月19日19:00；计算机学院教学楼；面向全校学生；无需报名；预计90分钟'
  },

  /* ---------- 03 + 20：一条主通知 + 一条名额变更补充通知 ---------- */
  {
    id: '03',
    title: '大学生创新创业项目团队招募',
    source: 'org',
    category: 'recruit',
    tags: ['创新创业', '组队', '设计', '材料'],
    oneLiner: '大创项目补招设计和材料成员——开发岗名额已满，别再投开发了。9月22日18:00截止，要交一段自我介绍。',
    schedule: [],
    deadlines: [
      { label: '报名截止', at: '2026-09-22T18:00' }
    ],
    audience: '全校学生',
    zeroBase: null,
    needSignup: true,
    fee: null,
    commitment: '每周 ≥4 小时',
    capacity: null,
    missing: ['项目具体方向', '费用', '团队现有规模'],
    updates: [
      {
        fromId: '20',
        title: '创新创业项目团队补充说明',
        text: '开发方向名额已满，现主要补充设计与材料成员；9月22日18:00截止；此前已投递者无需重复提交。'
      }
    ],
    conflictNote: '原通知同时招开发、设计、材料三个方向，补充说明显示开发方向已满。如果你是想投开发的，这条现在不适合你。',
    raw: '招募开发、设计、材料成员；每周需稳定投入4小时以上；9月22日18:00截止；需提交简短自我介绍'
  },

  /* ---------- 04：已结束，等回放 ---------- */
  {
    id: '04',
    title: '数学建模竞赛经验分享会',
    source: 'org',
    category: 'talk',
    tags: ['数学建模', '竞赛', '有回放'],
    oneLiner: '直播9月18日就已经结束了。活动方说预计9月20日上传回放，没赶上直播的可以等回放。',
    schedule: [
      { label: '直播（已结束）', at: '2026-09-18T19:30', place: '线上', past: true }
    ],
    replay: { at: '2026-09-20', note: '活动方“预计”上传，未给出确切时间和地址' },
    deadlines: [],
    audience: '不限专业',
    zeroBase: true,
    needSignup: false,
    fee: null,
    commitment: null,
    capacity: null,
    missing: ['回放发布地址', '回放确切时间', '费用'],
    raw: '直播时间为9月18日19:30；不限专业；直播已结束，活动方预计9月20日上传回放'
  },

  /* ---------- 05：离截止最近的一条 ---------- */
  {
    id: '05',
    title: '校园公益志愿服务活动',
    source: 'org',
    category: 'volunteer',
    tags: ['志愿服务', '服务时长', '需签到'],
    oneLiner: '9月27日全天做志愿服务，约8小时。明天（9月20日）中午12:00就截止报名了，需要提前到场签到。',
    schedule: [
      { label: '活动时间', at: '2026-09-27T08:30', endAt: '2026-09-27T17:00', place: null, placeTBD: true }
    ],
    deadlines: [
      { label: '报名截止', at: '2026-09-20T12:00' }
    ],
    audience: '全校学生',
    zeroBase: true,
    needSignup: true,
    fee: null,
    commitment: '9月27日 8:30—17:00（约8小时）',
    capacity: null,
    missing: ['集合地点', '具体的志愿服务内容', '费用'],
    raw: '活动时间9月27日8:30—17:00；9月20日12:00报名截止；预计服务8小时；需提前到场签到'
  },

  /* ---------- 06：报名时间未注明，是这条最大的坑 ---------- */
  {
    id: '06',
    title: 'Web开发零基础学习小组',
    source: 'org',
    category: 'training',
    tags: ['Web开发', '零基础', '限30人'],
    oneLiner: '9月23日起每周三晚上7:30，一共6周，限30人。但通知里根本没写报名截止时间，只说了“满员即止”。',
    schedule: [
      { label: '开班', at: '2026-09-23T19:30', place: null, placeTBD: true, note: '每周三 19:30，共6周' }
    ],
    deadlines: [
      { label: '报名截止', at: null, text: '通知未注明，满员即止' }
    ],
    audience: '零基础学生',
    zeroBase: true,
    needSignup: true,
    fee: null,
    commitment: '每周三 19:30，共 6 周',
    capacity: 30,
    missing: ['报名截止时间', '上课地点', '报名方式', '费用'],
    warn: '这是本次信息里比较容易被耽误的一条：报名时间未注明，只写了“满员即止”。想参加的话建议尽早联系，不要等通知。',
    raw: '9月23日起每周三19:30开展，共6周；面向零基础学生；限30人；报名时间未注明，满员即止'
  },

  /* ---------- 07：两个时间节点，最容易混淆 ---------- */
  {
    id: '07',
    title: 'AI创新应用挑战赛',
    source: 'org',
    category: 'competition',
    tags: ['AI', '组队', '2—4人'],
    oneLiner: '要2—4人组队。9月21日18:00前先做校内意向登记，作品10月20日才交——注意，意向登记不等于已经报名成功。',
    schedule: [],
    deadlines: [
      { label: '校内意向登记截止', at: '2026-09-21T18:00' },
      { label: '最终作品提交截止', at: '2026-10-20T23:59' }
    ],
    audience: '全校学生',
    zeroBase: null,
    needSignup: true,
    fee: null,
    commitment: null,
    capacity: null,
    missing: ['费用', '赛道与主题要求', '组队方式'],
    warn: '意向登记 ≠ 最终作品提交，两个时间点都要记。离得最近的是 9月21日18:00 的意向登记，别只记住了10月20日。',
    raw: '2—4人组队；9月21日18:00前完成校内意向登记；10月20日提交作品；意向登记不等同于最终作品提交'
  },

  /* ---------- 08 ---------- */
  {
    id: '08',
    title: '校园软件项目组招募',
    source: 'org',
    category: 'recruit',
    tags: ['开发', '大一', 'Git'],
    oneLiner: '做校园实用工具的项目组，面向大一、大二，希望你会一点 Git。每周约5小时，长期招募、满员即止。',
    schedule: [],
    deadlines: [
      { label: '报名截止', at: null, text: '长期招募，满员即止' }
    ],
    audience: '大一、大二学生',
    zeroBase: null,
    needSignup: true,
    fee: null,
    commitment: '每周约 5 小时',
    capacity: null,
    missing: ['报名方式', '项目具体方向', '费用'],
    warn: '“希望成员了解 Git 基本操作”是偏好、不是硬门槛，但完全没接触过的话要有心理预期——可以先去14号的 Git 工作坊补一下。',
    raw: '开发校园实用工具；面向大一、大二学生；希望成员了解Git基本操作；每周预计投入5小时；长期招募，满员即止'
  },

  /* ---------- 09：已在 01 的 updates 里，这里保留原文备查 ---------- */
  {
    id: '09',
    title: '程序设计训练营补充通知',
    source: 'org',
    category: 'training',
    tags: ['补充通知'],
    mergedInto: '01',
    oneLiner: '这是 01 号“蓝桥杯训练营”的场地变更通知，已自动合并到原活动里。',
    schedule: [],
    deadlines: [],
    audience: null,
    missing: [],
    raw: '因场地调整，首次训练改为9月21日19:30，地点改至实验楼A402；已报名同学无需重复提交；报名截止时间不变'
  },

  /* ---------- 10：就在今天下午，考试时间正撞上 ---------- */
  {
    id: '10',
    title: '前端开发经验交流会',
    source: 'org',
    category: 'talk',
    tags: ['前端', '线下+直播', '无需报名'],
    oneLiner: '就在今天 15:00—16:30，A201 线下、同时有线上直播，不用报名。去不了现场可以看直播。',
    schedule: [
      { label: '开始', at: '2026-09-19T15:00', endAt: '2026-09-19T16:30', place: 'A201（同步线上直播）' }
    ],
    deadlines: [],
    audience: '全校学生',
    zeroBase: true,
    needSignup: false,
    fee: null,
    duration: 90,
    missing: ['线上直播入口', '费用'],
    raw: '9月19日15:00—16:30；线下A201并同步线上直播；无需报名'
  },

  /* ---------- 11 ---------- */
  {
    id: '11',
    title: '大学生科研入门分享会',
    source: 'org',
    category: 'talk',
    tags: ['科研', '导师', '论文检索'],
    oneLiner: '9月21日19:00—20:30，讲论文检索、学生科研项目，还有大家最关心的“怎么联系导师”，面向全校。',
    schedule: [
      { label: '开始', at: '2026-09-21T19:00', endAt: '2026-09-21T20:30', place: null, placeTBD: true }
    ],
    deadlines: [],
    audience: '全校学生',
    zeroBase: true,
    needSignup: null,
    fee: null,
    duration: 90,
    missing: ['地点', '是否需要报名', '费用'],
    raw: '9月21日19:00—20:30；介绍论文检索、学生科研项目和导师联系方法；面向全校学生'
  },

  /* ---------- 12：费用未提供 ---------- */
  {
    id: '12',
    title: '全国高校计算机能力挑战赛',
    source: 'org',
    category: 'competition',
    tags: ['本科生', '个人赛'],
    oneLiner: '个人参赛，10月5日23:59截止报名。但材料里没写参赛费用——报名前记得先确认要不要交钱、交多少。',
    schedule: [],
    deadlines: [
      { label: '报名截止', at: '2026-10-05T23:59' }
    ],
    audience: '本科生',
    zeroBase: null,
    needSignup: true,
    fee: null,
    commitment: null,
    capacity: null,
    missing: ['参赛费用', '比赛形式与赛程', '报名入口'],
    warn: '费用信息未提供。这类全国性赛事通常涉及报名费，建议先向主办方确认再决定。',
    raw: '面向本科生；10月5日23:59报名截止；个人参赛；具体费用信息未提供'
  },

  /* ---------- 13：新生这次不符合 ---------- */
  {
    id: '13',
    title: '科研助理招募',
    source: 'org',
    category: 'recruit',
    tags: ['科研', '限大二及以上'],
    oneLiner: '协助数据整理和实验工作，每周约6小时，9月21日截止报名——但只招大二及以上，大一同学这次不符合条件。',
    schedule: [],
    deadlines: [
      { label: '报名截止', at: '2026-09-21T23:59', precision: 'day' }
    ],
    audience: '大二及以上学生',
    audienceExclude: ['大一'],
    zeroBase: null,
    needSignup: true,
    fee: null,
    commitment: '每周约 6 小时',
    capacity: null,
    missing: ['报名方式', '具体研究方向', '是否有报酬'],
    raw: '协助数据整理和实验工作；仅限大二及以上学生；每周预计投入6小时；9月21日截止报名'
  },

  /* ---------- 14：无预约截止时间 + 报名表≠录取 ---------- */
  {
    id: '14',
    title: 'Git与GitHub零基础工作坊',
    source: 'org',
    category: 'training',
    tags: ['Git', '大一新生', '限40人'],
    oneLiner: '9月21日19:00—20:30，主要面向大一新生，限40人、要提前预约。两个提醒：没写预约截止时间，而且提交报名表≠被录取。',
    schedule: [
      { label: '开始', at: '2026-09-21T19:00', endAt: '2026-09-21T20:30', place: null, placeTBD: true }
    ],
    deadlines: [
      { label: '预约截止', at: null, text: '通知未注明，仅说明“需提前预约”' }
    ],
    audience: '主要面向大一新生',
    zeroBase: true,
    needSignup: true,
    fee: null,
    duration: 90,
    capacity: 40,
    missing: ['预约截止时间', '地点', '预约方式', '费用'],
    warn: '通知明确写了“提交报名表不代表最终录取，以审核通知为准”。所以填完表还要留意审核结果，不要默认自己已经报上了。',
    raw: '9月21日19:00—20:30；主要面向大一新生；限40人；需提前预约，提交报名表不代表最终录取，以审核通知为准'
  },

  /* ---------- 15：两个截止时间 ---------- */
  {
    id: '15',
    title: 'AI应用创意挑战',
    source: 'org',
    category: 'competition',
    tags: ['AI', '个人或团队'],
    oneLiner: '两个节点别搞混：9月23日23:59前交创意方案，9月30日前交最终作品。可以先个人参加，进了展示环节再组队。',
    schedule: [],
    deadlines: [
      { label: '创意方案提交截止', at: '2026-09-23T23:59' },
      { label: '最终作品提交截止', at: '2026-09-30T23:59' }
    ],
    audience: '全校学生',
    zeroBase: null,
    needSignup: true,
    fee: null,
    commitment: null,
    capacity: null,
    missing: ['提交方式', '作品要求', '费用'],
    warn: '两个截止时间相隔一周，先记近的那个：9月23日23:59 交创意方案。',
    raw: '9月23日23:59前提交创意方案；9月30日前提交最终作品；允许个人或团队参加；进入展示环节后可再组队'
  },

  /* ---------- 16 ---------- */
  {
    id: '16',
    title: '校园摄影志愿者招募',
    source: 'org',
    category: 'volunteer',
    tags: ['摄影', '长期招募'],
    oneLiner: '长期给校内大型活动拍照，有摄影设备优先但不是硬性要求。通知里没写报名截止时间，长期有效。',
    schedule: [],
    deadlines: [
      { label: '报名截止', at: null, text: '长期招募，通知未注明截止' }
    ],
    audience: '全校学生',
    zeroBase: null,
    needSignup: true,
    fee: null,
    commitment: null,
    capacity: null,
    missing: ['报名截止时间', '报名方式', '服务时长是否计入志愿时长'],
    raw: '长期招募；参与校内大型活动摄影；具体报名截止时间未注明；有摄影设备者优先但不作硬性要求'
  },

  /* ---------- 17：资料长期开放，但提取信息有有效期 ---------- */
  {
    id: '17',
    title: 'Python程序设计学习资料合集',
    source: 'org',
    category: 'resource',
    tags: ['Python', '学习资料', '网盘'],
    oneLiner: '资料本身长期开放，但现在这份网盘提取信息只到9月22日有效，之后会统一更新。想存的话趁这两天。',
    schedule: [],
    deadlines: [
      { label: '当前网盘提取信息有效期', at: '2026-09-22T23:59', precision: 'day', note: '资料长期开放，后续将统一更新提取信息' }
    ],
    audience: '全校学生',
    zeroBase: true,
    needSignup: false,
    fee: null,
    commitment: null,
    capacity: null,
    missing: ['资料更新后的获取方式'],
    warn: '“资料长期开放”和“当前提取信息有效至9月22日”是两件事。9月22日之后这份链接/提取码可能失效，要及时保存。',
    raw: '包含课程、练习和项目案例；资料长期开放；当前网盘提取信息有效至9月22日，后续将统一更新'
  },

  /* ---------- 18：就在今晚 ---------- */
  {
    id: '18',
    title: '网络安全兴趣交流小组',
    source: 'org',
    category: 'interest',
    tags: ['CTF', 'Web安全', '不限基础'],
    oneLiner: '今天19:30第一次交流，之后每两周一次。聊 CTF、Web 安全这些方向，不限基础。',
    schedule: [
      { label: '首次交流', at: '2026-09-19T19:30', place: null, placeTBD: true },
      { label: '后续', at: null, text: '每两周开展一次' }
    ],
    deadlines: [],
    audience: '对CTF、Web安全等方向感兴趣的学生',
    zeroBase: true,
    needSignup: null,
    fee: null,
    commitment: '每两周一次',
    capacity: null,
    missing: ['地点', '是否需要报名', '费用'],
    raw: '首次交流时间为9月19日19:30；之后每两周开展一次；面向CTF、Web安全等方向感兴趣的学生；不限基础'
  },

  /* ---------- 19：报名已截止，只能候补 ---------- */
  {
    id: '19',
    title: '学生创新项目路演观摩',
    source: 'org',
    category: 'talk',
    tags: ['路演', '仅可候补'],
    oneLiner: '活动是9月20日14:30，但报名9月18日22:00就已经截止了。现场还有余位的话可以候补入场——不保证有位置。',
    schedule: [
      { label: '活动时间', at: '2026-09-20T14:30', place: null, placeTBD: true }
    ],
    deadlines: [
      { label: '报名截止（已过）', at: '2026-09-18T22:00' }
    ],
    standby: true,
    audience: '全校学生',
    zeroBase: true,
    needSignup: true,
    fee: null,
    commitment: null,
    capacity: null,
    missing: ['活动地点', '候补是否有优先顺序'],
    warn: '正式报名通道已经关闭。想去看只能碰运气：活动方原话是“如现场仍有余位，可接受候补入场”，并没有承诺有位置，别白跑一趟。',
    raw: '活动时间9月20日14:30；原报名截止时间为9月18日22:00；活动方说明如现场仍有余位，可接受候补入场'
  },

  /* ---------- 20：已在 03 的 updates 里，这里保留原文备查 ---------- */
  {
    id: '20',
    title: '创新创业项目团队补充说明',
    source: 'org',
    category: 'recruit',
    tags: ['补充通知'],
    mergedInto: '03',
    oneLiner: '这是 03 号“创新创业项目团队招募”的名额变更说明，已自动合并到原活动里。',
    schedule: [],
    deadlines: [],
    audience: null,
    missing: [],
    raw: '开发方向名额已满，现主要补充设计与材料成员；9月22日18:00截止；此前已投递者无需重复提交'
  },

  /* ---------- 21：唯一由学院明确发布的之一 ---------- */
  {
    id: '21',
    title: '计算机学院AI产品设计分享会',
    source: 'official',
    sourceName: '计算机学院',
    category: 'talk',
    tags: ['AI', '产品设计', '无需报名'],
    oneLiner: '计算机学院办的，9月20日19:00在明德楼B203，不用报名直接去，但座位有限。',
    schedule: [
      { label: '开始', at: '2026-09-20T19:00', place: '明德楼B203' }
    ],
    deadlines: [],
    audience: '全校学生',
    zeroBase: true,
    needSignup: false,
    fee: null,
    commitment: null,
    capacity: null,
    missing: ['结束时间', '费用'],
    warn: '无需报名，但通知里写了“座位有限”，建议提前一点到。',
    raw: '计算机学院发布；9月20日19:00；明德楼B203；面向全校学生；无需报名，座位有限'
  },

  /* ---------- 22—25：学生个人发布 ---------- */
  {
    id: '22',
    title: '学生发起｜周末羽毛球约球',
    source: 'student',
    category: 'interest',
    tags: ['羽毛球', '约球', 'AA'],
    oneLiner: '9月20日16:00打球，计划6—8人，费用AA。场地还没最终确认，出门前最好先问一下发起人。',
    schedule: [
      { label: '开始', at: '2026-09-20T16:00', place: null, placeTBD: true }
    ],
    deadlines: [],
    audience: '全校学生',
    zeroBase: true,
    needSignup: true,
    fee: 'AA（具体金额未提供）',
    commitment: null,
    capacity: 8,
    capacityText: '计划 6—8 人',
    missing: ['场地（待最终确认）', '报名方式', '联系方式'],
    risk: {
      level: 'low',
      reason: '发起人自己注明场地“待最终确认”。内容本身没有异常，只是出发前需要再确认一次。',
      advice: ['出发前与发起人确认场地是否已定', '费用AA，事先问清人均金额']
    },
    raw: '学生个人发布；9月20日16:00；计划6—8人；费用AA；场地待最终确认'
  },
  {
    id: '23',
    title: '学生发起｜AI工具交流搭子招募',
    source: 'student',
    category: 'interest',
    tags: ['AI', '找搭子', '零基础'],
    oneLiner: '9月21日晚上一起聊 AI 工具，零基础也欢迎。具体地点还没定，报名之后会拉群通知。',
    schedule: [
      { label: '拟开展', at: '2026-09-21T19:00', timeTBD: true, text: '9月21日晚（具体时间未定）', place: null, placeTBD: true }
    ],
    deadlines: [],
    audience: '全校学生',
    zeroBase: true,
    needSignup: true,
    fee: null,
    commitment: null,
    capacity: null,
    missing: ['具体时间', '具体地点', '费用', '发起人联系方式'],
    risk: {
      level: 'low',
      reason: '时间和地点都还未确定，需要报名后通过群通知确认。属于学生自发组织，尚未形成固定安排。',
      advice: ['报名后留意群内通知', '地点未定时避免提前出行']
    },
    raw: '学生个人发布；拟于9月21日晚开展；欢迎零基础；报名后拉群；具体地点未确定'
  },
  {
    id: '24',
    title: '学生发起｜“校园兼职福利分享”',
    source: 'student',
    category: 'interest',
    tags: ['兼职', '信息待核实'],
    oneLiner: '说是“零门槛、日结”，但没写主办方、地点和具体内容，只让你加私人微信。这类信息建议先别加。',
    schedule: [],
    deadlines: [],
    audience: '未注明',
    zeroBase: null,
    needSignup: null,
    fee: null,
    commitment: null,
    capacity: null,
    missing: ['主办方', '活动地点', '活动时间', '具体内容', '官方联系方式'],
    risk: {
      level: 'high',
      reason: '未提供主办方、地点和完整内容，以“零门槛、日结”作为吸引点，并要求添加私人微信获取详情。信息严重不完整，无法核实真伪。',
      advice: [
        '不要在未核实的情况下添加私人微信或转账',
        '不要提供身份证、银行卡等个人信息',
        '如需兼职，请通过学校官方渠道核实'
      ]
    },
    raw: '学生个人发布；称“零门槛、日结”，要求添加私人微信获取详情；未提供主办方、地点和完整内容'
  },
  {
    id: '25',
    title: '学生发起｜数码新品体验交流',
    source: 'student',
    category: 'interest',
    tags: ['数码', '疑似推广'],
    oneLiner: '标题写的是“技术交流”，正文其实在介绍某商家优惠和购买链接，活动时间和地点都没写。',
    schedule: [],
    deadlines: [],
    audience: '未注明',
    zeroBase: null,
    needSignup: null,
    fee: null,
    commitment: null,
    capacity: null,
    missing: ['活动时间', '活动地点', '主办方', '活动内容'],
    risk: {
      level: 'high',
      reason: '标题为“技术交流”，但正文主要内容是某商家的优惠信息和购买链接，且未注明活动时间、地点。与校园活动的关联较弱，判断为推广内容。',
      advice: [
        '谨慎点击正文中的购买链接',
        '注意区分推广内容与真实校园活动'
      ]
    },
    raw: '学生个人发布；标题为技术交流，正文主要介绍某商家优惠及购买链接；活动时间、地点未注明'
  },

  /* ---------- 26：另一个由学院明确发布的 ---------- */
  {
    id: '26',
    title: '外国语学院校园语言角',
    source: 'official',
    sourceName: '外国语学院',
    category: 'interest',
    tags: ['语言', '自由交流', '无需报名'],
    oneLiner: '外国语学院办的，9月21日15:00，自由交流，不用提前报名，但场地容量有限。',
    schedule: [
      { label: '开始', at: '2026-09-21T15:00', place: null, placeTBD: true }
    ],
    deadlines: [],
    audience: '全校学生',
    zeroBase: true,
    needSignup: false,
    fee: null,
    commitment: null,
    capacity: null,
    missing: ['活动地点', '结束时间', '使用的语种'],
    warn: '无需报名，但通知写明“场地容量有限”，去晚了可能进不去。',
    raw: '外国语学院发布；9月21日15:00；面向全校学生；自由交流；场地容量有限，无需提前报名'
  }
];

/* ---------- 展示用元数据 ---------- */

window.SOURCE_META = {
  official: { label: '学院/学校发布', short: '官方', icon: '🏛️' },
  org: { label: '校内组织发布', short: '组织', icon: '🏫' },
  student: { label: '学生个人发布', short: '学生', icon: '🙋' }
};

window.CATEGORY_META = {
  competition: { label: '竞赛', icon: '🏆' },
  training: { label: '训练营/工作坊', icon: '📚' },
  talk: { label: '讲座/分享会', icon: '🎤' },
  recruit: { label: '项目/团队招募', icon: '🤝' },
  volunteer: { label: '志愿服务', icon: '💚' },
  resource: { label: '学习资料', icon: '📦' },
  interest: { label: '兴趣活动', icon: '🎈' }
};

/* 「我需要做什么」清单模板：按条目已有的字段生成，没写的一律不出现 */
window.CHECKLIST_RULES = [
  { when: it => it.needSignup === true, text: '需要提前报名' },
  { when: it => it.needSignup === false, text: '无需报名，直接到场' },
  { when: it => it.needSignup === null, text: '是否需要报名通知未说明，建议先确认' },
  { when: it => it.capacity, text: it => `有名额限制：${it.capacityText || it.capacity + ' 人'}` },
  { when: it => it.fee && String(it.fee).startsWith('AA'), text: it => `费用：${it.fee}` },
  { when: it => it.fee === null && it.category !== 'resource', text: '费用未注明，涉及缴费请先确认' }
];
