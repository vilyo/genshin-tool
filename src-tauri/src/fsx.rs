//! 备份导出/目录指定的文件小命令(T18;ADR-0001:Rust 只做 IO,组装与判定全在前端):
//! - save_text_file:备份 JSON 落盘(全平台,前端经 plugin-dialog 的 save 对话框选路径);
//! - read_text_file:备份导入读文本(64MB 第一道门禁按真实文件大小,对齐 spec 01 §6);
//! - pick_directory:手动指定游戏客户端目录(tauri-plugin-dialog 目录模式,全平台可用,
//!   v1 仅作设置面板展示,不参与一键获取的探测链路)。

use std::path::Path;

/// 备份文件读取上限(字节):与前端 BACKUP_MAX_BYTES(src/domain/backup.ts)同一道 64MB 门,
/// 在读文件前按真实文件大小拒绝(解析层的 text.length 近似门在前端)。
const BACKUP_READ_MAX_BYTES: u64 = 64 * 1024 * 1024;

/// 写文本文件(备份导出):按需创建父目录,返回写入字节数
#[tauri::command(async)]
pub fn save_text_file(path: String, contents: String) -> Result<usize, String> {
    let file = Path::new(path.trim());
    if let Some(parent) = file.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建保存目录失败:{e}"))?;
        }
    }
    std::fs::write(file, contents.as_bytes()).map_err(|e| format!("写入备份文件失败:{e}"))?;
    Ok(contents.len())
}

/// 读文本文件(备份导入):先按真实文件大小拒绝超限,再读入并校验 UTF-8
#[tauri::command(async)]
pub fn read_text_file(path: String) -> Result<String, String> {
    let file = Path::new(path.trim());
    let meta = std::fs::metadata(file).map_err(|e| format!("读取备份文件失败:{e}"))?;
    if meta.len() > BACKUP_READ_MAX_BYTES {
        return Err(format!(
            "备份文件超过 64MB 大小上限(实际 {} 字节),请确认导出的文件完整",
            meta.len()
        ));
    }
    let bytes = std::fs::read(file).map_err(|e| format!("读取备份文件失败:{e}"))?;
    String::from_utf8(bytes).map_err(|_| "备份文件不是有效的 UTF-8 文本,无法导入".to_string())
}

/// 系统目录选择对话框(手动指定游戏客户端目录;取消返回 null)。
/// blocking 对话框必须在非主线程调用,故声明为 async 命令(tauri 在独立线程执行)。
#[tauri::command(async)]
pub fn pick_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .blocking_pick_folder()
        .map(|file| file.simplified());
    match picked {
        Some(file) => file
            .into_path()
            .map(|path| Some(path.to_string_lossy().into_owned()))
            .map_err(|e| format!("获取所选目录失败:{e}")),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_fsx_dir(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("genshintool_fsx_{}_{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("应能创建临时目录");
        dir
    }

    #[test]
    fn save_text_file_writes_exact_bytes_and_creates_parent_dirs() {
        let dir = temp_fsx_dir("save");
        let file = dir.join("nested/dir/genshintool-backup-777.json");
        let written = save_text_file(
            file.to_string_lossy().into_owned(),
            "{\"app\":\"genshintool\"}".to_string(),
        )
        .unwrap();
        assert_eq!(written, "{\"app\":\"genshintool\"}".len());
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            "{\"app\":\"genshintool\"}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_text_file_reports_io_error() {
        // 目标路径的父段是一个普通文件:create_dir_all 必失败
        let dir = temp_fsx_dir("save_err");
        let blocker = dir.join("blocker");
        std::fs::write(&blocker, b"x").unwrap();
        let file = dir.join("blocker").join("out.json");
        let err = save_text_file(file.to_string_lossy().into_owned(), "x".to_string()).unwrap_err();
        assert!(err.contains("创建保存目录失败"), "应报目录创建失败:{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_text_file_roundtrips_and_reports_missing() {
        let dir = temp_fsx_dir("read");
        let file = dir.join("backup.json");
        std::fs::write(&file, "{\"uid\":\"777\",\"name\":\"祈愿\"}").unwrap();
        let text = read_text_file(file.to_string_lossy().into_owned()).unwrap();
        assert_eq!(text, "{\"uid\":\"777\",\"name\":\"祈愿\"}");

        let err = read_text_file(dir.join("gone").to_string_lossy().into_owned()).unwrap_err();
        assert!(err.contains("读取备份文件失败"), "缺失文件应报错:{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_text_file_rejects_over_64mb_by_real_size() {
        let dir = temp_fsx_dir("big");
        let file = dir.join("huge.json");
        // 稀疏文件:仅设长度不写内容,不产生 64MB 的磁盘/内存开销
        std::fs::File::create(&file)
            .unwrap()
            .set_len(BACKUP_READ_MAX_BYTES + 1)
            .unwrap();
        let err = read_text_file(file.to_string_lossy().into_owned()).unwrap_err();
        assert!(err.contains("64MB"), "应提示超限:{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_text_file_rejects_invalid_utf8() {
        let dir = temp_fsx_dir("utf8");
        let file = dir.join("binary.json");
        std::fs::write(&file, [0xff, 0xfe, 0x00]).unwrap();
        let err = read_text_file(file.to_string_lossy().into_owned()).unwrap_err();
        assert!(err.contains("UTF-8"), "应报非 UTF-8:{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
