// Phase 11 procgen integration.
mod commands;
mod sanitize;

#[cfg(test)]
mod no_shell_test;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::ProcgenState::new())
        .invoke_handler(tauri::generate_handler![
            commands::generate_campaign,
            commands::cancel_generation,
            commands::read_campaign_file,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
