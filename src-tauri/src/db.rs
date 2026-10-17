//! 本地 SQLite 档案存储(spec 01 §4–§5):三表 archives / pull_records / sync_watermarks,
//! 一档案 = 一 uid,一切读写按 uid 作用域。每行 = 独立的一抽(同键多抽多行,禁止合并/丢弃),
//! 合并去重在前端 domain/records 完成,这里的两条唯一索引只是第二道幂等保险。
//! 与鸣潮 db.rs 的差异:id 可空(迁入行无 id)+ 部分唯一索引、sync_watermarks 水位表、
//! clear_archive 必须连水位同事务清除(鸣潮只删记录表,勿照抄)。

use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub const DB_FILE_NAME: &str = "genshintool.db";

/// 连接忙等上限:写入口并发时不立即报 SQLITE_BUSY,而是等待持锁方释放
const DB_BUSY_TIMEOUT: Duration = Duration::from_secs(3);

/// schema 与 spec 01 §4 DDL 逐字一致,启动时幂等执行(鸣潮 migrate 模式)
pub const SCHEMA_SQL: &str = "
CREATE TABLE IF NOT EXISTS archives (
  uid             TEXT PRIMARY KEY,   -- '0' 为「未关联 UID」哨兵档案(见 03 spec §7)
  created_at      TEXT NOT NULL,      -- ISO 8601
  last_synced_at  TEXT                -- 最近一次拉取同步成功完成时间(ISO 8601);迁入不写此列
);
CREATE TABLE IF NOT EXISTS pull_records (
  rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         TEXT NOT NULL,
  gacha_type  INTEGER NOT NULL,
  time        TEXT NOT NULL,
  name        TEXT NOT NULL,
  rank_type   INTEGER NOT NULL,
  id          TEXT,               -- NULL = 非接口来源
  seq         INTEGER NOT NULL DEFAULT 0
);
-- 完整同步水位(拉取管线用,见 02 spec D12):在该池拉取正常收尾时推进——
-- 空页(完整拉取)或增量提前停(已验证「最新→水位」区段完整落库)均可;
-- 唯独中断不推进 → 下次全量重拉,杜绝「部分同步后增量提前停」造成的旧历史空洞
CREATE TABLE IF NOT EXISTS sync_watermarks (
  uid          TEXT NOT NULL,
  gacha_type   INTEGER NOT NULL,
  watermark_id TEXT NOT NULL,     -- 该池上次正常收尾时覆盖到的最大 id(空池置 '0')
  PRIMARY KEY (uid, gacha_type)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_records_natural
  ON pull_records (uid, gacha_type, time, name, rank_type, seq);
CREATE UNIQUE INDEX IF NOT EXISTS idx_records_api_id
  ON pull_records (uid, gacha_type, id) WHERE id IS NOT NULL;
";

/// 单条祈愿记录入参:字段名与 TS 侧 WishRecord 对齐(spec 01 §1)。
/// `seq` 不由前端传入:写入时按「该精确键在库内的既有份数 + 批内序号」计算。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WishRecord {
    pub gacha_type: i64,
    /// 服务器时区本地时间串,存原样永不转换
    pub time: String,
    pub name: String,
    pub rank_type: i64,
    /// 接口 19 位数字 id;迁入行为 null
    pub id: Option<String>,
}

/// 落库行 = WishRecord + 存储序号(与 TS 侧 StoredRecord 对齐;seq/rowid 不导出、不备份)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRecord {
    pub gacha_type: i64,
    pub time: String,
    pub name: String,
    pub rank_type: i64,
    pub id: Option<String>,
    /// 同精确键 (gacha_type,time,name,rank_type) 内的出现序号,0 起
    pub seq: i64,
    /// SQLite rowid,会话内寻址用(身份回填)
    pub rowid: i64,
}

/// 身份回填项(E4/E6 的落库动作):按 rowid 回填 id;gacha_type 缺省不动原值
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityUpdate {
    pub rowid: i64,
    pub id: String,
    pub gacha_type: Option<i64>,
}

/// 档案摘要(一个 UID 一份档案)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSummary {
    pub uid: String,
    pub created_at: String,
    pub last_synced_at: Option<String>,
}

pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA_SQL)
}

/// 单事务批量写入(spec 01 §4;鸣潮 seq 幂等模式平移)。
/// seq = 该精确键在库内的既有份数 + 本批内的出现序号;不用 INSERT OR IGNORE——
/// 唯一索引冲突必须按错误上抛(第二道保险,spec E10),不得静默吞行。返回实际新增行数。
pub fn insert_records(
    conn: &Connection,
    uid: &str,
    records: &[WishRecord],
) -> rusqlite::Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let mut inserted = 0;
    {
        // 凡落记录必建档行(list_archives 不漏档);已存在时保留原 created_at/last_synced_at
        tx.execute(
            "INSERT INTO archives (uid, created_at) VALUES (?1, ?2) ON CONFLICT(uid) DO NOTHING",
            params![uid, now_iso()],
        )?;
        let mut stmt_count = tx.prepare(
            "SELECT COUNT(*) FROM pull_records
             WHERE uid=?1 AND gacha_type=?2 AND time=?3 AND name=?4 AND rank_type=?5",
        )?;
        let mut stmt_ins = tx.prepare(
            "INSERT INTO pull_records (uid, gacha_type, time, name, rank_type, id, seq)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        let mut batch_mult: HashMap<(i64, String, String, i64), i64> = HashMap::new();
        for record in records {
            let key = (
                record.gacha_type,
                record.time.clone(),
                record.name.clone(),
                record.rank_type,
            );
            let seen = batch_mult.entry(key).or_insert_with(|| {
                stmt_count
                    .query_row(
                        params![uid, record.gacha_type, record.time, record.name, record.rank_type],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap_or(0)
            });
            let seq = *seen;
            *seen += 1;
            inserted += stmt_ins.execute(params![
                uid,
                record.gacha_type,
                record.time,
                record.name,
                record.rank_type,
                record.id,
                seq,
            ])?;
        }
    }
    tx.commit()?;
    Ok(inserted)
}

/// 按 rowid 回填 id / gacha_type(单事务);gacha_type 传 null 时不动原值。
/// 只在 domain mergeRecords 产出 upgrades 后调用。
pub fn update_identity(
    conn: &Connection,
    updates: &[IdentityUpdate],
) -> rusqlite::Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let mut updated = 0;
    {
        let mut stmt = tx.prepare(
            "UPDATE pull_records SET id = ?2, gacha_type = COALESCE(?3, gacha_type)
             WHERE rowid = ?1",
        )?;
        for u in updates {
            updated += stmt.execute(params![u.rowid, u.id, u.gacha_type])?;
        }
    }
    tx.commit()?;
    Ok(updated)
}

/// UPSERT 完整同步水位(仅拉取正常收尾调用——空页或提前停;中断绝不调用,spec 02 D12)
pub fn set_watermark(
    conn: &Connection,
    uid: &str,
    gacha_type: i64,
    watermark_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO sync_watermarks (uid, gacha_type, watermark_id) VALUES (?1, ?2, ?3)
         ON CONFLICT(uid, gacha_type) DO UPDATE SET watermark_id = excluded.watermark_id",
        params![uid, gacha_type, watermark_id],
    )?;
    Ok(())
}

/// 该池上次正常收尾覆盖到的最大 id;null = 从未正常收尾(从未同步,或上次同步中断)
pub fn get_watermark(
    conn: &Connection,
    uid: &str,
    gacha_type: i64,
) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT watermark_id FROM sync_watermarks WHERE uid = ?1 AND gacha_type = ?2",
        params![uid, gacha_type],
        |row| row.get(0),
    )
    .optional()
}

/// 同步成功收尾写 archives.last_synced_at(spec 02:任一池失败则不写)
pub fn set_last_synced(conn: &Connection, uid: &str, iso: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE archives SET last_synced_at = ?2 WHERE uid = ?1",
        params![uid, iso],
    )?;
    Ok(())
}

/// 清空档案数据(PRD F4,UI 二次确认后):记录、水位、last_synced_at 同事务清除,
/// archives 行保留(档案以空态存在)。水位必须与记录同删——残留水位会让清空后的
/// 重新拉取只重建最新一页(spec 01 §4)。返回删除的记录条数。
pub fn clear_archive(conn: &Connection, uid: &str) -> rusqlite::Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let deleted = tx.execute("DELETE FROM pull_records WHERE uid = ?1", params![uid])?;
    tx.execute("DELETE FROM sync_watermarks WHERE uid = ?1", params![uid])?;
    tx.execute(
        "UPDATE archives SET last_synced_at = NULL WHERE uid = ?1",
        params![uid],
    )?;
    tx.commit()?;
    Ok(deleted)
}

/// 读取指定档案全部记录,SQL 侧按 §2 比较器预排序
/// (time 升序 → 无 id 行在前 → id 数值升序 → rowid 导入序;装载后 domain 仍会稳定排序为最终口径)
pub fn load_records(conn: &Connection, uid: &str) -> rusqlite::Result<Vec<StoredRecord>> {
    let mut stmt = conn.prepare(
        "SELECT rowid, gacha_type, time, name, rank_type, id, seq
         FROM pull_records
         WHERE uid = ?1
         ORDER BY time, (id IS NULL) DESC, CAST(id AS INTEGER), rowid",
    )?;
    let rows = stmt.query_map(params![uid], |row| {
        Ok(StoredRecord {
            rowid: row.get(0)?,
            gacha_type: row.get(1)?,
            time: row.get(2)?,
            name: row.get(3)?,
            rank_type: row.get(4)?,
            id: row.get(5)?,
            seq: row.get(6)?,
        })
    })?;
    rows.collect()
}

/// 来源接口行 (gacha_type,id) 已存在于目标 → 丢来源行保目标行(E4 永不降级)。
/// 身份注入步骤后复用:清除已被注入消费的来源行(其身份已落在目标行上)。
fn delete_api_id_duplicates(conn: &Connection, from: &str, to: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM pull_records
         WHERE uid = ?1 AND id IS NOT NULL
           AND EXISTS (SELECT 1 FROM pull_records t
                       WHERE t.uid = ?2 AND t.gacha_type = pull_records.gacha_type
                         AND t.id = pull_records.id)",
        params![from, to],
    )
}

/// 迁移档案(spec 01 §5:'0' 哨兵 → 真实 uid,单事务)。对账口径对齐 domain mergeRecords
/// (§3,含 ADR-0002 类别桶):
/// ①来源接口行 (gacha_type,id) 目标已有 → 丢来源行保目标行(E4 永不降级);
/// ②来源接口行与目标同精确键无 id 行(gacha_type,time,name,rank_type,seq 全等且目标行
///   id IS NULL,自然索引保证各自至多一行)为同一抽 → 身份注入升级目标行,类别内 code
///   以后到的接口侧为权威(E6),来源行清除;
/// ③来源无 id 行按类别桶(301/400 同桶,错标不双份)+ 份数闸门:桶内 (time,name,rank_type)
///   第 nth 份,目标已有 cnt 份(含任意 id)时 nth ≤ cnt 为重复丢弃,超出部分迁移
///   (合并后份数 = max(既有, 迁入),E2/E5);
/// ④余下行整体 UPDATE uid。目标 archives 行 UPSERT;来源档案行保留(空档存在)。
/// 返回实际迁移的行数。
pub fn migrate_archive(conn: &Connection, from: &str, to: &str) -> rusqlite::Result<usize> {
    if from == to {
        return Ok(0); // 同 uid 迁移无意义,且对账 DELETE 会误删自身行,必须先挡下
    }
    let tx = conn.unchecked_transaction()?;
    let moved;
    {
        delete_api_id_duplicates(&tx, from, to)?;
        tx.execute(
            "UPDATE pull_records AS t
             SET id = s.id, gacha_type = s.gacha_type
             FROM pull_records AS s
             WHERE s.uid = ?1 AND s.id IS NOT NULL
               AND t.uid = ?2 AND t.id IS NULL
               AND s.gacha_type = t.gacha_type AND s.time = t.time
               AND s.name = t.name AND s.rank_type = t.rank_type AND s.seq = t.seq",
            params![from, to],
        )?;
        delete_api_id_duplicates(&tx, from, to)?;
        tx.execute(
            "DELETE FROM pull_records WHERE rowid IN (
               SELECT s.rid FROM (
                 SELECT rowid AS rid,
                        CASE WHEN gacha_type IN (301,400) THEN 0 ELSE gacha_type END AS bucket,
                        time, name, rank_type,
                        ROW_NUMBER() OVER (
                          PARTITION BY CASE WHEN gacha_type IN (301,400) THEN 0 ELSE gacha_type END,
                                   time, name, rank_type
                          ORDER BY seq, rowid
                        ) AS nth
                 FROM pull_records WHERE uid = ?1 AND id IS NULL
               ) s
               WHERE s.nth <= (SELECT COUNT(*) FROM pull_records t
                               WHERE t.uid = ?2
                                 AND CASE WHEN t.gacha_type IN (301,400) THEN 0 ELSE t.gacha_type END = s.bucket
                                 AND t.time = s.time AND t.name = s.name AND t.rank_type = s.rank_type)
             )",
            params![from, to],
        )?;
        moved = tx.execute("UPDATE pull_records SET uid = ?2 WHERE uid = ?1", params![from, to])?;
        tx.execute(
            "INSERT INTO archives (uid, created_at) VALUES (?1, ?2) ON CONFLICT(uid) DO NOTHING",
            params![to, now_iso()],
        )?;
    }
    tx.commit()?;
    Ok(moved)
}

/// 档案列表(创建时间升序,确定序)
pub fn list_archives(conn: &Connection) -> rusqlite::Result<Vec<ArchiveSummary>> {
    let mut stmt =
        conn.prepare("SELECT uid, created_at, last_synced_at FROM archives ORDER BY created_at, uid")?;
    let rows = stmt.query_map([], |row| {
        Ok(ArchiveSummary {
            uid: row.get(0)?,
            created_at: row.get(1)?,
            last_synced_at: row.get(2)?,
        })
    })?;
    rows.collect()
}

/// 确保档案行存在(幂等;'0' 哨兵档案由迁入侧显式创建,spec 03 §7)
pub fn ensure_archive(conn: &Connection, uid: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO archives (uid, created_at) VALUES (?1, ?2) ON CONFLICT(uid) DO NOTHING",
        params![uid, now_iso()],
    )?;
    Ok(())
}

/// 当前时刻 ISO 8601(UTC,Z 后缀毫秒精度,与前端 toISOString 同形)。
/// 不引 chrono,内置公历换算(Hinnant civil_from_days)。
pub fn now_iso() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    iso_from_unix_millis(now.as_millis() as i64)
}

fn iso_from_unix_millis(unix_millis: i64) -> String {
    let secs = unix_millis.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year,
        month,
        day,
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60,
        unix_millis.rem_euclid(1000)
    )
}

/// 天数(1970-01-01 起)→ (年, 月, 日),公历
fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097); // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 连接级配置:WAL(同步中途进程崩溃不留半写)+ busy_timeout(并发写忙等而非立即失败)
pub fn configure_connection(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.busy_timeout(DB_BUSY_TIMEOUT)
}

/// 打开(必要时创建)数据目录下的库文件并确保 schema 存在
fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("定位应用数据目录失败:{e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建应用数据目录失败:{e}"))?;
    let conn =
        Connection::open(dir.join(DB_FILE_NAME)).map_err(|e| format!("打开本地数据库失败:{e}"))?;
    configure_connection(&conn).map_err(|e| format!("配置本地数据库失败:{e}"))?;
    init_schema(&conn).map_err(|e| format!("初始化本地数据库失败:{e}"))?;
    Ok(conn)
}

/// 批量写入祈愿记录(单事务;同键多抽按 seq 区分,每行=一抽),返回实际新增行数
#[tauri::command(async)]
pub fn db_insert_records(
    app: AppHandle,
    uid: String,
    rows: Vec<WishRecord>,
) -> Result<usize, String> {
    let conn = open_db(&app)?;
    insert_records(&conn, &uid, &rows).map_err(|e| format!("写入祈愿记录失败:{e}"))
}

/// 按 rowid 批量回填接口身份(单事务),返回实际更新的行数
#[tauri::command(async)]
pub fn db_update_identity(
    app: AppHandle,
    updates: Vec<IdentityUpdate>,
) -> Result<usize, String> {
    let conn = open_db(&app)?;
    update_identity(&conn, &updates).map_err(|e| format!("回填记录身份失败:{e}"))
}

/// UPSERT 完整同步水位(仅拉取正常收尾调用;中断绝不调用)
#[tauri::command(async)]
pub fn db_set_watermark(
    app: AppHandle,
    uid: String,
    gacha_type: i64,
    id: String,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    set_watermark(&conn, &uid, gacha_type, &id).map_err(|e| format!("写入同步水位失败:{e}"))
}

/// 读取该池同步水位;null = 从未正常收尾
#[tauri::command(async)]
pub fn db_get_watermark(
    app: AppHandle,
    uid: String,
    gacha_type: i64,
) -> Result<Option<String>, String> {
    let conn = open_db(&app)?;
    get_watermark(&conn, &uid, gacha_type).map_err(|e| format!("读取同步水位失败:{e}"))
}

/// 同步成功收尾写 last_synced_at(spec 02:任一池失败则不写)
#[tauri::command(async)]
pub fn db_set_last_synced(app: AppHandle, uid: String, iso: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    set_last_synced(&conn, &uid, &iso).map_err(|e| format!("写入同步时间失败:{e}"))
}

/// 清空档案(记录 + 水位 + last_synced_at 同事务;archives 行保留),返回删除条数
#[tauri::command(async)]
pub fn db_clear_archive(app: AppHandle, uid: String) -> Result<usize, String> {
    let conn = open_db(&app)?;
    clear_archive(&conn, &uid).map_err(|e| format!("清空档案失败:{e}"))
}

/// 读取指定档案的全部记录(SQL 预排序 = spec 01 §2 比较器序)
#[tauri::command(async)]
pub fn db_load_records(app: AppHandle, uid: String) -> Result<Vec<StoredRecord>, String> {
    let conn = open_db(&app)?;
    load_records(&conn, &uid).map_err(|e| format!("读取祈愿记录失败:{e}"))
}

/// 迁移档案('0' 哨兵 → 真实 uid;单事务,目标已有数据时按合并语义对账)
#[tauri::command(async)]
pub fn db_migrate_archive(app: AppHandle, from: String, to: String) -> Result<usize, String> {
    let conn = open_db(&app)?;
    migrate_archive(&conn, &from, &to).map_err(|e| format!("迁移档案失败:{e}"))
}

/// 档案列表(重启后恢复最近档案等)
#[tauri::command(async)]
pub fn db_list_archives(app: AppHandle) -> Result<Vec<ArchiveSummary>, String> {
    let conn = open_db(&app)?;
    list_archives(&conn).map_err(|e| format!("读取档案列表失败:{e}"))
}

/// 确保档案行存在(幂等;迁入侧建 '0' 哨兵、同步侧建档均走此命令)
#[tauri::command(async)]
pub fn db_ensure_archive(app: AppHandle, uid: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    ensure_archive(&conn, &uid).map_err(|e| format!("创建档案失败:{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().expect("内存库应可打开");
        init_schema(&conn).expect("schema 应可初始化");
        conn
    }

    /// 构造单条记录;id 传 None 即迁入行形态
    fn wish(gacha_type: i64, time: &str, name: &str, rank_type: i64, id: Option<&str>) -> WishRecord {
        WishRecord {
            gacha_type,
            time: time.into(),
            name: name.into(),
            rank_type,
            id: id.map(String::from),
        }
    }

    /// 备份 records 数组形态:剥离 seq/rowid
    fn wish_view(stored: &[StoredRecord]) -> Vec<WishRecord> {
        stored
            .iter()
            .map(|s| WishRecord {
                gacha_type: s.gacha_type,
                time: s.time.clone(),
                name: s.name.clone(),
                rank_type: s.rank_type,
                id: s.id.clone(),
            })
            .collect()
    }

    fn seqs_of(conn: &Connection, uid: &str, gacha_type: i64, name: &str) -> Vec<i64> {
        let mut stmt = conn
            .prepare(
                "SELECT seq FROM pull_records WHERE uid=?1 AND gacha_type=?2 AND name=?3 ORDER BY seq",
            )
            .unwrap();
        stmt.query_map(params![uid, gacha_type, name], |row| row.get(0))
            .unwrap()
            .map(|s| s.unwrap())
            .collect()
    }

    #[test]
    fn e9_insert_assigns_dense_seq_per_exact_key() {
        let conn = memory_db();
        let uid = "900000001";
        let batch = vec![
            wish(301, "2026-09-23 21:14:36", "那维莱特", 5, None),
            wish(301, "2026-09-23 21:14:36", "祭礼剑", 4, None),
            wish(301, "2026-09-23 21:14:36", "祭礼剑", 4, None), // 同键第 2 份(十连同名同星)
            wish(302, "2026-09-23 21:14:36", "祭礼剑", 4, None), // 池不同 = 独立精确键
        ];
        assert_eq!(insert_records(&conn, uid, &batch).unwrap(), 4);
        assert_eq!(seqs_of(&conn, uid, 301, "祭礼剑"), [0, 1]);
        assert_eq!(seqs_of(&conn, uid, 301, "那维莱特"), [0]);
        assert_eq!(seqs_of(&conn, uid, 302, "祭礼剑"), [0]);

        // 第二批补同键 2 份:seq 自库内既有份数续排(稠密不跳号)
        let more = vec![
            wish(301, "2026-09-23 21:14:36", "祭礼剑", 4, None),
            wish(301, "2026-09-23 21:14:36", "祭礼剑", 4, None),
        ];
        assert_eq!(insert_records(&conn, uid, &more).unwrap(), 2);
        assert_eq!(seqs_of(&conn, uid, 301, "祭礼剑"), [0, 1, 2, 3]);

        // 有 id 的同键多份同样稠密(id 不入精确键)
        let with_ids = vec![
            wish(301, "2026-09-23 21:14:36", "西风剑", 3, Some("1810000000000000001")),
            wish(301, "2026-09-23 21:14:36", "西风剑", 3, Some("1810000000000000002")),
        ];
        assert_eq!(insert_records(&conn, uid, &with_ids).unwrap(), 2);
        assert_eq!(seqs_of(&conn, uid, 301, "西风剑"), [0, 1]);
    }

    #[test]
    fn e10_unique_indexes_reject_duplicate_inserts() {
        let conn = memory_db();
        let uid = "900000001";
        let row = wish(301, "2026-09-23 21:14:36", "那维莱特", 5, Some("1800000000000000001"));
        assert_eq!(insert_records(&conn, uid, &[row.clone()]).unwrap(), 1);

        // 接口精确身份 (uid,gacha_type,id) 二次插入 → 部分唯一索引拒绝(第二道保险,E10)
        let err = insert_records(&conn, uid, &[row]).unwrap_err();
        assert!(err.to_string().contains("UNIQUE"), "应为唯一约束错误:{err}");

        // 自然键唯一索引兜底:绕过 seq 分配直插同键同 seq 同样被拒
        let raw = conn.execute(
            "INSERT INTO pull_records (uid, gacha_type, time, name, rank_type, id, seq)
             VALUES (?1, 301, '2026-09-23 21:14:36', '那维莱特', 5, '1800000000000000002', 0)",
            params![uid],
        );
        assert!(raw.is_err());
    }

    #[test]
    fn e11_backup_roundtrip_storage_side_reinsert_idempotent() {
        let conn = memory_db();
        let uid = "900000001";
        // 混合形态:接口行(有 id)+ 迁入行(无 id)+ 同键多份
        let first = vec![
            wish(301, "2026-09-23 21:14:36", "那维莱特", 5, Some("1800000000000000001")),
            wish(301, "2026-09-23 21:14:36", "祭礼剑", 4, None),
            wish(301, "2026-09-23 21:14:36", "祭礼剑", 4, None),
            wish(400, "2026-09-24 12:00:00", "钟离", 5, Some("1800000000000000002")),
        ];
        assert_eq!(insert_records(&conn, uid, &first).unwrap(), 4);

        // 导出 = load_records 剥离 seq/rowid(备份 records 数组,SQL 预排序即 §2 序)
        let exported = wish_view(&load_records(&conn, uid).unwrap());

        // 导入(存储侧)= 清空后按导出重插:seq 按同规则重建,记录集逐字段相等
        assert_eq!(clear_archive(&conn, uid).unwrap(), 4);
        assert_eq!(insert_records(&conn, uid, &exported).unwrap(), 4);
        let reloaded = load_records(&conn, uid).unwrap();
        assert_eq!(wish_view(&reloaded), exported);
        assert_eq!(seqs_of(&conn, uid, 301, "祭礼剑"), [0, 1]); // seq 重建后仍稠密稳定

        // 幂等:同一批原样重插(不经域内合并过滤)被唯一索引整体拒绝——
        // 配合 mergeRecords 过滤后 added=0,备份反复导入不产生重复行
        assert!(insert_records(&conn, uid, &exported).is_err());
    }

    #[test]
    fn e12_migrate_archive_conserves_row_count() {
        let conn = memory_db();
        let from = "0";
        let to = "900000001";
        let rows = vec![
            wish(301, "2026-09-23 21:14:36", "那维莱特", 5, Some("1800000000000000001")),
            wish(301, "2026-09-23 21:14:36", "祭礼剑", 4, None),
            wish(302, "2026-09-23 22:00:00", "护摩之杖", 5, None),
        ];
        assert_eq!(insert_records(&conn, from, &rows).unwrap(), 3);

        assert_eq!(migrate_archive(&conn, from, to).unwrap(), 3);
        assert!(load_records(&conn, from).unwrap().is_empty());
        assert_eq!(load_records(&conn, to).unwrap().len(), 3); // 行数守恒
        // 目标档案行由迁移 UPSERT 创建;来源档案行保留(空档存在)
        let archives = list_archives(&conn).unwrap();
        assert!(archives.iter().any(|a| a.uid == to));
        assert!(archives.iter().any(|a| a.uid == from));
    }

    #[test]
    fn e12_migrate_reconciles_overlapping_target_per_merge_semantics() {
        let conn = memory_db();
        let from = "0";
        let to = "900000001";
        // 来源('0'):同键 K 三份无 id(seq 0/1/2)+ 接口行 id=A
        insert_records(
            &conn,
            from,
            &[
                wish(301, "2026-09-23 21:14:36", "祭礼剑", 4, None),
                wish(301, "2026-09-23 21:14:36", "祭礼剑", 4, None),
                wish(301, "2026-09-23 21:14:36", "祭礼剑", 4, None),
                wish(301, "2026-09-24 08:00:00", "钟离", 5, Some("1800000000000000009")),
            ],
        )
        .unwrap();
        // 目标:键 K 已有 1 份(接口行 id=B)+ 与来源相同的 id=A 行
        insert_records(
            &conn,
            to,
            &[
                wish(301, "2026-09-23 21:14:36", "祭礼剑", 4, Some("1800000000000000008")),
                wish(301, "2026-09-24 08:00:00", "钟离", 5, Some("1800000000000000009")),
            ],
        )
        .unwrap();

        // 对账:id=A 与目标重复 → 丢来源行;K 第 1 份与目标第 1 份同抽 → 丢来源行;
        // K 第 2/3 份超出目标份数 → 迁移。合并后 K 份数 = max(3,1) = 3(E2 只增不减)
        assert_eq!(migrate_archive(&conn, from, to).unwrap(), 2);
        assert!(load_records(&conn, from).unwrap().is_empty());
        let merged = load_records(&conn, to).unwrap();
        assert_eq!(merged.len(), 4); // 祭礼剑×3(id=B 1 份 + 迁入 2 份无 id)+ 钟离×1(目标原有)
        let swords: Vec<&StoredRecord> = merged.iter().filter(|r| r.name == "祭礼剑").collect();
        assert_eq!(swords.len(), 3);
        let by_seq = |s: i64| swords.iter().find(|r| r.seq == s).unwrap();
        assert_eq!(by_seq(0).id.as_deref(), Some("1800000000000000008")); // 目标行原样保留
        assert!(by_seq(1).id.is_none());
        assert!(by_seq(2).id.is_none());
        assert_eq!(merged.iter().filter(|r| r.name == "钟离").count(), 1);
    }

    #[test]
    fn e12_migrate_dedupes_cross_code_mislabeled_row() {
        let conn = memory_db();
        let from = "0";
        let to = "900000001";
        // 来源 Excel 行备注错标 301(无 id);目标接口行同一抽是 400(有 id)——
        // 精确 code 不等,须按类别桶(301/400 同桶,ADR-0002)对账,否则同一抽计双份
        insert_records(&conn, from, &[wish(301, "2026-09-23 21:14:36", "钟离", 5, None)]).unwrap();
        insert_records(
            &conn,
            to,
            &[wish(400, "2026-09-23 21:14:36", "钟离", 5, Some("1800000000000000001"))],
        )
        .unwrap();

        assert_eq!(migrate_archive(&conn, from, to).unwrap(), 0);
        let merged = load_records(&conn, to).unwrap();
        assert_eq!(merged.len(), 1); // 同一抽仅 1 行
        assert_eq!(merged[0].id.as_deref(), Some("1800000000000000001")); // 目标行保留,id 不丢
        assert_eq!(merged[0].gacha_type, 400);
        assert!(load_records(&conn, from).unwrap().is_empty());
    }

    #[test]
    fn e12_migrate_cross_code_multiplicity_migrates_excess_copies() {
        let conn = memory_db();
        let from = "0";
        let to = "900000001";
        // 来源同键(301)2 份无 id;目标同键(400)已有 1 份 → 删 1 迁 1,
        // 合并后桶内份数 = max(2,1) = 2(E2);行内 code 各自保留(E5)
        insert_records(
            &conn,
            from,
            &[
                wish(301, "2026-09-23 21:14:36", "祭礼剑", 4, None),
                wish(301, "2026-09-23 21:14:36", "祭礼剑", 4, None),
            ],
        )
        .unwrap();
        insert_records(
            &conn,
            to,
            &[wish(400, "2026-09-23 21:14:36", "祭礼剑", 4, Some("1800000000000000008"))],
        )
        .unwrap();

        assert_eq!(migrate_archive(&conn, from, to).unwrap(), 1);
        let merged = load_records(&conn, to).unwrap();
        let swords: Vec<&StoredRecord> = merged.iter().filter(|r| r.name == "祭礼剑").collect();
        assert_eq!(swords.len(), 2);
        let kept = swords.iter().find(|r| r.id.is_some()).unwrap();
        assert_eq!(kept.id.as_deref(), Some("1800000000000000008")); // 目标行原样保留
        let migrated = swords.iter().find(|r| r.id.is_none()).unwrap();
        assert_eq!(migrated.gacha_type, 301); // 迁入行保留自身 code
        assert_eq!(seqs_of(&conn, to, 301, "祭礼剑"), [1]); // 目标 301 精确键无既有行,seq 原样落位
    }

    #[test]
    fn e12_migrate_injects_identity_into_target_unpaired_row() {
        let conn = memory_db();
        let from = "0";
        let to = "900000001";
        // 来源接口行 vs 目标同精确键无 id 行(五元组+seq 全等):身份注入升级目标行
        // (同 domain upgrades 动作),而非 UNIQUE 冲突整体回滚
        insert_records(
            &conn,
            from,
            &[wish(301, "2026-09-23 21:14:36", "钟离", 5, Some("1800000000000000009"))],
        )
        .unwrap();
        insert_records(&conn, to, &[wish(301, "2026-09-23 21:14:36", "钟离", 5, None)]).unwrap();

        assert_eq!(migrate_archive(&conn, from, to).unwrap(), 0);
        let merged = load_records(&conn, to).unwrap();
        assert_eq!(merged.len(), 1); // 来源行消失,目标行获得身份
        assert_eq!(merged[0].id.as_deref(), Some("1800000000000000009"));
        assert_eq!(merged[0].gacha_type, 301);
        assert!(load_records(&conn, from).unwrap().is_empty());
    }

    #[test]
    fn e13_load_records_orders_by_comparator_with_null_ids_first() {
        let conn = memory_db();
        let uid = "900000001";
        // 乱序插入;同秒内:无 id 行最前,其后 id 按数值升序(19 位串)
        insert_records(
            &conn,
            uid,
            &[
                wish(301, "2026-09-23 21:14:36", "乙", 4, Some("1800000000000000002")),
                wish(301, "2026-09-23 21:14:36", "甲", 5, None),
                wish(301, "2026-09-23 21:14:36", "丙", 3, Some("1800000000000000001")),
                wish(301, "2026-09-22 10:00:00", "早", 3, Some("1800000000000000009")),
                wish(301, "2026-09-24 10:00:00", "晚", 3, None),
            ],
        )
        .unwrap();

        let loaded = load_records(&conn, uid).unwrap();
        let names: Vec<&str> = loaded.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["早", "甲", "丙", "乙", "晚"]);
    }

    #[test]
    fn same_second_import_preserves_pull_order_including_duplicates() {
        let conn = memory_db();
        let uid = "900000001";
        // 合成十连:重复武器应留在五星前,不得被 seq 或名字重排。
        let rows = vec![
            wish(301, "2026-01-01 10:00:00", "乙武器", 3, None),
            wish(301, "2026-01-01 10:00:00", "乙武器", 3, None),
            wish(301, "2026-01-01 10:00:00", "首个五星", 5, None),
            wish(301, "2026-01-01 10:00:00", "甲武器", 3, None),
        ];
        insert_records(&conn, uid, &rows).unwrap();
        let loaded = load_records(&conn, uid).unwrap();
        let names: Vec<&str> = loaded.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["乙武器", "乙武器", "首个五星", "甲武器"]);
        assert_eq!(loaded[1].seq, 1);
    }

    #[test]
    fn e15_watermark_upsert_and_missing_pool_returns_none() {
        let conn = memory_db();
        let uid = "900000001";
        assert_eq!(get_watermark(&conn, uid, 301).unwrap(), None); // 从未同步

        set_watermark(&conn, uid, 301, "1800000000000000001").unwrap();
        assert_eq!(
            get_watermark(&conn, uid, 301).unwrap().as_deref(),
            Some("1800000000000000001")
        );

        // UPSERT:同池覆盖;空池水位按约定可置 '0'
        set_watermark(&conn, uid, 301, "1800000000000000009").unwrap();
        assert_eq!(
            get_watermark(&conn, uid, 301).unwrap().as_deref(),
            Some("1800000000000000009")
        );

        // 池间、档案间互不串扰
        set_watermark(&conn, uid, 302, "1810000000000000001").unwrap();
        assert_eq!(get_watermark(&conn, uid, 200).unwrap(), None);
        assert_eq!(get_watermark(&conn, "42", 301).unwrap(), None);
        assert_eq!(
            get_watermark(&conn, uid, 302).unwrap().as_deref(),
            Some("1810000000000000001")
        );
    }

    #[test]
    fn e16_clear_archive_wipes_records_and_watermarks_keeps_archive_row() {
        let conn = memory_db();
        let uid = "900000001";
        ensure_archive(&conn, uid).unwrap();
        insert_records(
            &conn,
            uid,
            &[
                wish(301, "2026-09-23 21:14:36", "那维莱特", 5, Some("1800000000000000001")),
                wish(302, "2026-09-23 22:00:00", "护摩之杖", 5, Some("1810000000000000001")),
            ],
        )
        .unwrap();
        set_watermark(&conn, uid, 301, "1800000000000000001").unwrap();
        set_last_synced(&conn, uid, "2026-10-16T08:00:00.000Z").unwrap();
        insert_records(
            &conn,
            "42",
            &[wish(301, "2026-09-23 21:14:36", "他人", 5, Some("1820000000000000001"))],
        )
        .unwrap();

        assert_eq!(clear_archive(&conn, uid).unwrap(), 2);
        assert!(load_records(&conn, uid).unwrap().is_empty()); // 记录清空
        assert_eq!(get_watermark(&conn, uid, 301).unwrap(), None); // 水位必须同事务清除
        let archives = list_archives(&conn).unwrap();
        let mine = archives.iter().find(|a| a.uid == uid).unwrap();
        assert!(!mine.created_at.is_empty()); // archives 行保留(空档存在)
        assert_eq!(mine.last_synced_at, None); // last_synced_at 置 NULL
        assert_eq!(load_records(&conn, "42").unwrap().len(), 1); // 其他档案不受影响

        // 幂等:再清一次返回 0
        assert_eq!(clear_archive(&conn, uid).unwrap(), 0);
    }

    #[test]
    fn update_identity_backfills_id_and_optional_gacha_type() {
        let conn = memory_db();
        let uid = "900000001";
        insert_records(&conn, uid, &[wish(301, "2026-09-23 21:14:36", "钟离", 5, None)]).unwrap();
        let rowid = load_records(&conn, uid).unwrap()[0].rowid;

        // 仅回填 id;gachaType 缺省不动原 code
        update_identity(
            &conn,
            &[IdentityUpdate { rowid, id: "1800000000000000001".into(), gacha_type: None }],
        )
        .unwrap();
        let backfilled = &load_records(&conn, uid).unwrap()[0];
        assert_eq!(backfilled.id.as_deref(), Some("1800000000000000001"));
        assert_eq!(backfilled.gacha_type, 301);

        // 类别内纠偏:备注错标 301 → 接口权威 400(E6)
        update_identity(
            &conn,
            &[IdentityUpdate {
                rowid,
                id: "1800000000000000001".into(),
                gacha_type: Some(400),
            }],
        )
        .unwrap();
        let upgraded = &load_records(&conn, uid).unwrap()[0];
        assert_eq!(upgraded.gacha_type, 400);
        assert_eq!(upgraded.id.as_deref(), Some("1800000000000000001"));
    }

    #[test]
    fn insert_creates_archive_row_for_data_bearing_uid() {
        let conn = memory_db();
        insert_records(&conn, "900000001", &[wish(301, "2026-09-23 21:14:36", "钟离", 5, None)])
            .unwrap();
        let archives = list_archives(&conn).unwrap();
        assert_eq!(archives.len(), 1);
        assert_eq!(archives[0].uid, "900000001");
        assert_eq!(archives[0].last_synced_at, None); // 写入/迁入不写 last_synced_at
    }

    #[test]
    fn ensure_and_list_archives_report_sync_time() {
        let conn = memory_db();
        ensure_archive(&conn, "900000001").unwrap();
        ensure_archive(&conn, "900000001").unwrap(); // 幂等,不报错
        set_last_synced(&conn, "900000001", "2026-10-16T08:00:00.000Z").unwrap();
        let archives = list_archives(&conn).unwrap();
        assert_eq!(archives.len(), 1);
        assert_eq!(archives[0].uid, "900000001");
        assert_eq!(archives[0].last_synced_at.as_deref(), Some("2026-10-16T08:00:00.000Z"));
    }

    #[test]
    fn migrate_same_uid_is_noop() {
        let conn = memory_db();
        insert_records(
            &conn,
            "900000001",
            &[wish(301, "2026-09-23 21:14:36", "钟离", 5, Some("1800000000000000001"))],
        )
        .unwrap();
        // 同 uid 迁移必须被挡下:否则对账 DELETE 会把档案自身行当「重复」误删
        assert_eq!(migrate_archive(&conn, "900000001", "900000001").unwrap(), 0);
        assert_eq!(load_records(&conn, "900000001").unwrap().len(), 1);
    }

    #[test]
    fn schema_init_is_idempotent() {
        let conn = memory_db();
        init_schema(&conn).unwrap(); // 新库重复初始化不报错、不丢数据
        insert_records(&conn, "900000001", &[wish(301, "2026-09-23 21:14:36", "钟离", 5, None)])
            .unwrap();
        init_schema(&conn).unwrap();
        assert_eq!(load_records(&conn, "900000001").unwrap().len(), 1);
    }

    #[test]
    fn record_json_uses_camel_case_aligned_with_ts() {
        let stored = StoredRecord {
            gacha_type: 301,
            time: "2026-09-23 21:14:36".into(),
            name: "那维莱特".into(),
            rank_type: 5,
            id: Some("1800000000000000001".into()),
            seq: 0,
            rowid: 1,
        };
        let json = serde_json::to_string(&stored).unwrap();
        assert!(json.contains("\"gachaType\":301"));
        assert!(json.contains("\"rankType\":5"));
        assert!(json.contains("\"rowid\":1"));
        assert!(json.contains("\"seq\":0"));
        let parsed: StoredRecord = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, stored);

        // 入参 WishRecord:id 可空、无 seq/rowid
        let wish: WishRecord = serde_json::from_str(
            r#"{"gachaType":302,"time":"2026-09-23 21:14:36","name":"金流监督","rankType":5,"id":null}"#,
        )
        .unwrap();
        assert_eq!(wish.id, None);

        // 回填入参:gachaType 可缺省
        let update: IdentityUpdate = serde_json::from_str(r#"{"rowid":7,"id":"1800000000000000009"}"#)
            .unwrap();
        assert_eq!(update.gacha_type, None);
    }

    #[test]
    fn iso_helper_formats_known_instants() {
        assert_eq!(iso_from_unix_millis(0), "1970-01-01T00:00:00.000Z");
        // 闰日:2024-02-29T12:00:00Z
        assert_eq!(iso_from_unix_millis(1_709_208_000_000), "2024-02-29T12:00:00.000Z");
    }
}
