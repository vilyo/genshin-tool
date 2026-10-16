/**
 * 领域错误分类(spec 02 §7):拉取管线全部错误类型,UI 按类型选文案的单一依据。
 * 各类 message 即中文默认文案(照 §7 文案方向,S7 过期文案为定稿原样);
 * 需要携带结构化信息的错误另给只读字段(retcode/detail/resolvedUid)供判定与日志。
 */

/** 缓存无链接/文件为空(spec 02 §7:引导玩家先在游戏内打开祈愿-历史记录页) */
export class CacheLinkNotFoundError extends Error {
  constructor(
    message = '未在游戏缓存中找到祈愿链接,请先在游戏内打开一次「祈愿-历史记录」页;若仍失败,可关闭游戏后清空 webCaches 目录再重试',
  ) {
    super(message)
    this.name = 'CacheLinkNotFoundError'
  }
}

/** 非 Windows 平台调自动探测(spec 02 §2/§7):macOS 唯一自动途径是手动粘贴 */
export class UnsupportedPlatformError extends Error {
  constructor(message = '当前平台不支持自动获取,macOS 请使用手动粘贴导入') {
    super(message)
    this.name = 'UnsupportedPlatformError'
  }
}

/** 粘贴/文件中无可识别链接、链接格式或参数不完整(spec 02 §7:检查链接完整性) */
export class LinkParseError extends Error {
  constructor(message = '未能从输入中识别有效的祈愿链接,请检查链接完整性') {
    super(message)
    this.name = 'LinkParseError'
  }
}

/** retcode −101 且 message 含 authkey timeout(S7 定稿文案,不展示错误码,可重试) */
export class LinkExpiredError extends Error {
  constructor(message = '祈愿链接已过期,请在游戏内重新打开祈愿记录页') {
    super(message)
    this.name = 'LinkExpiredError'
  }
}

/** retcode −101 且 message 含 authkey error(与过期区分文案,PRD F1.4) */
export class LinkInvalidError extends Error {
  constructor(message = '链接无效,请重新复制完整链接') {
    super(message)
    this.name = 'LinkInvalidError'
  }
}

/** 其余 retcode ≠ 0:展示官方 message,不重试(D11) */
export class ApiError extends Error {
  /** 官方返回的 retcode */
  readonly retcode: number
  constructor(retcode: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.retcode = retcode
  }
}

/** 网络类失败(连接/超时/HTTP 非 2xx/返回体非 JSON):唯一允许重试的错误(D14 重试 3 次) */
export class NetworkError extends Error {
  constructor(message = '网络请求失败,请检查网络后重试(已自动重试 3 次)') {
    super(message)
    this.name = 'NetworkError'
  }
}

/** D11 协议校验失败:立即中止整次同步,不入库已拉页之外的数据 */
export class ProtocolError extends Error {
  /** 失败细节(字段/原因),供日志排查,UI 不展示 */
  readonly detail?: string
  constructor(message = '官方返回数据异常,已中止本次同步', detail?: string) {
    super(message)
    this.name = 'ProtocolError'
    this.detail = detail
  }
}

/** 链接真实 uid 与目标档案不一致(spec 02 §6 uid 守卫):不落任何数据,UI 确认切换后重入 */
export class ArchiveMismatchError extends Error {
  /** 探底/首页确认出的链接归属 uid */
  readonly resolvedUid: string
  constructor(
    resolvedUid: string,
    message = `祈愿链接属于其他档案(UID:${resolvedUid}),请确认是否切换档案`,
  ) {
    super(message)
    this.name = 'ArchiveMismatchError'
    this.resolvedUid = resolvedUid
  }
}

/** 五池全空:该账号无任何可导入记录(spec 02 §6) */
export class EmptyHistoryError extends Error {
  constructor(message = '该账号没有任何祈愿记录,无可导入的内容') {
    super(message)
    this.name = 'EmptyHistoryError'
  }
}
