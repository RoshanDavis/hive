pub mod models;
pub mod utils;
pub mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_workspaces,
            commands::add_workspace,
            commands::remove_workspace,
            commands::send_notification,
            commands::load_workspace_config,
            commands::save_workspace_config,
            commands::load_space,
            commands::save_space,
            commands::create_space,
            commands::delete_space,
            commands::delete_chat_history,
            commands::delete_storage_history,
            commands::ollama_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
