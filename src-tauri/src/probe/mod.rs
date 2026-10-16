//! 游戏目录探测与 webCaches 缓存文件 IO(spec 02 §2;ADR-0001:Rust 只做 IO)。
//!
//! 与鸣潮 probe 的语义差异:祈愿链接不在 output_log.txt 正文——日志只用于定位游戏
//! 数据目录(GenshinImpact_Data/YuanShen_Data),链接载体是内嵌浏览器(ZFGameBrowser)
//! 缓存 `{游戏目录}/webCaches/*/Cache/Cache_Data/data_2`,读取前必须复制到临时文件。
//!
//! 自动探测是 Windows 专属能力:三个探测命令在非 Windows 平台一律返回结构化
//! UnsupportedPlatform(前端映射 UnsupportedPlatformError 引导手动粘贴,spec 02 §7)。
//! 平台闸门用 `cfg!(windows)` 常量而非 `#[cfg]` 属性:真实探测逻辑在所有平台参与
//! 编译与类型检查(macOS 开发机可即时发现签名/路径错误),仅执行被挡下。
//! 日志解析/缓存枚举/复制重试为纯函数,本模块单测在任意平台可跑。

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

/// FilePort 读取上限(spec 02 §2:≤64MB,与 domain backup.ts 的 BACKUP_MAX_BYTES 同值)
pub const FILE_READ_MAX_BYTES: u64 = 64 * 1024 * 1024;

/// 自动探测平台闸门:仅 Windows 执行真实探测,其余平台命令层返回 UnsupportedPlatform
const AUTO_PROBE_SUPPORTED: bool = cfg!(windows);

/// 探测错误分类(序列化为 snake_case,前端 tauriPorts 按 kind 映射 domain 错误类):
/// unsupported_platform=非 Windows 调自动探测;not_found=目标文件不存在(预留契约,
/// 当前命令对缺失一律返回空列表/跳过,不产生);io=缓存复制失败(锁定重试后仍失败)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProbeErrorKind {
    UnsupportedPlatform,
    /// 预留契约:前端已按 CacheLinkNotFoundError 映射,当前命令暂不构造
    #[allow(dead_code)]
    NotFound,
    Io,
}

/// 探测命令错误:{ kind, message } 形状,文案定型在前端(spec 02 §7)
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProbeError {
    pub kind: ProbeErrorKind,
    pub message: String,
}

impl ProbeError {
    pub fn unsupported_platform() -> Self {
        Self {
            kind: ProbeErrorKind::UnsupportedPlatform,
            message: "自动获取仅支持 Windows,当前平台请使用手动粘贴导入".into(),
        }
    }

    /// 预留契约构造器(同 NotFound 变体,当前命令不产生)
    #[allow(dead_code)]
    pub fn not_found(message: impl Into<String>) -> Self {
        Self {
            kind: ProbeErrorKind::NotFound,
            message: message.into(),
        }
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self {
            kind: ProbeErrorKind::Io,
            message: message.into(),
        }
    }
}

/// 服区:cn=国服(原神/YuanShen_Data),global=国际服(Genshin Impact/GenshinImpact_Data)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GameRegion {
    Cn,
    Global,
}

/// 一处探测到的游戏数据目录(字段 camelCase 对齐前端 GameDirInfo)
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDirInfo {
    pub region: GameRegion,
    /// 游戏数据目录,含 GenshinImpact_Data/YuanShen_Data 段——webCaches 就在其下,
    /// 原样传给 webcache_candidates 即为 spec 02 §2 的 `{游戏目录}/webCaches/...`
    pub game_dir: String,
    /// 该区服 output_log.txt 修改时间(ISO 8601)
    pub log_mtime: String,
}

/// 一份缓存文件候选(字段 camelCase 对齐前端 CacheFileInfo),已按 mtime 降序
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheFileInfo {
    pub path: String,
    pub mtime: String,
}

/// 数据目录标记(小写比对,大小写不敏感;国服 YuanShen_Data、国际服 GenshinImpact_Data)
const DATA_DIR_MARKERS: [&str; 2] = ["genshinimpact_data", "yuanshen_data"];

/// 从日志正文提取游戏目录(镜像 spec 02 §2 正则 `[A-Z]:/.+(GenshinImpact_Data|YuanShen_Data)`,
/// 大小写不敏感;不引 regex crate,手写匹配):逐行找首个数据目录标记,向左回溯首个
/// 盘符前缀(`X:/` 或 `X:\`),标记与盘符间须至少一个字符(正则 `.+`),截到标记段末,
/// 即游戏数据目录。无匹配行返回 None。
pub fn extract_game_dir_from_log(text: &str) -> Option<String> {
    text.lines().find_map(extract_game_dir_from_line)
}

fn extract_game_dir_from_line(line: &str) -> Option<String> {
    // to_ascii_lowercase 是等长字节变换:标记为 ASCII,下标可与原行互查
    let lowered = line.to_ascii_lowercase();
    for marker in DATA_DIR_MARKERS {
        let mut searched = 0;
        while let Some(at) = lowered[searched..].find(marker) {
            let marker_start = searched + at;
            if let Some(start) = drive_prefix_before(line, marker_start) {
                return Some(line[start..marker_start + marker.len()].to_string());
            }
            searched = marker_start + marker.len();
        }
    }
    None
}

/// 标记位置向左回溯首个盘符前缀 `X:/`(或 `X:\`,日志两种斜杠都出现);
/// 前缀与标记间须留至少一个字符(镜像正则 `.+`),leftmost 语义与 JS 贪婪匹配一致
fn drive_prefix_before(line: &str, marker_start: usize) -> Option<usize> {
    if marker_start < 4 {
        return None;
    }
    let bytes = line.as_bytes();
    for start in 0..=marker_start - 4 {
        if bytes[start].is_ascii_alphabetic()
            && bytes[start + 1] == b':'
            && (bytes[start + 2] == b'/' || bytes[start + 2] == b'\\')
        {
            return Some(start);
        }
    }
    None
}

/// 缓存枚举(镜像 spec 02 §2 glob `{游戏目录}/webCaches/*/Cache/Cache_Data/data_2`):
/// 输入 webCaches 下各子目录(调用方 read_dir 枚举,版本号不硬编码),拼
/// Cache/Cache_Data/data_2,存在且为文件的收录,按 mtime 降序(ISO 串同格式,字典序即时间序)
pub fn collect_cache_candidates(version_dirs: &[PathBuf]) -> Vec<CacheFileInfo> {
    let mut files = Vec::new();
    for dir in version_dirs {
        let data_2 = dir.join("Cache").join("Cache_Data").join("data_2");
        let Ok(meta) = std::fs::metadata(&data_2) else {
            continue; // 该版本目录无缓存文件:跳过(整目录缺失由调用方给空列表)
        };
        if !meta.is_file() {
            continue;
        }
        let Some(mtime) = meta.modified().ok().map(iso_from_system_time) else {
            continue;
        };
        files.push(CacheFileInfo {
            path: data_2.to_string_lossy().into_owned(),
            mtime,
        });
    }
    files.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    files
}

/// 临时缓存文件路径:{系统临时目录}/genshintool-cache-{pid}-{纳秒}.tmp
/// (进程号 + 纳秒时间戳,唯一即可,不追求不可预测)
pub fn temp_cache_path() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("genshintool-cache-{}-{}.tmp", std::process::id(), nanos))
}

/// 复制并失败重试一次(spec 02 §2:运行中被 ZFGameBrowser 锁定;std::fs::copy 在
/// Windows 以共享读打开源文件,瞬时锁定重试通常可过)。两次都失败时聚合两次错误。
pub fn copy_file_with_retry(source: &Path, target: &Path) -> std::io::Result<()> {
    match std::fs::copy(source, target) {
        Ok(_) => Ok(()),
        Err(first) => std::fs::copy(source, target).map(|_| ()).map_err(|second| {
            std::io::Error::new(second.kind(), format!("第一次失败({first}),重试仍失败({second})"))
        }),
    }
}

/// SystemTime → ISO 8601(UTC,Z 后缀毫秒精度,与 db::now_iso 同形)。
/// db.rs 的换算未导出且本任务不改 db.rs,按同算法(Hinnant civil_from_days)平移一份
pub fn iso_from_system_time(time: SystemTime) -> String {
    let millis = time
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0);
    let secs = millis.div_euclid(1000);
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
        millis.rem_euclid(1000)
    )
}

/// 天数(1970-01-01 起)→ (年, 月, 日),公历(与 db.rs 同源)
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

/// 真实探测(spec 02 §2):读 %USERPROFILE% 下国服/国际服两处 output_log.txt 定位
/// 游戏数据目录;文件缺失/不可读/提取不到 → 跳过该区服,两侧皆无 → 空列表(不是错误,
/// 引导交给前端)
fn list_game_dirs_impl() -> Vec<GameDirInfo> {
    let Some(user_profile) = std::env::var_os("USERPROFILE") else {
        return Vec::new();
    };
    let logs = [
        (GameRegion::Cn, r"AppData\LocalLow\miHoYo\原神\output_log.txt"),
        (
            GameRegion::Global,
            r"AppData\LocalLow\miHoYo\Genshin Impact\output_log.txt",
        ),
    ];
    logs.iter()
        .filter_map(|(region, relative)| {
            region_log_dir(*region, Path::new(&user_profile).join(relative))
        })
        .collect()
}

/// 读一区服日志定位游戏数据目录;任一步失败 → None(跳过该区服)
fn region_log_dir(region: GameRegion, log_path: PathBuf) -> Option<GameDirInfo> {
    let meta = std::fs::metadata(&log_path).ok()?;
    let log_mtime = iso_from_system_time(meta.modified().ok()?);
    let bytes = std::fs::read(&log_path).ok()?;
    let game_dir = extract_game_dir_from_log(&String::from_utf8_lossy(&bytes))?;
    Some(GameDirInfo {
        region,
        game_dir,
        log_mtime,
    })
}

/// 真实枚举:webCaches 下各子目录即版本目录候选;目录不存在 → 空列表
fn webcache_candidates_impl(game_dir: &str) -> Vec<CacheFileInfo> {
    let webcaches = Path::new(game_dir.trim()).join("webCaches");
    let Ok(entries) = std::fs::read_dir(&webcaches) else {
        return Vec::new();
    };
    let version_dirs: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    collect_cache_candidates(&version_dirs)
}

/// 真实复制:临时文件名唯一,失败(锁定)重试一次,仍失败 → ProbeError io
fn copy_to_temp_impl(path: &str) -> Result<String, ProbeError> {
    let target = temp_cache_path();
    copy_file_with_retry(Path::new(path.trim()), &target)
        .map_err(|e| ProbeError::io(format!("复制游戏缓存文件失败:{e}")))?;
    Ok(target.to_string_lossy().into_owned())
}

/// 游戏目录探测(spec 02 §2):Windows 读两处 output_log.txt 定位数据目录;
/// 非 Windows 一律 UnsupportedPlatform(macOS 唯一自动途径是手动粘贴)
#[tauri::command(async)]
pub fn list_game_dirs() -> Result<Vec<GameDirInfo>, ProbeError> {
    if !AUTO_PROBE_SUPPORTED {
        return Err(ProbeError::unsupported_platform());
    }
    Ok(list_game_dirs_impl())
}

/// webCaches 缓存候选(已按 mtime 降序);目录不存在 → 空列表;非 Windows UnsupportedPlatform
#[tauri::command(async)]
pub fn webcache_candidates(game_dir: String) -> Result<Vec<CacheFileInfo>, ProbeError> {
    if !AUTO_PROBE_SUPPORTED {
        return Err(ProbeError::unsupported_platform());
    }
    Ok(webcache_candidates_impl(&game_dir))
}

/// 复制缓存到临时文件并返回路径(读取前必须复制,ZFGameBrowser 锁定场景);
/// 非 Windows UnsupportedPlatform(macOS 的文件导入直读用户所选文件,无需复制)
#[tauri::command(async)]
pub fn copy_to_temp(path: String) -> Result<String, ProbeError> {
    if !AUTO_PROBE_SUPPORTED {
        return Err(ProbeError::unsupported_platform());
    }
    copy_to_temp_impl(&path)
}

/// 读缓存文件字节(FilePort.readBytes 底座,全平台——手动选中的缓存文件不走探测);
/// ≤64MB 上限(spec 02 §2,与备份导入拒绝阈值同值),超出按 Err 拒绝
#[tauri::command(async)]
pub fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    let file = Path::new(path.trim());
    let meta = std::fs::metadata(file).map_err(|e| format!("读取缓存文件失败:{e}"))?;
    if meta.len() > FILE_READ_MAX_BYTES {
        return Err(format!(
            "缓存文件超过 64MB 读取上限(实际 {} 字节):{path}",
            meta.len()
        ));
    }
    std::fs::read(file).map_err(|e| format!("读取缓存文件失败:{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn temp_probe_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("genshintool_probe_{}_{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("应能创建临时目录");
        dir
    }

    #[test]
    fn extract_game_dir_keeps_data_dir_segment_for_webcache_glob() {
        // 日志行命中正则后截到数据目录段本身(其下即 webCaches,spec 02 §2 的 glob 基准)
        let line = "[3] Load GAudio: C:/Program Files/Genshin Impact/GenshinImpact_Data/StreamingAssets";
        assert_eq!(
            extract_game_dir_from_log(line).as_deref(),
            Some("C:/Program Files/Genshin Impact/GenshinImpact_Data")
        );
    }

    #[test]
    fn extract_game_dir_matches_cn_marker_case_insensitively() {
        let line = "path=D:/Games/Yuanshen_Data/Misc;";
        assert_eq!(
            extract_game_dir_from_log(line).as_deref(),
            Some("D:/Games/Yuanshen_Data")
        );
    }

    #[test]
    fn extract_game_dir_requires_gap_and_drive_prefix() {
        // 数据目录紧跟盘符(中间无 `.+` 间隔)不命中,镜像正则语义
        assert_eq!(extract_game_dir_from_log("C:/GenshinImpact_Data"), None);
        // 无盘符前缀不命中
        assert_eq!(extract_game_dir_from_log("GenshinImpact_Data/StreamingAssets"), None);
        // 全无标记 → None
        assert_eq!(extract_game_dir_from_log("no path here"), None);
    }

    #[test]
    fn extract_game_dir_scans_multi_line_text() {
        let text = "[1] boot ok\n[2] using C:\\Game\\Genshin Impact\\GenshinImpact_Data/assets\nexit";
        assert_eq!(
            extract_game_dir_from_log(text).as_deref(),
            Some("C:\\Game\\Genshin Impact\\GenshinImpact_Data")
        );
    }

    #[test]
    fn collect_cache_candidates_keeps_existing_data_2_sorted_by_mtime_desc() {
        let root = temp_probe_dir("cache");
        let older = root.join("2.10.0.1");
        let newer = root.join("2.16.0.1");
        let missing = root.join("2.0.0.1"); // 无 Cache/Cache_Data/data_2:跳过
        for dir in [&older, &newer, &missing] {
            std::fs::create_dir_all(dir).unwrap();
        }
        std::fs::create_dir_all(older.join("Cache/Cache_Data")).unwrap();
        std::fs::create_dir_all(newer.join("Cache/Cache_Data")).unwrap();
        std::fs::write(older.join("Cache/Cache_Data/data_2"), b"old").unwrap();
        // 间隔远大于常见文件系统 mtime 精度,保证两个 mtime 可分先后
        std::thread::sleep(Duration::from_millis(30));
        std::fs::write(newer.join("Cache/Cache_Data/data_2"), b"new").unwrap();

        let files = collect_cache_candidates(&[missing, older.clone(), newer.clone()]);
        assert_eq!(files.len(), 2);
        assert_eq!(
            files[0].path,
            newer.join("Cache/Cache_Data/data_2").to_string_lossy()
        );
        assert!(files[0].mtime > files[1].mtime, "应按 mtime 降序");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn temp_cache_path_is_unique_prefixed_and_in_temp_dir() {
        let first = temp_cache_path();
        let second = temp_cache_path();
        assert_ne!(first, second);
        let name = first.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with("genshintool-cache-"));
        assert!(name.ends_with(".tmp"));
        assert_eq!(first.parent(), Some(std::env::temp_dir().as_path()));
    }

    #[test]
    fn copy_file_with_retry_copies_content_and_reports_missing_source() {
        let dir = temp_probe_dir("copy");
        let source = dir.join("data_2");
        std::fs::write(&source, b"cache-bytes").unwrap();
        let target = dir.join("copy.tmp");
        copy_file_with_retry(&source, &target).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"cache-bytes");

        // 源文件缺失:两次尝试都失败 → Err(临时文件不残留也不影响判定)
        let missing = copy_file_with_retry(&dir.join("gone"), &dir.join("gone.tmp"));
        assert!(missing.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[cfg(not(windows))]
    fn probe_commands_are_unsupported_off_windows() {
        // spec 02 §2:自动探测 Windows 专属,其余平台一律结构化 UnsupportedPlatform(验收钉住)
        for kind in [
            list_game_dirs().unwrap_err().kind,
            webcache_candidates("C:/game/GenshinImpact_Data".into())
                .unwrap_err()
                .kind,
            copy_to_temp("C:/x".into()).unwrap_err().kind,
        ] {
            assert_eq!(kind, ProbeErrorKind::UnsupportedPlatform);
        }
    }

    #[test]
    fn probe_error_serializes_kind_and_message() {
        let value = serde_json::to_value(ProbeError::unsupported_platform()).unwrap();
        assert_eq!(value["kind"], "unsupported_platform");
        assert!(value["message"].as_str().unwrap().contains("手动粘贴"));

        let io = serde_json::to_value(ProbeError::io("复制失败")).unwrap();
        assert_eq!(io["kind"], "io");
        assert_eq!(io["message"], "复制失败");

        // 预留契约 kind 的序列化形态(snake_case)
        let nf = serde_json::to_value(ProbeError::not_found("gone")).unwrap();
        assert_eq!(nf["kind"], "not_found");
    }

    #[test]
    fn probe_result_types_serialize_camel_case() {
        let info = GameDirInfo {
            region: GameRegion::Cn,
            game_dir: "C:/a/YuanShen_Data".into(),
            log_mtime: "2026-10-16T00:00:00.000Z".into(),
        };
        let value = serde_json::to_value(&info).unwrap();
        assert_eq!(value["region"], "cn");
        assert_eq!(value["gameDir"], "C:/a/YuanShen_Data");
        assert_eq!(value["logMtime"], "2026-10-16T00:00:00.000Z");
        assert_eq!(serde_json::to_value(GameRegion::Global).unwrap(), "global");

        let file = CacheFileInfo {
            path: "p".into(),
            mtime: "m".into(),
        };
        assert_eq!(
            serde_json::to_value(&file).unwrap(),
            serde_json::json!({ "path": "p", "mtime": "m" })
        );
    }

    #[test]
    fn read_file_bytes_returns_exact_bytes_and_reports_missing() {
        let dir = temp_probe_dir("read");
        let file = dir.join("data_2");
        std::fs::write(&file, [0u8, 1, 254, 255]).unwrap();
        let bytes = read_file_bytes(file.to_string_lossy().into_owned()).unwrap();
        assert_eq!(bytes, vec![0u8, 1, 254, 255]);

        assert!(
            read_file_bytes(dir.join("gone").to_string_lossy().into_owned()).is_err(),
            "缺失文件应报错"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_file_bytes_rejects_over_64mb() {
        let dir = temp_probe_dir("big");
        let file = dir.join("huge");
        // 稀疏文件:仅设长度不写内容,不产生 64MB 的磁盘/内存开销
        std::fs::File::create(&file)
            .unwrap()
            .set_len(FILE_READ_MAX_BYTES + 1)
            .unwrap();
        let err = read_file_bytes(file.to_string_lossy().into_owned()).unwrap_err();
        assert!(err.contains("64MB"), "应提示超限:{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn iso_from_system_time_formats_known_instants() {
        assert_eq!(iso_from_system_time(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        // 闰日:2024-02-29T12:00:00Z(与 db.rs 测试同基准)
        let leap = UNIX_EPOCH + Duration::from_millis(1_709_208_000_000);
        assert_eq!(iso_from_system_time(leap), "2024-02-29T12:00:00.000Z");
    }
}
