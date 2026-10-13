// 项目骨架阶段尚无自定义命令;gacha(祈愿 API)/db(档案存储)/probe(日志探测)模块待对应票务落地
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .build(tauri::generate_context!())
        .expect("Tauri 应用初始化失败")
        .run(|app, event| {
            // macOS 上关闭最后一个窗口默认只关窗口不退进程;本应用为单窗口工具,直接退出
            if let tauri::RunEvent::ExitRequested { code: None, .. } = event {
                app.exit(0);
            }
        });
}
