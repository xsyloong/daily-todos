import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { JiraConfigView, JiraIssue, TodoItem } from "./types";
import { getTodoTimeLabel } from "./timeRanges";
import {
  getLocalDateString,
  getLongTermDisplayText,
  getLongTermTodoInfo,
  getTodosForDate,
  isLongTermTodo,
  isTodoCompletedOnDate,
  normalizeLongTermTodo,
  toggleTodoCompletionForDate,
} from "./todoUtils";
import "./Wallpaper.css";

function Wallpaper() {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [jiraConfig, setJiraConfig] = useState<JiraConfigView | undefined>();
  const [jiraIssues, setJiraIssues] = useState<JiraIssue[]>([]);
  const [jiraError, setJiraError] = useState("");
  const [jiraLastUpdated, setJiraLastUpdated] = useState("");
  const [jiraRefreshIntervalSeconds, setJiraRefreshIntervalSeconds] = useState(60);
  const [jiraSyncing, setJiraSyncing] = useState(false);
  const [currentDate, setCurrentDate] = useState<string>(getLocalDateString());
  const todosRef = useRef<TodoItem[]>([]);

  const loadTodos = useCallback(async () => {
    try {
      const loadedTodos = await invoke<TodoItem[]>("load_todos");
      const normalizedTodos = loadedTodos.map((todo) => normalizeLongTermTodo(todo));
      todosRef.current = normalizedTodos;
      setTodos(normalizedTodos);
    } catch (error) {
      console.error("加载待办失败:", error);
    }
  }, []);

  const loadJiraIssues = useCallback(async () => {
    setJiraSyncing(true);
    try {
      const config = await invoke<JiraConfigView>("load_jira_config");
      setJiraConfig(config);
      setJiraRefreshIntervalSeconds(config.refreshIntervalSeconds || 60);

      if (!config.enabled) {
        setJiraIssues([]);
        setJiraError("");
        setJiraLastUpdated("");
        return;
      }

      const issues = await invoke<JiraIssue[]>("fetch_jira_issues");
      setJiraIssues(issues);
      setJiraError("");
      setJiraLastUpdated(formatShortTime(new Date()));
    } catch (error) {
      console.error("加载 Jira 任务失败:", error);
      setJiraError(String(error));
    } finally {
      setJiraSyncing(false);
    }
  }, []);

  useEffect(() => {
    void loadTodos();
    const interval = setInterval(() => void loadTodos(), 5000);
    return () => clearInterval(interval);
  }, [loadTodos]);

  useEffect(() => {
    void loadJiraIssues();
    const interval = setInterval(
      () => void loadJiraIssues(),
      Math.max(30, jiraRefreshIntervalSeconds) * 1000
    );
    return () => clearInterval(interval);
  }, [jiraRefreshIntervalSeconds, loadJiraIssues]);

  useEffect(() => {
    const interval = setInterval(() => setCurrentDate(getLocalDateString()), 60000);
    return () => clearInterval(interval);
  }, []);

  const toggleTodo = useCallback(
    async (id: string) => {
      const updatedTodos = todosRef.current.map((todo) =>
        todo.id === id ? toggleTodoCompletionForDate(todo, currentDate) : todo
      );

      todosRef.current = updatedTodos;
      setTodos(updatedTodos);

      try {
        await invoke("save_todos", { todos: updatedTodos });
      } catch (error) {
        console.error("更新待办失败:", error);
        void loadTodos();
      }
    },
    [currentDate, loadTodos]
  );

  const todayTodos = useMemo(
    () => getTodosForDate(todos, currentDate),
    [todos, currentDate]
  );
  const dailyTodos = useMemo(
    () => todayTodos.filter((todo) => !isLongTermTodo(todo)),
    [todayTodos]
  );
  const longTermTodos = useMemo(
    () => todayTodos.filter((todo) => isLongTermTodo(todo)),
    [todayTodos]
  );
  const dailyCompletedCount = dailyTodos.filter((todo) =>
    isTodoCompletedOnDate(todo, currentDate)
  ).length;
  const longTermCompletedCount = longTermTodos.filter((todo) =>
    isTodoCompletedOnDate(todo, currentDate)
  ).length;

  const startWindowDrag = useCallback((event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    void getCurrentWindow().startDragging().catch((error) => {
      console.error("拖动小组件失败:", error);
    });
  }, []);

  const keepTodoClickLocal = useCallback((event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);

  const openJiraIssue = useCallback(async (key: string) => {
    try {
      await invoke("open_jira_issue", { key });
    } catch (error) {
      console.error("打开 Jira 任务失败:", error);
    }
  }, []);

  const syncJiraNow = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      void loadJiraIssues();
    },
    [loadJiraIssues]
  );

  const formatDate = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const weekday = weekdays[date.getDay()];
    return `${year}年${month}月${day}日 ${weekday}`;
  };

  const renderLocalTodo = (todo: TodoItem) => {
    const timeLabel = getTodoTimeLabel(todo);
    const completed = isTodoCompletedOnDate(todo, currentDate);
    const longTermInfo = getLongTermTodoInfo(todo, currentDate);
    const displayText = longTermInfo
      ? getLongTermDisplayText(todo, currentDate)
      : todo.text;

    return (
      <div
        key={todo.id}
        className={`wallpaper-todo-item ${completed ? "completed" : ""} ${
          longTermInfo ? "long-term" : ""
        }`}
        title={displayText}
        onMouseDown={keepTodoClickLocal}
        onClick={() => toggleTodo(todo.id)}
      >
        {longTermInfo && (
          <div className="todo-progress-segments" aria-hidden="true">
            {longTermInfo.progressSegments.map((segment) => (
              <span
                key={segment.date}
                className={`todo-progress-segment ${segment.status}`}
              />
            ))}
          </div>
        )}
        <div className="todo-checkbox" aria-hidden="true">
          {completed ? (
            <span className="todo-status-check">✓</span>
          ) : (
            <span className="todo-status-dot" />
          )}
        </div>
        <div className="todo-text">{displayText}</div>
        {timeLabel && <div className="todo-time">{timeLabel}</div>}
      </div>
    );
  };

  return (
    <div className="wallpaper-container" onMouseDown={startWindowDrag}>
      <div className="wallpaper-content" data-tauri-drag-region>
        <section className="widget-section jira-section" data-tauri-drag-region>
          <div className="widget-section-header" data-tauri-drag-region>
            <div>
              <h2 data-tauri-drag-region>Jira</h2>
              <span data-tauri-drag-region>
                {jiraConfig?.enabled
                  ? jiraSyncing
                    ? "同步中"
                    : jiraLastUpdated
                    ? `上次同步 ${jiraLastUpdated}`
                    : "等待同步"
                  : "未启用"}
              </span>
            </div>
            <div className="widget-section-tools">
              <button
                type="button"
                className="widget-sync-btn"
                disabled={jiraSyncing}
                title="手动同步 Jira"
                onMouseDown={keepTodoClickLocal}
                onClick={syncJiraNow}
              >
                ↻
              </button>
              <strong data-tauri-drag-region>{jiraIssues.length}</strong>
            </div>
          </div>
          <div className="widget-section-list jira-list">
            {jiraError ? (
              <div className="empty-message compact" title={jiraError}>
                Jira 同步失败
              </div>
            ) : jiraIssues.length === 0 ? (
              <div className="empty-message compact">
                {jiraConfig?.enabled ? "暂无未完成 Jira" : "在主窗口启用 Jira"}
              </div>
            ) : (
              jiraIssues.map((issue) => (
                <button
                  key={issue.key}
                  type="button"
                  className="jira-issue-item"
                  title={`${issue.key} ${issue.summary}`}
                  onMouseDown={keepTodoClickLocal}
                  onClick={() => openJiraIssue(issue.key)}
                >
                  <div className="jira-issue-main">
                    <span className="jira-issue-key">{issue.key}</span>
                    <span className="jira-issue-summary">{issue.summary}</span>
                  </div>
                  <div className="jira-issue-meta">
                    <span>{issue.status}</span>
                    {issue.priority && <span>{issue.priority}</span>}
                    {issue.issueType && <span>{issue.issueType}</span>}
                    {issue.dueDate && <span>截止 {issue.dueDate}</span>}
                    {issue.updated && <span>更新 {formatJiraDate(issue.updated)}</span>}
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="widget-section daily-section" data-tauri-drag-region>
          <div className="widget-section-header" data-tauri-drag-region>
            <div>
              <h2 data-tauri-drag-region>每日代办</h2>
              <span data-tauri-drag-region>{formatDate()}</span>
            </div>
            <strong data-tauri-drag-region>
              {dailyCompletedCount}/{dailyTodos.length}
            </strong>
          </div>
          <div className="widget-section-list">
            {dailyTodos.length === 0 ? (
              <div className="empty-message compact">今天没有每日代办</div>
            ) : (
              dailyTodos.map(renderLocalTodo)
            )}
          </div>
        </section>

        <section className="widget-section long-term-section" data-tauri-drag-region>
          <div className="widget-section-header" data-tauri-drag-region>
            <div>
              <h2 data-tauri-drag-region>长期代办</h2>
              <span data-tauri-drag-region>今日计划</span>
            </div>
            <strong data-tauri-drag-region>
              {longTermCompletedCount}/{longTermTodos.length}
            </strong>
          </div>
          <div className="widget-section-list">
            {longTermTodos.length === 0 ? (
              <div className="empty-message compact">今天没有长期代办</div>
            ) : (
              longTermTodos.map(renderLocalTodo)
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function formatShortTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(
    2,
    "0"
  )}`;
}

function formatJiraDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const month = date.getMonth() + 1;
  const day = date.getDate();
  const time = formatShortTime(date);
  return `${month}/${day} ${time}`;
}

export default Wallpaper;
