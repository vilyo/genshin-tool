/**
 * 常驻五星名单与「歪」判定(ADR-0003:常驻名单反向判定)。
 *
 * 口径:接口与 Excel 记录都不含「当期 UP 是谁」,歪判定只能反向——
 * 五星命中**出货当时**生效的常驻名单 = 歪(off: true),名单外 = 当期 UP(off: false)。
 * 与鸣潮的差异:原神常驻名单随版本扩充,判定取「since 上线日期 ≤ 出货日期」的
 * 名单子集,不得拿当前名单判全部历史。
 *
 * 适用范围:歪判定仅对角色活动祈愿(301/400 合并口径)由统计层(stats)调用;
 * 武器活动 75/25 的「歪」v1 不做(无定轨目标数据),常驻/新手/集录无 UP 概念不做。
 *
 * 失效模式与兜底(ADR-0003 §4,唯一失效模式):版本更新后名单未跟进,
 * 新常驻五星被误判为 UP——非空名称全名单查无 → 按 UP 处理并置 rosterStale 告警,
 * UI 在评价区提示更新应用;宁可信 UP 也不误报歪。
 */

/** 常驻名单条目:名称 + 类别 + 入常驻版本 */
export interface StandardRosterEntry {
  /** 中文名(拉取管线强制 lang=zh-cn 故 API 恒返回中文,Excel 本为中文,按名称精确匹配) */
  name: string
  /** 类别(名单元数据;判定按名称,不按类别过滤) */
  kind: 'character' | 'weapon'
  /** 入常驻版本号,须为 VERSION_RELEASE_DATES 的键 */
  since: string
}

/**
 * 常驻祈愿可获得的五星名单(截至 7.1,M0 研究票 §3.1/§3.2 核实):
 * - 五星角色 8 位:迪卢克/琴/莫娜/七七/刻晴 1.0 开服、提纳里 3.1、迪希雅 3.6、梦见月瑞希 5.5;
 * - 五星武器 10 把:全部 1.0 开服成员,迄今从未新增。
 * 维护信号唯一且明确:官方版本更新说明句式「将在下一版本进入『奔行世间』常驻祈愿」
 * (迄今仅 3.1/3.6/5.5 三例)。增补条目时须随条目在 VERSION_RELEASE_DATES 补上线日期
 * (快照测试钉死日期表与 since 集合一致);严禁凭印象添加——
 * 社区 fork 曾把限定武器黎明破晓之史误入名单,反例测试已钉死。
 */
export const STANDARD_ROSTER: ReadonlyArray<StandardRosterEntry> = [
  { name: '迪卢克', kind: 'character', since: '1.0' },
  { name: '琴', kind: 'character', since: '1.0' },
  { name: '莫娜', kind: 'character', since: '1.0' },
  { name: '七七', kind: 'character', since: '1.0' },
  { name: '刻晴', kind: 'character', since: '1.0' },
  { name: '提纳里', kind: 'character', since: '3.1' },
  { name: '迪希雅', kind: 'character', since: '3.6' },
  { name: '梦见月瑞希', kind: 'character', since: '5.5' },
  { name: '天空之刃', kind: 'weapon', since: '1.0' },
  { name: '天空之傲', kind: 'weapon', since: '1.0' },
  { name: '天空之脊', kind: 'weapon', since: '1.0' },
  { name: '天空之卷', kind: 'weapon', since: '1.0' },
  { name: '天空之翼', kind: 'weapon', since: '1.0' },
  { name: '风鹰剑', kind: 'weapon', since: '1.0' },
  { name: '狼的末路', kind: 'weapon', since: '1.0' },
  { name: '和璞鸢', kind: 'weapon', since: '1.0' },
  { name: '四风原典', kind: 'weapon', since: '1.0' },
  { name: '阿莫斯之弓', kind: 'weapon', since: '1.0' },
]

/**
 * 版本 → 上线日期表(均为 UTC+8 开启日,YYYY-MM-DD)。
 * 后续新增常驻时随名单条目一并增补(快照测试钉死键集合与名单 since 集合一致)。
 */
export const VERSION_RELEASE_DATES: Record<string, string> = {
  '1.0': '2020-09-28',
  '3.1': '2022-09-28',
  '3.6': '2023-04-12',
  '5.5': '2025-03-12',
}

/**
 * 名称在出货当时是否命中生效常驻名单(ADR-0003 决策 2 的底层判定)。
 *
 * - true:名单中有该名称,且其 since 上线日期 ≤ time 日期部分(当时已常驻,判歪);
 * - false:名单中有该名称,但当时尚未入常驻——这是限定池时期的该角色、后来才入常驻,
 *   出货当时必是当期 UP,属正常历史而非名单过期(不置任何告警);
 * - null:全名单查无此名 → 调用方按 UP 处理并置 rosterStale(见 standardVerdict)。
 *
 * 日期比较用字符串字典序:time 存原样如 `2026-09-23 21:14:36`,取前 10 字符,
 * 双方同为 YYYY-MM-DD 格式,字典序即时间序。
 * 已知局限(ADR-0003 后果):国际服 time 为服务器本地时区,与 UTC+8 上线日比较,
 * 在常驻新增日前后数小时窗口内可能误判(仅提纳里/迪希雅/梦见月瑞希三例的
 * 入常驻首日抽取),影响可忽略,不做时区换算。
 */
export function isStandardAt(name: string, time: string): boolean | null {
  const entry = STANDARD_ROSTER.find((item) => item.name === name)
  if (!entry) return null
  const sinceDate: string | undefined = VERSION_RELEASE_DATES[entry.since]
  // 快照测试钉死日期表与 since 集合一致;漏配日期属维护事故,按「宁可信 UP」保守处理
  if (sinceDate !== undefined && time.slice(0, 10) >= sinceDate) return true
  return false
}

/**
 * 名称是否在常驻全名单(不判生效日期)。池级「名单可能过期」旗标的检查用
 * (T17 返工口径):新常驻成员入池必被常驻池抽到,常驻池出现全名单查无的五星
 * 即为名单过期的可判信号;限定 UP 不经此路径触发池级旗标。
 */
export function isStandardName(name: string): boolean {
  return STANDARD_ROSTER.some((item) => item.name === name)
}

/** 歪判定结论(供统计层 FiveStarPull.off / rosterStale 消费,ADR-0003 §4) */
export interface StandardVerdict {
  /** true=歪(命中当时生效名单) false=当期 UP null=无法判定(仅名称空串,不入歪率分母) */
  off: true | false | null
  /** 名单可能过期:非空名称全名单查无,已按 UP 处理,UI 须提示更新应用 */
  rosterStale: boolean
}

/**
 * 常驻名单反向判定(便捷入口):
 * - 名称空串 → off null 不武断判 UP(即 ADR-0003 的 'unknown' 语义,不置 stale;
 *   入库层已把空名拦截为 ProtocolError,到统计层不可达,stats 侧 H14 防御分支兜底);
 * - 全名单查无此名 → 按 UP 处理(off: false)并置 rosterStale 告警(唯一失效模式);
 * - 名单内但当时未入常驻 → off: false(正常历史,当时必是 UP,见 isStandardAt);
 * - 命中当时生效子集 → off: true(歪)。
 * rankType 仅随记录整体传入(歪判定只对五星有意义),本函数只消费 name/time。
 */
export function standardVerdict(record: {
  name: string
  time: string
  rankType: number
}): StandardVerdict {
  if (!record.name) return { off: null, rosterStale: false }
  const hit = isStandardAt(record.name, record.time)
  // hit null = 非空名称查无此名:按 UP 处理并置名单过期告警(ADR-0003 §4)
  if (hit === null) return { off: false, rosterStale: true }
  return { off: hit, rosterStale: false }
}
