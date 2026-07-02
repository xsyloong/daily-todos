// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const AUTOSTART_APP_NAME: &str = "DailyTodoApp";
const AUTOSTART_RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
#[cfg(target_os = "linux")]
const AUTOSTART_DESKTOP_FILE_NAME: &str = "daily-todo-app.desktop";
#[cfg(target_os = "macos")]
const MACOS_LAUNCH_AGENT_ID: &str = "com.dailytodo.desktop";
const EXTERNAL_TODOS_FILE_NAME: &str = "daily-todos.json";

#[derive(Debug, Serialize, Deserialize, Clone)]
struct LongTermStage {
    id: String,
    #[serde(rename = "startDay")]
    start_day: i32,
    #[serde(rename = "endDay")]
    end_day: i32,
    note: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TodoItem {
    id: String,
    text: String,
    #[serde(rename = "type")]
    todo_type: Option<String>,
    completed: bool,
    date: String,
    #[serde(rename = "timeRange")]
    time_range: Option<String>,
    #[serde(rename = "startDate")]
    start_date: Option<String>,
    #[serde(rename = "endDate")]
    end_date: Option<String>,
    stages: Option<Vec<LongTermStage>>,
    #[serde(rename = "completedDates")]
    completed_dates: Option<Vec<String>>,
    #[serde(rename = "notifiedDates")]
    notified_dates: Option<Vec<String>>,
    #[serde(rename = "earlyCompletedDate")]
    early_completed_date: Option<String>,
    #[serde(rename = "earlyCompletedNote")]
    early_completed_note: Option<String>,
    #[serde(rename = "timeSlot")]
    time_slot: Option<String>,
    #[serde(rename = "customTime")]
    custom_time: Option<String>,
    notified: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AppSettings {
    #[serde(rename = "windowX")]
    window_x: i32,
    #[serde(rename = "windowY")]
    window_y: i32,
    #[serde(rename = "windowWidth")]
    window_width: u32,
    #[serde(rename = "windowHeight")]
    window_height: u32,
    #[serde(rename = "alwaysOnTop")]
    always_on_top: bool,
    #[serde(rename = "dataFilePath")]
    data_file_path: Option<String>,
    #[serde(rename = "dataFolderPath")]
    data_folder_path: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            window_x: 100,
            window_y: 100,
            window_width: 450,
            window_height: 650,
            always_on_top: false,
            data_file_path: None,
            data_folder_path: None,
        }
    }
}

#[derive(Debug, Serialize)]
struct DataFileStatus {
    #[serde(rename = "dataFolderPath")]
    data_folder_path: Option<String>,
    #[serde(rename = "activeDataFilePath")]
    active_data_file_path: String,
    #[serde(rename = "usingDefaultDataFile")]
    using_default_data_file: bool,
}

#[derive(Debug, Serialize)]
struct DataFileSwitchResult {
    todos: Vec<TodoItem>,
    status: DataFileStatus,
}

fn get_data_dir() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("daily-todo-app");
    fs::create_dir_all(&path).ok();
    path
}

fn get_default_todos_path() -> PathBuf {
    let mut path = get_data_dir();
    path.push("todos.json");
    path
}

fn get_todos_path() -> Result<PathBuf, String> {
    let settings = read_settings_file()?;
    get_todos_path_from_settings(&settings)
}

fn get_settings_path() -> PathBuf {
    let mut path = get_data_dir();
    path.push("settings.json");
    path
}

fn get_current_exe_command() -> Result<String, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(format!("\"{}\"", exe_path.display()))
}

fn read_settings_file() -> Result<AppSettings, String> {
    let path = get_settings_path();
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let settings: AppSettings = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        Ok(settings)
    } else {
        Ok(AppSettings::default())
    }
}

fn write_settings_file(settings: &AppSettings) -> Result<(), String> {
    let path = get_settings_path();
    let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

fn normalize_data_file_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim().trim_matches('"');
    if trimmed.is_empty() {
        return Err("数据文件路径不能为空".to_string());
    }

    let path = PathBuf::from(trimmed);
    if path.file_name().is_none() {
        return Err("数据文件路径必须包含文件名".to_string());
    }

    if path.exists() && path.is_dir() {
        return Err("数据文件路径不能是文件夹".to_string());
    }

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err("数据文件所在文件夹不存在".to_string());
        }
    }

    Ok(path)
}

fn normalize_data_folder_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim().trim_matches('"');
    if trimmed.is_empty() {
        return Err("数据文件夹路径不能为空".to_string());
    }

    let path = PathBuf::from(trimmed);
    if !path.exists() {
        return Err("数据文件夹不存在".to_string());
    }

    if !path.is_dir() {
        return Err("请选择一个文件夹，不要选择具体文件".to_string());
    }

    Ok(path)
}

fn get_todos_path_in_folder(folder_path: &Path) -> PathBuf {
    let mut path = folder_path.to_path_buf();
    path.push(EXTERNAL_TODOS_FILE_NAME);
    path
}

fn get_todos_path_from_settings(settings: &AppSettings) -> Result<PathBuf, String> {
    if let Some(folder_path) = settings.data_folder_path.as_deref() {
        if !folder_path.trim().is_empty() {
            return Ok(get_todos_path_in_folder(&normalize_data_folder_path(
                folder_path,
            )?));
        }
    }

    match settings.data_file_path.as_deref() {
        Some(path) if !path.trim().is_empty() => normalize_data_file_path(path),
        _ => Ok(get_default_todos_path()),
    }
}

fn get_data_file_status_from_settings(settings: &AppSettings) -> Result<DataFileStatus, String> {
    let active_path = get_todos_path_from_settings(settings)?;
    let data_folder_path = if let Some(folder_path) = settings.data_folder_path.clone() {
        Some(folder_path)
    } else if let Some(file_path) = settings.data_file_path.as_deref() {
        PathBuf::from(file_path)
            .parent()
            .map(|parent| parent.display().to_string())
    } else {
        None
    };

    Ok(DataFileStatus {
        data_folder_path,
        active_data_file_path: active_path.display().to_string(),
        using_default_data_file: settings.data_folder_path.is_none()
            && settings.data_file_path.is_none(),
    })
}

fn read_todos_file(path: &Path) -> Result<Vec<TodoItem>, String> {
    if path.exists() {
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let todos: Vec<TodoItem> =
            serde_json::from_str(&content).map_err(|e| format!("数据文件格式错误: {}", e))?;
        Ok(todos)
    } else {
        Ok(Vec::new())
    }
}

fn get_sibling_path_with_suffix(path: &Path, suffix: &str) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .ok_or_else(|| "数据文件路径必须包含文件名".to_string())?
        .to_string_lossy();

    Ok(path.with_file_name(format!("{}{}", file_name, suffix)))
}

fn write_todos_file(path: &Path, todos: &[TodoItem]) -> Result<(), String> {
    if path.exists() && path.is_dir() {
        return Err("数据文件路径不能是文件夹".to_string());
    }

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err("数据文件所在文件夹不存在".to_string());
        }
    }

    let content = serde_json::to_string_pretty(&todos).map_err(|e| e.to_string())?;
    let temp_path = get_sibling_path_with_suffix(path, ".tmp")?;

    if path.exists() {
        let backup_path = get_sibling_path_with_suffix(path, ".bak")?;
        fs::copy(path, backup_path).map_err(|e| format!("创建数据文件备份失败: {}", e))?;
    }

    fs::write(&temp_path, content).map_err(|e| format!("写入临时数据文件失败: {}", e))?;
    fs::copy(&temp_path, path).map_err(|e| format!("写入数据文件失败: {}", e))?;
    fs::remove_file(&temp_path).ok();
    Ok(())
}

#[tauri::command]
fn load_todos() -> Result<Vec<TodoItem>, String> {
    let path = get_todos_path()?;
    read_todos_file(&path)
}

#[tauri::command]
fn save_todos(todos: Vec<TodoItem>) -> Result<(), String> {
    let path = get_todos_path()?;
    write_todos_file(&path, &todos)
}

#[tauri::command]
fn load_settings() -> Result<AppSettings, String> {
    read_settings_file()
}

#[tauri::command]
fn save_settings(settings: AppSettings) -> Result<(), String> {
    write_settings_file(&settings)
}

#[tauri::command]
fn get_data_file_status() -> Result<DataFileStatus, String> {
    let settings = read_settings_file()?;
    get_data_file_status_from_settings(&settings)
}

#[tauri::command]
fn data_folder_has_todos_file(path: String) -> Result<bool, String> {
    let folder_path = normalize_data_folder_path(&path)?;
    Ok(get_todos_path_in_folder(&folder_path).exists())
}

#[tauri::command]
fn set_data_folder_path(
    path: String,
    current_todos: Vec<TodoItem>,
) -> Result<DataFileSwitchResult, String> {
    let folder_path = normalize_data_folder_path(&path)?;
    let data_file_path = get_todos_path_in_folder(&folder_path);
    let mut settings = read_settings_file()?;

    let todos = if data_file_path.exists() {
        read_todos_file(&data_file_path)?
    } else {
        write_todos_file(&data_file_path, &current_todos)?;
        current_todos
    };

    settings.data_folder_path = Some(folder_path.display().to_string());
    settings.data_file_path = None;
    write_settings_file(&settings)?;

    let status = get_data_file_status_from_settings(&settings)?;
    Ok(DataFileSwitchResult { todos, status })
}

#[tauri::command]
fn reset_data_file_path(current_todos: Vec<TodoItem>) -> Result<DataFileSwitchResult, String> {
    let mut settings = read_settings_file()?;
    let default_path = get_default_todos_path();

    write_todos_file(&default_path, &current_todos)?;
    settings.data_folder_path = None;
    settings.data_file_path = None;
    write_settings_file(&settings)?;

    let status = get_data_file_status_from_settings(&settings)?;
    Ok(DataFileSwitchResult {
        todos: current_todos,
        status,
    })
}

#[tauri::command]
fn reload_todos_from_file() -> Result<DataFileSwitchResult, String> {
    let settings = read_settings_file()?;
    let path = get_todos_path_from_settings(&settings)?;
    let todos = read_todos_file(&path)?;
    let status = get_data_file_status_from_settings(&settings)?;

    Ok(DataFileSwitchResult { todos, status })
}

#[cfg(windows)]
fn read_autostart_command() -> Result<Option<String>, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_READ, RRF_RT_REG_SZ,
    };

    let sub_key = to_wide(AUTOSTART_RUN_KEY);
    let value_name = to_wide(AUTOSTART_APP_NAME);
    let mut key = HKEY::default();

    unsafe {
        let open_result = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(sub_key.as_ptr()),
            0,
            KEY_READ,
            &mut key,
        );

        if open_result == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }

        if open_result != ERROR_SUCCESS {
            return Err(format!("打开开机启动注册表失败: {}", open_result.0));
        }

        let mut bytes: u32 = 0;
        let size_result = RegGetValueW(
            key,
            PCWSTR::null(),
            PCWSTR(value_name.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            None,
            Some(&mut bytes),
        );

        if size_result == ERROR_FILE_NOT_FOUND {
            let _ = RegCloseKey(key);
            return Ok(None);
        }

        if size_result != ERROR_SUCCESS {
            let _ = RegCloseKey(key);
            return Err(format!("读取开机启动状态失败: {}", size_result.0));
        }

        let mut buffer = vec![0u16; (bytes as usize + 1) / 2];
        let read_result = RegGetValueW(
            key,
            PCWSTR::null(),
            PCWSTR(value_name.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr() as *mut _),
            Some(&mut bytes),
        );
        let _ = RegCloseKey(key);

        if read_result != ERROR_SUCCESS {
            return Err(format!("读取开机启动状态失败: {}", read_result.0));
        }

        if let Some(null_index) = buffer.iter().position(|value| *value == 0) {
            buffer.truncate(null_index);
        }

        Ok(Some(String::from_utf16_lossy(&buffer)))
    }
}

#[cfg(windows)]
fn write_autostart_command(command: &str) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
        REG_OPTION_NON_VOLATILE, REG_SZ,
    };

    let sub_key = to_wide(AUTOSTART_RUN_KEY);
    let value_name = to_wide(AUTOSTART_APP_NAME);
    let value = to_wide(command);
    let mut key = HKEY::default();

    unsafe {
        let create_result = RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(sub_key.as_ptr()),
            0,
            None,
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut key,
            None,
        );

        if create_result != ERROR_SUCCESS {
            return Err(format!("打开开机启动注册表失败: {}", create_result.0));
        }

        let data = std::slice::from_raw_parts(
            value.as_ptr() as *const u8,
            value.len() * std::mem::size_of::<u16>(),
        );
        let set_result = RegSetValueExW(key, PCWSTR(value_name.as_ptr()), 0, REG_SZ, Some(data));
        let _ = RegCloseKey(key);

        if set_result != ERROR_SUCCESS {
            return Err(format!("设置开机启动失败: {}", set_result.0));
        }

        Ok(())
    }
}

#[cfg(windows)]
fn delete_autostart_command() -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegDeleteValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
    };

    let sub_key = to_wide(AUTOSTART_RUN_KEY);
    let value_name = to_wide(AUTOSTART_APP_NAME);
    let mut key = HKEY::default();

    unsafe {
        let open_result = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(sub_key.as_ptr()),
            0,
            KEY_SET_VALUE,
            &mut key,
        );

        if open_result == ERROR_FILE_NOT_FOUND {
            return Ok(());
        }

        if open_result != ERROR_SUCCESS {
            return Err(format!("打开开机启动注册表失败: {}", open_result.0));
        }

        let delete_result = RegDeleteValueW(key, PCWSTR(value_name.as_ptr()));
        let _ = RegCloseKey(key);

        if delete_result != ERROR_SUCCESS && delete_result != ERROR_FILE_NOT_FOUND {
            return Err(format!("关闭开机启动失败: {}", delete_result.0));
        }

        Ok(())
    }
}

#[cfg(windows)]
fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
#[tauri::command]
fn is_autostart_enabled() -> Result<bool, String> {
    Ok(read_autostart_command()?.as_deref() == Some(get_current_exe_command()?.as_str()))
}

#[cfg(windows)]
#[tauri::command]
fn set_autostart_enabled(enabled: bool) -> Result<bool, String> {
    if enabled {
        write_autostart_command(&get_current_exe_command()?)?;
    } else {
        delete_autostart_command()?;
    }

    is_autostart_enabled()
}

#[cfg(target_os = "macos")]
fn get_macos_launch_agent_path() -> Result<PathBuf, String> {
    let mut path = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;
    path.push("Library");
    path.push("LaunchAgents");
    fs::create_dir_all(&path).map_err(|e| format!("创建开机启动目录失败: {}", e))?;
    path.push(format!("{}.plist", MACOS_LAUNCH_AGENT_ID));
    Ok(path)
}

#[cfg(target_os = "macos")]
fn escape_plist_value(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(target_os = "macos")]
fn get_macos_launch_agent_content() -> Result<String, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = escape_plist_value(&exe_path.display().to_string());
    Ok(format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
"#,
        MACOS_LAUNCH_AGENT_ID, exe
    ))
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn is_autostart_enabled() -> Result<bool, String> {
    let path = get_macos_launch_agent_path()?;
    if !path.exists() {
        return Ok(false);
    }

    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(content.contains(&escape_plist_value(&exe_path.display().to_string())))
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn set_autostart_enabled(enabled: bool) -> Result<bool, String> {
    let path = get_macos_launch_agent_path()?;
    if enabled {
        fs::write(path, get_macos_launch_agent_content()?)
            .map_err(|e| format!("设置开机启动失败: {}", e))?;
    } else if path.exists() {
        fs::remove_file(path).map_err(|e| format!("关闭开机启动失败: {}", e))?;
    }

    is_autostart_enabled()
}

#[cfg(target_os = "linux")]
fn get_linux_autostart_path() -> Result<PathBuf, String> {
    let mut path = if let Some(config_home) = std::env::var_os("XDG_CONFIG_HOME") {
        PathBuf::from(config_home)
    } else {
        let mut home = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;
        home.push(".config");
        home
    };

    path.push("autostart");
    fs::create_dir_all(&path).map_err(|e| format!("创建开机启动目录失败: {}", e))?;
    path.push(AUTOSTART_DESKTOP_FILE_NAME);
    Ok(path)
}

#[cfg(target_os = "linux")]
fn escape_desktop_exec(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(target_os = "linux")]
fn get_linux_desktop_entry_content() -> Result<String, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = escape_desktop_exec(&exe_path.display().to_string());
    Ok(format!(
        "[Desktop Entry]\nType=Application\nName=每日待办\nExec=\"{}\"\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
        exe
    ))
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn is_autostart_enabled() -> Result<bool, String> {
    let path = get_linux_autostart_path()?;
    if !path.exists() {
        return Ok(false);
    }

    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(content.contains(&escape_desktop_exec(&exe_path.display().to_string())))
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn set_autostart_enabled(enabled: bool) -> Result<bool, String> {
    let path = get_linux_autostart_path()?;
    if enabled {
        fs::write(path, get_linux_desktop_entry_content()?)
            .map_err(|e| format!("设置开机启动失败: {}", e))?;
    } else if path.exists() {
        fs::remove_file(path).map_err(|e| format!("关闭开机启动失败: {}", e))?;
    }

    is_autostart_enabled()
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
#[tauri::command]
fn is_autostart_enabled() -> Result<bool, String> {
    Ok(false)
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
#[tauri::command]
fn set_autostart_enabled(_enabled: bool) -> Result<bool, String> {
    Err("当前平台暂不支持开机启动设置".to_string())
}

#[tauri::command]
async fn show_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e: tauri_plugin_notification::Error| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn toggle_widget_mode(app: AppHandle) -> Result<(), String> {
    // 检查小组件窗口是否存在
    if let Some(wallpaper) = app.get_webview_window("wallpaper") {
        // 如果存在，关闭它
        wallpaper.close().map_err(|e| e.to_string())?;
    } else {
        // 创建小组件窗口
        create_wallpaper_window(&app)?;
    }
    Ok(())
}

#[tauri::command]
async fn toggle_wallpaper_mode(app: AppHandle) -> Result<(), String> {
    toggle_widget_mode(app).await
}

#[tauri::command]
async fn show_editor_window(app: AppHandle) -> Result<(), String> {
    if let Some(editor) = app.get_webview_window("editor") {
        editor.show().map_err(|e| e.to_string())?;
        editor.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn create_wallpaper_window(app: &AppHandle) -> Result<(), String> {
    // 小组件模式使用普通 Tauri 窗口，不再挂到 Explorer 桌面层，避免影响桌面图标。
    WebviewWindowBuilder::new(app, "wallpaper", WebviewUrl::App("wallpaper.html".into()))
        .title("每日待办 - 小组件")
        .inner_size(380.0, 520.0)
        .min_inner_size(320.0, 380.0)
        .decorations(false)
        .resizable(true)
        .skip_taskbar(true)
        .always_on_top(true)
        .transparent(true)
        .visible(true)
        .center()
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // 创建托盘菜单
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "显示编辑窗口", true, None::<&str>)?;
            let wallpaper_i =
                MenuItem::with_id(app, "wallpaper", "切换小组件", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&show_i, &wallpaper_i, &quit_i])?;

            // 创建系统托盘
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("每日待办")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("editor") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "wallpaper" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = toggle_widget_mode(app_handle).await;
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button, .. } = event {
                        if button == tauri::tray::MouseButton::Left {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("editor") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // 编辑窗口关闭时隐藏而不是退出
                if window.label() == "editor" {
                    window.hide().unwrap();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_todos,
            save_todos,
            load_settings,
            save_settings,
            get_data_file_status,
            data_folder_has_todos_file,
            set_data_folder_path,
            reset_data_file_path,
            reload_todos_from_file,
            is_autostart_enabled,
            set_autostart_enabled,
            show_notification,
            toggle_widget_mode,
            toggle_wallpaper_mode,
            show_editor_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
