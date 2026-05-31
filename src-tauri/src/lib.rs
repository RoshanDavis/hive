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
            // workspace
            commands::workspace::get_workspaces,
            commands::workspace::add_workspace,
            commands::workspace::remove_workspace,
            commands::workspace::set_workspace_background_execution,
            commands::workspace::get_workspace_status_rollups,
            commands::workspace::send_notification,
            commands::workspace::load_workspace_config,
            commands::workspace::save_workspace_config,
            commands::workspace::load_space,
            commands::workspace::save_space,
            commands::workspace::create_space,
            commands::workspace::delete_space,
            commands::workspace::delete_chat_history,
            commands::workspace::delete_storage_history,
            // llm
            commands::llm::ollama_chat,
            commands::llm::llm_chat,
            // credentials
            commands::credentials::credential_list,
            commands::credentials::credential_add,
            commands::credentials::credential_update,
            commands::credentials::credential_remove,
            commands::credentials::credential_transfer,
            commands::credentials::credential_resolve,
            // customization (node defaults + custom nodes + scripts)
            commands::customization::load_global_node_defaults,
            commands::customization::save_global_node_defaults,
            commands::customization::load_workspace_node_defaults,
            commands::customization::save_workspace_node_defaults,
            commands::customization::list_global_custom_nodes,
            commands::customization::list_workspace_custom_nodes,
            commands::customization::save_global_custom_node,
            commands::customization::save_workspace_custom_node,
            commands::customization::delete_global_custom_node,
            commands::customization::delete_workspace_custom_node,
            commands::customization::custom_node_transfer,
            commands::customization::run_script,
            commands::customization::open_custom_node_script,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
