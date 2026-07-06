// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, Position, Size, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

const AUTOSTART_APP_NAME: &str = "DailyTodoApp";
const AUTOSTART_RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
#[cfg(target_os = "linux")]
const AUTOSTART_DESKTOP_FILE_NAME: &str = "daily-todo-app.desktop";
#[cfg(target_os = "macos")]
const MACOS_LAUNCH_AGENT_ID: &str = "com.dailytodo.desktop";
const EXTERNAL_TODOS_FILE_NAME: &str = "daily-todos.json";
const JIRA_CONFIG_FILE_NAME: &str = "jira-config.json";
const APP_LOG_FILE_NAME: &str = "daily-todo-app.log";
const MAX_LOG_FILE_BYTES: u64 = 1024 * 1024;
const DEFAULT_JIRA_REFRESH_INTERVAL_SECONDS: u64 = 60;
const DEFAULT_JIRA_MAX_ISSUES: u32 = 20;
const WIDGET_WINDOW_MARGIN_LOGICAL: f64 = 18.0;
const WIDGET_WINDOW_GAP_LOGICAL: f64 = 12.0;
const WIDGET_WINDOW_WIDTH_LOGICAL: f64 = 380.0;
const WIDGET_WINDOW_MIN_WIDTH_LOGICAL: f64 = 300.0;
const WIDGET_WINDOW_MIN_HEIGHT_LOGICAL: f64 = 48.0;
const WIDGET_WINDOW_MAX_HEIGHT_LOGICAL: f64 = 900.0;
const LEGACY_WIDGET_WINDOW_LABEL: &str = "wallpaper";
const WIDGET_JIRA_WINDOW_LABEL: &str = "widget-jira";
const WIDGET_DAILY_WINDOW_LABEL: &str = "widget-daily";
const WIDGET_LONG_TERM_WINDOW_LABEL: &str = "widget-long-term";
const WIDGET_WINDOW_LABELS: [&str; 3] = [
    WIDGET_JIRA_WINDOW_LABEL,
    WIDGET_DAILY_WINDOW_LABEL,
    WIDGET_LONG_TERM_WINDOW_LABEL,
];
const WIDGET_WINDOW_INITIAL_HEIGHTS: [f64; 3] = [220.0, 180.0, 180.0];
const WIDGET_WINDOW_POSITION_TOLERANCE: i32 = 2;
const DEFAULT_JIRA_JQL: &str =
    "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
const JIRA_FIELDS: &str = "summary,status,priority,issuetype,updated,duedate";

static EXPECTED_WIDGET_WINDOW_MOVES: OnceLock<Mutex<[Option<(i32, i32)>; 3]>> = OnceLock::new();
static EXPECTED_WIDGET_WINDOW_RESIZE_WIDTHS: OnceLock<Mutex<[Option<u32>; 3]>> = OnceLock::new();

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

#[derive(Debug, Serialize, Deserialize, Clone)]
struct JiraConfigFile {
    enabled: bool,
    #[serde(rename = "siteUrl")]
    site_url: String,
    email: String,
    #[serde(rename = "apiToken")]
    api_token: String,
    #[serde(rename = "refreshIntervalSeconds")]
    refresh_interval_seconds: u64,
    #[serde(rename = "maxIssues")]
    max_issues: u32,
    jql: String,
}

impl Default for JiraConfigFile {
    fn default() -> Self {
        Self {
            enabled: false,
            site_url: String::new(),
            email: String::new(),
            api_token: String::new(),
            refresh_interval_seconds: DEFAULT_JIRA_REFRESH_INTERVAL_SECONDS,
            max_issues: DEFAULT_JIRA_MAX_ISSUES,
            jql: DEFAULT_JIRA_JQL.to_string(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct JiraConfigInput {
    enabled: bool,
    #[serde(rename = "siteUrl")]
    site_url: String,
    email: String,
    #[serde(rename = "apiToken")]
    api_token: Option<String>,
    #[serde(rename = "refreshIntervalSeconds")]
    refresh_interval_seconds: u64,
    #[serde(rename = "maxIssues")]
    max_issues: u32,
    jql: String,
}

#[derive(Debug, Serialize)]
struct JiraConfigView {
    enabled: bool,
    #[serde(rename = "siteUrl")]
    site_url: String,
    email: String,
    #[serde(rename = "apiTokenConfigured")]
    api_token_configured: bool,
    #[serde(rename = "refreshIntervalSeconds")]
    refresh_interval_seconds: u64,
    #[serde(rename = "maxIssues")]
    max_issues: u32,
    jql: String,
    #[serde(rename = "configPath")]
    config_path: String,
}

#[derive(Debug, Serialize)]
struct JiraIssue {
    key: String,
    summary: String,
    status: String,
    priority: Option<String>,
    #[serde(rename = "issueType")]
    issue_type: Option<String>,
    updated: Option<String>,
    #[serde(rename = "dueDate")]
    due_date: Option<String>,
    url: String,
}

#[derive(Debug, Serialize)]
struct JiraTestResult {
    #[serde(rename = "issueCount")]
    issue_count: usize,
    #[serde(rename = "hasMore")]
    has_more: bool,
    warnings: Vec<String>,
    message: String,
}

#[derive(Debug, Serialize)]
struct JiraDiagnosticResult {
    #[serde(rename = "accountId")]
    account_id: String,
    #[serde(rename = "displayName")]
    display_name: String,
    #[serde(rename = "emailAddress")]
    email_address: Option<String>,
    queries: Vec<JiraDiagnosticQueryResult>,
}

#[derive(Debug, Serialize)]
struct JiraDiagnosticQueryResult {
    label: String,
    jql: String,
    #[serde(rename = "issueCount")]
    issue_count: Option<usize>,
    #[serde(rename = "hasMore")]
    has_more: bool,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JiraUserResponse {
    #[serde(rename = "accountId")]
    account_id: String,
    #[serde(rename = "displayName")]
    display_name: String,
    #[serde(rename = "emailAddress")]
    email_address: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JiraSearchResponse {
    issues: Vec<JiraApiIssue>,
    #[serde(rename = "isLast")]
    is_last: Option<bool>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
    #[serde(rename = "warningMessages", default)]
    warning_messages: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct JiraApiIssue {
    key: String,
    fields: JiraApiFields,
}

#[derive(Debug, Deserialize)]
struct JiraApiFields {
    summary: Option<String>,
    status: Option<JiraNamedField>,
    priority: Option<JiraNamedField>,
    #[serde(rename = "issuetype")]
    issue_type: Option<JiraNamedField>,
    updated: Option<String>,
    #[serde(rename = "duedate")]
    due_date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JiraNamedField {
    name: String,
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

fn get_jira_config_path() -> PathBuf {
    let mut path = get_data_dir();
    path.push(JIRA_CONFIG_FILE_NAME);
    path
}

fn get_app_log_file_path() -> PathBuf {
    let mut path = get_data_dir();
    path.push(APP_LOG_FILE_NAME);
    path
}

fn sanitize_log_text(value: &str) -> String {
    let mut text = value.replace('\n', " ").replace('\r', " ");
    if text.len() > 1200 {
        text.truncate(1200);
        text.push_str("...");
    }
    text
}

fn current_log_timestamp() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}", duration.as_secs(), duration.subsec_millis())
}

fn rotate_log_file_if_needed(path: &Path) {
    let Ok(metadata) = fs::metadata(path) else {
        return;
    };
    if metadata.len() <= MAX_LOG_FILE_BYTES {
        return;
    }

    let mut old_path = path.to_path_buf();
    old_path.set_extension("log.old");
    let _ = fs::remove_file(&old_path);
    let _ = fs::rename(path, old_path);
}

fn append_app_log(level: &str, message: &str) {
    let path = get_app_log_file_path();
    rotate_log_file_if_needed(&path);

    let level = sanitize_log_text(level);
    let message = sanitize_log_text(message);
    let line = format!("[{}] [{}] {}\n", current_log_timestamp(), level, message);

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(line.as_bytes());
    }
}

#[tauri::command]
fn get_app_log_path() -> Result<String, String> {
    Ok(get_app_log_file_path().display().to_string())
}

#[tauri::command]
fn write_app_log(level: String, message: String) -> Result<(), String> {
    append_app_log(&level, &message);
    Ok(())
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

fn read_jira_config_file() -> Result<JiraConfigFile, String> {
    let path = get_jira_config_path();
    if !path.exists() {
        return Ok(JiraConfigFile::default());
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut config: JiraConfigFile =
        serde_json::from_str(&content).map_err(|e| format!("Jira 配置文件格式错误: {}", e))?;
    normalize_jira_config_values(&mut config);
    Ok(config)
}

fn write_jira_config_file(config: &JiraConfigFile) -> Result<(), String> {
    let path = get_jira_config_path();
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| format!("保存 Jira 配置失败: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        let _ = fs::set_permissions(&path, permissions);
    }

    Ok(())
}

fn normalize_jira_config_values(config: &mut JiraConfigFile) {
    config.site_url = config.site_url.trim().trim_end_matches('/').to_string();
    config.email = config.email.trim().to_string();
    config.refresh_interval_seconds = config.refresh_interval_seconds.clamp(30, 3600);
    config.max_issues = config.max_issues.clamp(1, 100);
    config.jql = config.jql.trim().to_string();
    if config.jql.is_empty() {
        config.jql = DEFAULT_JIRA_JQL.to_string();
    }
}

fn create_jira_config_view(config: &JiraConfigFile) -> JiraConfigView {
    JiraConfigView {
        enabled: config.enabled,
        site_url: config.site_url.clone(),
        email: config.email.clone(),
        api_token_configured: !config.api_token.trim().is_empty(),
        refresh_interval_seconds: config.refresh_interval_seconds,
        max_issues: config.max_issues,
        jql: config.jql.clone(),
        config_path: get_jira_config_path().display().to_string(),
    }
}

fn build_jira_config(
    input: JiraConfigInput,
    existing: JiraConfigFile,
) -> Result<JiraConfigFile, String> {
    let api_token = input
        .api_token
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
        .unwrap_or(existing.api_token);

    let mut config = JiraConfigFile {
        enabled: input.enabled,
        site_url: input.site_url,
        email: input.email,
        api_token,
        refresh_interval_seconds: input.refresh_interval_seconds,
        max_issues: input.max_issues,
        jql: input.jql,
    };
    normalize_jira_config_values(&mut config);

    if config.enabled {
        config.site_url = validate_jira_site_url(&config.site_url)?;
        validate_jira_config_for_fetch(&config)?;
    } else if !config.site_url.is_empty() {
        config.site_url = validate_jira_site_url(&config.site_url)?;
    }

    Ok(config)
}

fn validate_jira_config_for_fetch(config: &JiraConfigFile) -> Result<(), String> {
    validate_jira_site_url(&config.site_url)?;
    if config.email.trim().is_empty() {
        return Err("Jira 邮箱不能为空".to_string());
    }
    if config.api_token.trim().is_empty() {
        return Err("Jira API Token 不能为空".to_string());
    }
    if config.jql.trim().is_empty() {
        return Err("Jira JQL 不能为空".to_string());
    }
    Ok(())
}

fn validate_jira_site_url(site_url: &str) -> Result<String, String> {
    let trimmed = site_url.trim().trim_end_matches('/');
    let mut parsed =
        reqwest::Url::parse(trimmed).map_err(|_| "Jira 站点地址格式错误".to_string())?;

    if parsed.scheme() != "https" {
        return Err("Jira 站点地址必须使用 https".to_string());
    }

    if parsed.host_str().is_none() {
        return Err("Jira 站点地址必须包含域名".to_string());
    }

    parsed.set_path("");
    parsed.set_query(None);
    parsed.set_fragment(None);
    Ok(parsed.as_str().trim_end_matches('/').to_string())
}

fn sanitize_jira_error_body(body: &str) -> String {
    let mut text = body.replace('\n', " ").replace('\r', " ");
    if text.len() > 300 {
        text.truncate(300);
        text.push_str("...");
    }
    text
}

async fn search_jira_issues_internal(
    config: &JiraConfigFile,
) -> Result<JiraSearchResponse, String> {
    if !config.enabled {
        return Ok(JiraSearchResponse {
            issues: Vec::new(),
            is_last: Some(true),
            next_page_token: None,
            warning_messages: Vec::new(),
        });
    }

    search_jira_issues_with_jql(config, &config.jql, config.max_issues).await
}

async fn search_jira_issues_with_jql(
    config: &JiraConfigFile,
    jql: &str,
    max_issues: u32,
) -> Result<JiraSearchResponse, String> {
    validate_jira_config_for_fetch(config)?;
    let site_url = validate_jira_site_url(&config.site_url)?;
    let search_url = format!("{}/rest/api/3/search/jql", site_url);
    let fields: Vec<&str> = JIRA_FIELDS.split(',').collect();
    let request_body = serde_json::json!({
        "jql": jql,
        "fields": fields,
        "maxResults": max_issues.clamp(1, 100)
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("创建 Jira HTTP 客户端失败: {}", e))?;

    let response = client
        .post(search_url)
        .header("Accept", "application/json")
        .basic_auth(&config.email, Some(&config.api_token))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("请求 Jira 失败: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取 Jira 响应失败: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "Jira 请求失败: HTTP {} {}",
            status.as_u16(),
            sanitize_jira_error_body(&body)
        ));
    }

    let parsed: JiraSearchResponse =
        serde_json::from_str(&body).map_err(|e| format!("解析 Jira 响应失败: {}", e))?;

    Ok(parsed)
}

async fn get_jira_current_user(config: &JiraConfigFile) -> Result<JiraUserResponse, String> {
    validate_jira_config_for_fetch(config)?;
    let site_url = validate_jira_site_url(&config.site_url)?;
    let myself_url = format!("{}/rest/api/3/myself", site_url);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("创建 Jira HTTP 客户端失败: {}", e))?;

    let response = client
        .get(myself_url)
        .header("Accept", "application/json")
        .basic_auth(&config.email, Some(&config.api_token))
        .send()
        .await
        .map_err(|e| format!("请求 Jira 当前用户失败: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取 Jira 当前用户响应失败: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "Jira 当前用户请求失败: HTTP {} {}",
            status.as_u16(),
            sanitize_jira_error_body(&body)
        ));
    }

    serde_json::from_str(&body).map_err(|e| format!("解析 Jira 当前用户响应失败: {}", e))
}

async fn fetch_jira_issues_internal(config: &JiraConfigFile) -> Result<Vec<JiraIssue>, String> {
    if !config.enabled {
        return Ok(Vec::new());
    }

    let site_url = validate_jira_site_url(&config.site_url)?;
    let parsed = search_jira_issues_internal(config).await?;

    Ok(parsed
        .issues
        .into_iter()
        .map(|issue| JiraIssue {
            url: format!("{}/browse/{}", site_url, issue.key),
            key: issue.key,
            summary: issue.fields.summary.unwrap_or_else(|| "无标题".to_string()),
            status: issue
                .fields
                .status
                .map(|status| status.name)
                .unwrap_or_else(|| "未知状态".to_string()),
            priority: issue.fields.priority.map(|priority| priority.name),
            issue_type: issue.fields.issue_type.map(|issue_type| issue_type.name),
            updated: issue.fields.updated,
            due_date: issue.fields.due_date,
        })
        .collect())
}

fn is_valid_jira_issue_key(key: &str) -> bool {
    let mut parts = key.split('-');
    let Some(project) = parts.next() else {
        return false;
    };
    let Some(number) = parts.next() else {
        return false;
    };
    if parts.next().is_some() || project.is_empty() || number.is_empty() {
        return false;
    }

    project
        .chars()
        .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit())
        && number.chars().all(|ch| ch.is_ascii_digit())
}

fn open_url_in_default_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    let result = Command::new("cmd").args(["/C", "start", "", url]).spawn();

    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(url).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(url).spawn();

    #[cfg(not(any(windows, target_os = "macos", unix)))]
    let result: Result<std::process::Child, std::io::Error> = Err(std::io::Error::new(
        std::io::ErrorKind::Other,
        "unsupported platform",
    ));

    result
        .map(|_| ())
        .map_err(|e| format!("打开浏览器失败: {}", e))
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

#[tauri::command]
fn load_jira_config() -> Result<JiraConfigView, String> {
    let config = read_jira_config_file()?;
    Ok(create_jira_config_view(&config))
}

#[tauri::command]
fn save_jira_config(input: JiraConfigInput) -> Result<JiraConfigView, String> {
    let existing = read_jira_config_file()?;
    let config = build_jira_config(input, existing)?;
    write_jira_config_file(&config)?;
    Ok(create_jira_config_view(&config))
}

#[tauri::command]
async fn fetch_jira_issues() -> Result<Vec<JiraIssue>, String> {
    let config = read_jira_config_file()?;
    fetch_jira_issues_internal(&config).await
}

#[tauri::command]
async fn test_jira_connection() -> Result<JiraTestResult, String> {
    let mut config = read_jira_config_file()?;
    config.enabled = true;
    let search = search_jira_issues_internal(&config).await?;
    let has_more = search.is_last == Some(false) || search.next_page_token.is_some();
    Ok(JiraTestResult {
        issue_count: search.issues.len(),
        has_more,
        warnings: search.warning_messages,
        message: "Jira 连接成功".to_string(),
    })
}

#[tauri::command]
async fn diagnose_jira_connection() -> Result<JiraDiagnosticResult, String> {
    let mut config = read_jira_config_file()?;
    config.enabled = true;
    let user = get_jira_current_user(&config).await?;
    let explicit_account_jql = format!(
        "assignee = \"{}\" AND statusCategory != Done ORDER BY updated DESC",
        user.account_id
    );
    let explicit_account_all_jql =
        format!("assignee = \"{}\" ORDER BY updated DESC", user.account_id);
    let diagnostic_queries = vec![
        ("当前配置", config.jql.clone()),
        (
            "currentUser 不限状态",
            "assignee = currentUser() ORDER BY updated DESC".to_string(),
        ),
        ("显式账号未完成", explicit_account_jql),
        ("显式账号不限状态", explicit_account_all_jql),
    ];

    let mut queries = Vec::new();
    for (label, jql) in diagnostic_queries {
        match search_jira_issues_with_jql(&config, &jql, config.max_issues).await {
            Ok(search) => queries.push(JiraDiagnosticQueryResult {
                label: label.to_string(),
                jql,
                issue_count: Some(search.issues.len()),
                has_more: search.is_last == Some(false) || search.next_page_token.is_some(),
                error: None,
            }),
            Err(error) => queries.push(JiraDiagnosticQueryResult {
                label: label.to_string(),
                jql,
                issue_count: None,
                has_more: false,
                error: Some(error),
            }),
        }
    }

    Ok(JiraDiagnosticResult {
        account_id: user.account_id,
        display_name: user.display_name,
        email_address: user.email_address,
        queries,
    })
}

#[tauri::command]
fn open_jira_issue(key: String) -> Result<(), String> {
    if !is_valid_jira_issue_key(&key) {
        return Err("Jira issue key 格式错误".to_string());
    }

    let config = read_jira_config_file()?;
    validate_jira_config_for_fetch(&config)?;
    let site_url = validate_jira_site_url(&config.site_url)?;
    let url = format!("{}/browse/{}", site_url, key);
    open_url_in_default_browser(&url)
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
    append_app_log("INFO", "toggle_widget_mode requested");
    let result = if has_widget_windows(&app) {
        append_app_log("INFO", "closing widget windows");
        close_widget_windows(&app)
    } else {
        append_app_log("INFO", "creating widget windows");
        create_widget_windows(&app)
    };

    match &result {
        Ok(()) => append_app_log("INFO", "toggle_widget_mode completed"),
        Err(error) => append_app_log("ERROR", &format!("toggle_widget_mode failed: {error}")),
    }

    result
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

#[tauri::command]
fn resize_widget_window(app: AppHandle, label: String, height: f64) -> Result<(), String> {
    if widget_window_index(&label).is_none() {
        return Ok(());
    }
    if !height.is_finite() {
        append_app_log(
            "WARN",
            &format!("resize_widget_window ignored non-finite height label={label}"),
        );
        return Ok(());
    }

    let Some(window) = app.get_webview_window(&label) else {
        return Ok(());
    };

    let clamped_height = height.clamp(
        WIDGET_WINDOW_MIN_HEIGHT_LOGICAL,
        WIDGET_WINDOW_MAX_HEIGHT_LOGICAL,
    );
    let current_position = window.outer_position().map_err(|e| e.to_string())?;
    let current_outer_size = window.outer_size().map_err(|e| e.to_string())?;
    let current_inner_size = window.inner_size().map_err(|e| e.to_string())?;
    let scale_factor = window.scale_factor().map_err(|e| e.to_string())?;
    let width = f64::from(current_inner_size.width) / scale_factor;
    let current_height = f64::from(current_inner_size.height) / scale_factor;
    if (current_height - clamped_height).abs() < 1.0 {
        return Ok(());
    }

    let next_physical_height = (clamped_height * scale_factor).round() as i32;
    let frame_height = current_outer_size
        .height
        .saturating_sub(current_inner_size.height) as i32;
    let next_outer_height = next_physical_height + frame_height;
    let next_y = current_position.y + current_outer_size.height as i32 - next_outer_height;
    let next_position = PhysicalPosition {
        x: current_position.x,
        y: next_y,
    };

    window
        .set_size(Size::Logical(LogicalSize {
            width,
            height: clamped_height,
        }))
        .map_err(|e| e.to_string())?;
    set_widget_window_position(&window, &label, next_position)?;
    align_widget_windows_from_anchor(&app, &label, next_position)
}

fn widget_window_index(label: &str) -> Option<usize> {
    WIDGET_WINDOW_LABELS
        .iter()
        .position(|candidate| *candidate == label)
}

fn expected_widget_window_moves() -> &'static Mutex<[Option<(i32, i32)>; 3]> {
    EXPECTED_WIDGET_WINDOW_MOVES.get_or_init(|| Mutex::new([None, None, None]))
}

fn expected_widget_window_resize_widths() -> &'static Mutex<[Option<u32>; 3]> {
    EXPECTED_WIDGET_WINDOW_RESIZE_WIDTHS.get_or_init(|| Mutex::new([None, None, None]))
}

fn positions_match(position: PhysicalPosition<i32>, expected: (i32, i32)) -> bool {
    (position.x - expected.0).abs() <= WIDGET_WINDOW_POSITION_TOLERANCE
        && (position.y - expected.1).abs() <= WIDGET_WINDOW_POSITION_TOLERANCE
}

fn widths_match(width: u32, expected: u32) -> bool {
    width.abs_diff(expected) <= WIDGET_WINDOW_POSITION_TOLERANCE as u32
}

fn consume_expected_widget_window_move(label: &str, position: PhysicalPosition<i32>) -> bool {
    let Some(index) = widget_window_index(label) else {
        return false;
    };
    let Ok(mut expected_moves) = expected_widget_window_moves().lock() else {
        return false;
    };
    let Some(expected_position) = expected_moves[index] else {
        return false;
    };

    if positions_match(position, expected_position) {
        expected_moves[index] = None;
        true
    } else {
        false
    }
}

fn mark_expected_widget_window_move(label: &str, position: PhysicalPosition<i32>) {
    let Some(index) = widget_window_index(label) else {
        return;
    };
    let Ok(mut expected_moves) = expected_widget_window_moves().lock() else {
        return;
    };
    expected_moves[index] = Some((position.x, position.y));
}

fn consume_expected_widget_window_resize(label: &str, width: u32) -> bool {
    let Some(index) = widget_window_index(label) else {
        return false;
    };
    let Ok(mut expected_widths) = expected_widget_window_resize_widths().lock() else {
        return false;
    };
    let Some(expected_width) = expected_widths[index] else {
        return false;
    };

    if widths_match(width, expected_width) {
        expected_widths[index] = None;
        true
    } else {
        false
    }
}

fn mark_expected_widget_window_resize(label: &str, width: u32) {
    let Some(index) = widget_window_index(label) else {
        return;
    };
    let Ok(mut expected_widths) = expected_widget_window_resize_widths().lock() else {
        return;
    };
    expected_widths[index] = Some(width);
}

fn set_widget_window_position(
    window: &WebviewWindow,
    label: &str,
    position: PhysicalPosition<i32>,
) -> Result<(), String> {
    mark_expected_widget_window_move(label, position);
    window
        .set_position(Position::Physical(position))
        .map_err(|e| e.to_string())
}

fn has_widget_windows(app: &AppHandle) -> bool {
    app.get_webview_window(LEGACY_WIDGET_WINDOW_LABEL).is_some()
        || WIDGET_WINDOW_LABELS
            .iter()
            .any(|label| app.get_webview_window(label).is_some())
}

fn close_widget_windows(app: &AppHandle) -> Result<(), String> {
    if let Some(wallpaper) = app.get_webview_window(LEGACY_WIDGET_WINDOW_LABEL) {
        wallpaper.close().map_err(|e| e.to_string())?;
    }

    for label in WIDGET_WINDOW_LABELS {
        if let Some(window) = app.get_webview_window(label) {
            window.close().map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

fn widget_window_title(label: &str) -> &'static str {
    match label {
        WIDGET_JIRA_WINDOW_LABEL => "每日待办 - Jira",
        WIDGET_DAILY_WINDOW_LABEL => "每日待办 - 每日代办",
        WIDGET_LONG_TERM_WINDOW_LABEL => "每日待办 - 长期代办",
        _ => "每日待办 - 小组件",
    }
}

fn create_widget_window(
    app: &AppHandle,
    label: &str,
    initial_height: f64,
) -> Result<WebviewWindow, String> {
    append_app_log(
        "INFO",
        &format!("create_widget_window start label={label} height={initial_height}"),
    );
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("wallpaper.html".into()))
        .title(widget_window_title(label))
        .inner_size(WIDGET_WINDOW_WIDTH_LOGICAL, initial_height)
        .min_inner_size(
            WIDGET_WINDOW_MIN_WIDTH_LOGICAL,
            WIDGET_WINDOW_MIN_HEIGHT_LOGICAL,
        )
        .decorations(false)
        .resizable(true)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false);

    #[cfg(windows)]
    let builder = builder.transparent(true).shadow(false);

    #[cfg(not(windows))]
    let builder = builder.transparent(true);

    let window = builder.build().map_err(|e| e.to_string())?;
    append_app_log("INFO", &format!("create_widget_window built label={label}"));
    Ok(window)
}

fn create_widget_windows(app: &AppHandle) -> Result<(), String> {
    if let Some(wallpaper) = app.get_webview_window(LEGACY_WIDGET_WINDOW_LABEL) {
        append_app_log("INFO", "closing legacy wallpaper widget window");
        wallpaper.close().map_err(|e| e.to_string())?;
    }

    for (index, label) in WIDGET_WINDOW_LABELS.iter().enumerate() {
        if app.get_webview_window(label).is_none() {
            create_widget_window(app, label, WIDGET_WINDOW_INITIAL_HEIGHTS[index])?;
        } else {
            append_app_log(
                "INFO",
                &format!("widget window already exists label={label}"),
            );
        }
    }

    for label in WIDGET_WINDOW_LABELS {
        if let Some(window) = app.get_webview_window(label) {
            append_app_log("INFO", &format!("show widget window label={label}"));
            window.show().map_err(|e| e.to_string())?;
        }
    }

    append_app_log("INFO", "position_widget_windows_bottom_right start");
    position_widget_windows_bottom_right(app)?;
    append_app_log("INFO", "position_widget_windows_bottom_right completed");

    append_app_log("INFO", "create_widget_windows completed");
    Ok(())
}

fn position_widget_windows_bottom_right(app: &AppHandle) -> Result<(), String> {
    let monitor_window = app
        .get_webview_window("editor")
        .or_else(|| app.get_webview_window(WIDGET_LONG_TERM_WINDOW_LABEL));
    let Some(monitor_window) = monitor_window else {
        append_app_log("WARN", "position skipped: no monitor source window");
        return Ok(());
    };

    append_app_log(
        "INFO",
        &format!("position monitor source label={}", monitor_window.label()),
    );
    let monitor = match monitor_window
        .current_monitor()
        .map_err(|e| e.to_string())?
    {
        Some(monitor) => Some(monitor),
        None => monitor_window
            .primary_monitor()
            .map_err(|e| e.to_string())?,
    };
    let Some(monitor) = monitor else {
        append_app_log("WARN", "position skipped: no monitor available");
        return Ok(());
    };

    let work_area = monitor.work_area();
    let scale_factor = monitor_window.scale_factor().map_err(|e| e.to_string())?;
    let margin = (WIDGET_WINDOW_MARGIN_LOGICAL * scale_factor).round() as i32;
    let gap = (WIDGET_WINDOW_GAP_LOGICAL * scale_factor).round() as i32;
    let window_width = (WIDGET_WINDOW_WIDTH_LOGICAL * scale_factor).round() as i32;
    let window_heights: Vec<i32> = WIDGET_WINDOW_INITIAL_HEIGHTS
        .iter()
        .map(|height| (height * scale_factor).round() as i32)
        .collect();
    let total_height = window_heights.iter().sum::<i32>()
        + gap * (WIDGET_WINDOW_LABELS.len().saturating_sub(1) as i32);
    let x = work_area.position.x + work_area.size.width as i32 - window_width - margin;
    let mut y = work_area.position.y + work_area.size.height as i32 - total_height - margin;

    for (index, label) in WIDGET_WINDOW_LABELS.iter().enumerate() {
        if let Some(window) = app.get_webview_window(label) {
            append_app_log(
                "INFO",
                &format!("position widget label={label} x={x} y={y}"),
            );
            if let Err(error) =
                set_widget_window_position(&window, label, PhysicalPosition { x, y })
            {
                append_app_log(
                    "ERROR",
                    &format!("position widget failed label={label} error={error}"),
                );
            }
            y += window_heights[index] + gap;
        }
    }

    Ok(())
}

fn align_widget_windows_from_anchor(
    app: &AppHandle,
    anchor_label: &str,
    anchor_position: PhysicalPosition<i32>,
) -> Result<(), String> {
    let Some(anchor_index) = widget_window_index(anchor_label) else {
        return Ok(());
    };
    let Some(anchor_window) = app.get_webview_window(anchor_label) else {
        return Ok(());
    };

    let scale_factor = anchor_window.scale_factor().map_err(|e| e.to_string())?;
    let gap = (WIDGET_WINDOW_GAP_LOGICAL * scale_factor).round() as i32;
    let mut windows = Vec::new();
    let mut heights = Vec::new();

    for label in WIDGET_WINDOW_LABELS {
        if let Some(window) = app.get_webview_window(label) {
            let height = window.outer_size().map_err(|e| e.to_string())?.height as i32;
            windows.push(Some(window));
            heights.push(Some(height));
        } else {
            windows.push(None);
            heights.push(None);
        }
    }

    let mut y_positions = vec![None; WIDGET_WINDOW_LABELS.len()];
    y_positions[anchor_index] = Some(anchor_position.y);

    for index in (0..anchor_index).rev() {
        if let (Some(next_y), Some(height)) = (y_positions[index + 1], heights[index]) {
            y_positions[index] = Some(next_y - height - gap);
        }
    }

    for index in (anchor_index + 1)..WIDGET_WINDOW_LABELS.len() {
        if let (Some(previous_y), Some(previous_height)) =
            (y_positions[index - 1], heights[index - 1])
        {
            y_positions[index] = Some(previous_y + previous_height + gap);
        }
    }

    for (index, window) in windows.into_iter().enumerate() {
        let Some(window) = window else {
            continue;
        };
        let Some(y) = y_positions[index] else {
            continue;
        };
        let target_position = PhysicalPosition {
            x: anchor_position.x,
            y,
        };
        let current_position = window.outer_position().map_err(|e| e.to_string())?;
        if current_position == target_position {
            continue;
        }
        set_widget_window_position(&window, WIDGET_WINDOW_LABELS[index], target_position)?;
    }

    Ok(())
}

fn sync_widget_window_widths_from_anchor(
    app: &AppHandle,
    anchor_label: &str,
) -> Result<(), String> {
    if widget_window_index(anchor_label).is_none() {
        return Ok(());
    }

    let Some(anchor_window) = app.get_webview_window(anchor_label) else {
        return Ok(());
    };

    let anchor_inner_size = anchor_window.inner_size().map_err(|e| e.to_string())?;
    let anchor_scale_factor = anchor_window.scale_factor().map_err(|e| e.to_string())?;
    let anchor_width = f64::from(anchor_inner_size.width) / anchor_scale_factor;

    for label in WIDGET_WINDOW_LABELS {
        if label == anchor_label {
            continue;
        }

        let Some(window) = app.get_webview_window(label) else {
            continue;
        };

        let inner_size = window.inner_size().map_err(|e| e.to_string())?;
        if inner_size.width == anchor_inner_size.width {
            continue;
        }

        let scale_factor = window.scale_factor().map_err(|e| e.to_string())?;
        let height = f64::from(inner_size.height) / scale_factor;
        let expected_width = (anchor_width * scale_factor).round() as u32;
        mark_expected_widget_window_resize(label, expected_width);
        window
            .set_size(Size::Logical(LogicalSize {
                width: anchor_width,
                height,
            }))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn main() {
    std::panic::set_hook(Box::new(|panic_info| {
        append_app_log("PANIC", &panic_info.to_string());
    }));
    append_app_log("INFO", "application starting");

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            append_app_log("INFO", "tauri setup start");
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
                        append_app_log("INFO", "tray quit requested");
                        app.exit(0);
                    }
                    "show" => {
                        append_app_log("INFO", "tray show editor requested");
                        if let Some(window) = app.get_webview_window("editor") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "wallpaper" => {
                        append_app_log("INFO", "tray toggle widget requested");
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) = toggle_widget_mode(app_handle).await {
                                append_app_log(
                                    "ERROR",
                                    &format!("tray toggle widget failed: {error}"),
                                );
                            }
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

            append_app_log("INFO", "tauri setup completed");
            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label();
            if widget_window_index(label).is_some() {
                if let tauri::WindowEvent::Moved(position) = event {
                    if consume_expected_widget_window_move(label, *position) {
                        return;
                    }

                    let app = window.app_handle().clone();
                    let _ = align_widget_windows_from_anchor(&app, label, *position);
                }

                if let tauri::WindowEvent::Resized(size) = event {
                    if consume_expected_widget_window_resize(label, size.width) {
                        return;
                    }

                    let app = window.app_handle().clone();
                    let _ = sync_widget_window_widths_from_anchor(&app, label);
                    if let Ok(position) = window.outer_position() {
                        let _ = align_widget_windows_from_anchor(&app, label, position);
                    }
                }
            }

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
            load_jira_config,
            save_jira_config,
            fetch_jira_issues,
            test_jira_connection,
            diagnose_jira_connection,
            open_jira_issue,
            is_autostart_enabled,
            set_autostart_enabled,
            show_notification,
            get_app_log_path,
            write_app_log,
            toggle_widget_mode,
            toggle_wallpaper_mode,
            show_editor_window,
            resize_widget_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
