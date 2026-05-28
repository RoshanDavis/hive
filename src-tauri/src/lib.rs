pub mod models;
pub mod utils;
pub mod vault;
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
            commands::llm_chat,
            commands::credential_list,
            commands::credential_add,
            commands::credential_update,
            commands::credential_remove,
            commands::credential_transfer,
            commands::credential_resolve,
            commands::load_global_node_defaults,
            commands::save_global_node_defaults,
            commands::load_workspace_node_defaults,
            commands::save_workspace_node_defaults,
            commands::list_global_custom_nodes,
            commands::list_workspace_custom_nodes,
            commands::save_global_custom_node,
            commands::save_workspace_custom_node,
            commands::delete_global_custom_node,
            commands::delete_workspace_custom_node,
            commands::custom_node_transfer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
