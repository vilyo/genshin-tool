mod db;
// gacha(祈愿 API)/probe(日志探测)模块待对应票务落地

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            db::db_insert_records,
            db::db_update_identity,
            db::db_set_watermark,
            db::db_get_watermark,
            db::db_set_last_synced,
            db::db_clear_archive,
            db::db_load_records,
            db::db_migrate_archive,
            db::db_list_archives,
            db::db_ensure_archive,
        ])
        .build(tauri::generate_context!())
        .expect("Tauri 应用初始化失败")
        .run(|app, event| {
            // macOS 上关闭最后一个窗口默认只关窗口不退进程;本应用为单窗口工具,直接退出
            if let tauri::RunEvent::ExitRequested { code: None, .. } = event {
                app.exit(0);
            }
        });
}
