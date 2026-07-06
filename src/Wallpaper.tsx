import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeAppLog } from "./logging";
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

type WidgetSectionKey = "jira" | "daily" | "longTerm";

type WidgetSectionCollapsedState = Record<WidgetSectionKey, boolean>;

const WIDGET_SECTION_COLLAPSED_KEY = "daily-todo-app:widget-section-collapsed";
const WIDGET_RESIZE_ANIMATION_MS = 360;

const DEFAULT_COLLAPSED_STATE: WidgetSectionCollapsedState = {
  jira: false,
  daily: false,
  longTerm: false,
};

const WIDGET_WINDOW_SECTION_BY_LABEL: Record<string, WidgetSectionKey> = {
  "widget-jira": "jira",
  "widget-daily": "daily",
  "widget-long-term": "longTerm",
};

function getWidgetSectionFromWindowLabel(label: string): WidgetSectionKey {
  return WIDGET_WINDOW_SECTION_BY_LABEL[label] ?? "jira";
}

function loadCollapsedState(): WidgetSectionCollapsedState {
  try {
    const raw = localStorage.getItem(WIDGET_SECTION_COLLAPSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_COLLAPSED_STATE;
    }

    const value = parsed as Partial<Record<WidgetSectionKey, unknown>>;
    return {
      jira: value.jira === true,
      daily: value.daily === true,
      longTerm: value.longTerm === true,
    };
  } catch (error) {
    console.error("加载小组件折叠状态失败:", error);
    return DEFAULT_COLLAPSED_STATE;
  }
}

function saveCollapsedState(state: WidgetSectionCollapsedState) {
  try {
    localStorage.setItem(WIDGET_SECTION_COLLAPSED_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("保存小组件折叠状态失败:", error);
  }
}

function Wallpaper() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const widgetSection = useMemo(
    () => getWidgetSectionFromWindowLabel(currentWindow.label),
    [currentWindow]
  );
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [jiraConfig, setJiraConfig] = useState<JiraConfigView | undefined>();
  const [jiraIssues, setJiraIssues] = useState<JiraIssue[]>([]);
  const [jiraError, setJiraError] = useState("");
  const [jiraLastUpdated, setJiraLastUpdated] = useState("");
  const [jiraRefreshIntervalSeconds, setJiraRefreshIntervalSeconds] = useState(60);
  const [jiraSyncing, setJiraSyncing] = useState(false);
  const [currentDate, setCurrentDate] = useState<string>(getLocalDateString());
  const [collapsedSections, setCollapsedSections] =
    useState<WidgetSectionCollapsedState>(() => loadCollapsedState());
  const [manualSized, setManualSized] = useState(false);
  const todosRef = useRef<TodoItem[]>([]);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const isJiraWindow = widgetSection === "jira";
  const isDailyWindow = widgetSection === "daily";
  const isLongTermWindow = widgetSection === "longTerm";
  const usesLocalTodos = isDailyWindow || isLongTermWindow;

  useEffect(() => {
    writeAppLog(
      "INFO",
      `Wallpaper mounted label=${currentWindow.label} section=${widgetSection}`
    );
  }, [currentWindow.label, widgetSection]);

  const loadTodos = useCallback(async () => {
    try {
      const loadedTodos = await invoke<TodoItem[]>("load_todos");
      const normalizedTodos = loadedTodos.map((todo) => normalizeLongTermTodo(todo));
      todosRef.current = normalizedTodos;
      setTodos(normalizedTodos);
    } catch (error) {
      console.error("加载待办失败:", error);
      writeAppLog("ERROR", `loadTodos failed label=${currentWindow.label} error=${error}`);
    }
  }, [currentWindow.label]);

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
      writeAppLog(
        "ERROR",
        `loadJiraIssues failed label=${currentWindow.label} error=${error}`
      );
      setJiraError(String(error));
    } finally {
      setJiraSyncing(false);
    }
  }, [currentWindow.label]);

  useEffect(() => {
    if (!usesLocalTodos) {
      return;
    }

    void loadTodos();
    const interval = setInterval(() => void loadTodos(), 5000);
    return () => clearInterval(interval);
  }, [loadTodos, usesLocalTodos]);

  useEffect(() => {
    if (!isJiraWindow) {
      return;
    }

    void loadJiraIssues();
    const interval = setInterval(
      () => void loadJiraIssues(),
      Math.max(30, jiraRefreshIntervalSeconds) * 1000
    );
    return () => clearInterval(interval);
  }, [isJiraWindow, jiraRefreshIntervalSeconds, loadJiraIssues]);

  useEffect(() => {
    const interval = setInterval(() => setCurrentDate(getLocalDateString()), 60000);
    return () => clearInterval(interval);
  }, []);

  const toggleTodo = useCallback(
    async (id: string) => {
      try {
        const latestTodos = await invoke<TodoItem[]>("load_todos");
        const normalizedTodos = latestTodos.map((todo) => normalizeLongTermTodo(todo));
        const updatedTodos = normalizedTodos.map((todo) =>
          todo.id === id ? toggleTodoCompletionForDate(todo, currentDate) : todo
        );

        todosRef.current = updatedTodos;
        setTodos(updatedTodos);

        await invoke("save_todos", { todos: updatedTodos });
      } catch (error) {
        console.error("更新待办失败:", error);
        writeAppLog("ERROR", `toggleTodo failed label=${currentWindow.label} error=${error}`);
        void loadTodos();
      }
    },
    [currentDate, currentWindow.label, loadTodos]
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
  const jiraIncompleteCount = jiraIssues.length;
  const dailyIncompleteCount = dailyTodos.length - dailyCompletedCount;
  const longTermIncompleteCount = longTermTodos.length - longTermCompletedCount;

  const resizeWidgetToContent = useCallback(() => {
    const content = contentRef.current;
    if (!content || manualSized) {
      return;
    }

    const height = Math.ceil(content.getBoundingClientRect().height);
    void invoke("resize_widget_window", {
      label: currentWindow.label,
      height,
    }).catch((error) => {
      console.error("调整小组件窗口大小失败:", error);
      writeAppLog(
        "ERROR",
        `resize_widget_window failed label=${currentWindow.label} error=${error}`
      );
    });
  }, [currentWindow.label, manualSized]);

  useLayoutEffect(() => {
    const startTimerId = window.setTimeout(resizeWidgetToContent, 500);
    const midTimerId = window.setTimeout(
      resizeWidgetToContent,
      500 + WIDGET_RESIZE_ANIMATION_MS / 2
    );
    const endTimerId = window.setTimeout(
      resizeWidgetToContent,
      500 + WIDGET_RESIZE_ANIMATION_MS
    );

    return () => {
      window.clearTimeout(startTimerId);
      window.clearTimeout(midTimerId);
      window.clearTimeout(endTimerId);
    };
  }, [
    collapsedSections,
    currentDate,
    dailyCompletedCount,
    dailyTodos.length,
    jiraConfig?.enabled,
    jiraError,
    jiraIssues.length,
    longTermCompletedCount,
    longTermTodos.length,
    resizeWidgetToContent,
  ]);

  const startWindowDrag = useCallback((event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    void currentWindow.startDragging().catch((error) => {
      console.error("拖动小组件失败:", error);
      writeAppLog("ERROR", `startDragging failed label=${currentWindow.label} error=${error}`);
    });
  }, [currentWindow]);

  const startWindowResize = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setManualSized(true);
    void currentWindow.startResizeDragging("NorthWest").catch((error) => {
      console.error("调整小组件窗口大小失败:", error);
      writeAppLog(
        "ERROR",
        `startResizeDragging failed label=${currentWindow.label} error=${error}`
      );
    });
  }, [currentWindow]);

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
      event.preventDefault();
      event.stopPropagation();
      void loadJiraIssues();
    },
    [loadJiraIssues]
  );

  const toggleSection = useCallback(
    (section: WidgetSectionKey) => (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setManualSized(false);
      setCollapsedSections((current) => {
        const next = {
          ...current,
          [section]: !current[section],
        };
        saveCollapsedState(next);
        return next;
      });
    },
    []
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
    <div className={`wallpaper-container ${manualSized ? "manual-sized" : ""}`}>
      <div ref={contentRef} className="wallpaper-content" data-tauri-drag-region>
        {isJiraWindow && (
          <section
            className={`widget-section jira-section ${
              collapsedSections.jira ? "collapsed" : ""
            }`}
            data-tauri-drag-region
          >
            <div
              className="widget-resize-grip"
              title="调整 Jira 窗口大小"
              onMouseDown={startWindowResize}
            />
            <div
              className="widget-section-header"
              data-tauri-drag-region
              onMouseDown={startWindowDrag}
            >
              <div>
                <h2 data-tauri-drag-region>Jira</h2>
                <span className="widget-section-meta" data-tauri-drag-region>
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
                {!collapsedSections.jira && (
                  <button
                    type="button"
                    className="widget-tool-btn"
                    disabled={jiraSyncing}
                    title="手动同步 Jira"
                    onMouseDown={keepTodoClickLocal}
                    onClick={syncJiraNow}
                  >
                    ↻
                  </button>
                )}
                <button
                  type="button"
                  className="widget-tool-btn"
                  title={collapsedSections.jira ? "展开 Jira" : "收起 Jira"}
                  onMouseDown={keepTodoClickLocal}
                  onClick={toggleSection("jira")}
                >
                  {collapsedSections.jira ? "+" : "−"}
                </button>
                <strong data-tauri-drag-region>未完成 {jiraIncompleteCount}</strong>
              </div>
            </div>
            <div
              className="widget-section-list jira-list"
              aria-hidden={collapsedSections.jira}
            >
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
                      {issue.updated && (
                        <span>更新 {formatJiraDate(issue.updated)}</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>
        )}

        {isDailyWindow && (
          <section
            className={`widget-section daily-section ${
              collapsedSections.daily ? "collapsed" : ""
            }`}
            data-tauri-drag-region
          >
            <div
              className="widget-resize-grip"
              title="调整每日代办窗口大小"
              onMouseDown={startWindowResize}
            />
            <div
              className="widget-section-header"
              data-tauri-drag-region
              onMouseDown={startWindowDrag}
            >
              <div>
                <h2 data-tauri-drag-region>每日代办</h2>
                <span className="widget-section-meta" data-tauri-drag-region>
                  {formatDate()}
                </span>
              </div>
              <div className="widget-section-tools">
                <button
                  type="button"
                  className="widget-tool-btn"
                  title={collapsedSections.daily ? "展开每日代办" : "收起每日代办"}
                  onMouseDown={keepTodoClickLocal}
                  onClick={toggleSection("daily")}
                >
                  {collapsedSections.daily ? "+" : "−"}
                </button>
                <strong data-tauri-drag-region>未完成 {dailyIncompleteCount}</strong>
              </div>
            </div>
            <div
              className="widget-section-list"
              aria-hidden={collapsedSections.daily}
            >
              {dailyTodos.length === 0 ? (
                <div className="empty-message compact">今天没有每日代办</div>
              ) : (
                dailyTodos.map(renderLocalTodo)
              )}
            </div>
          </section>
        )}

        {isLongTermWindow && (
          <section
            className={`widget-section long-term-section ${
              collapsedSections.longTerm ? "collapsed" : ""
            }`}
            data-tauri-drag-region
          >
            <div
              className="widget-resize-grip"
              title="调整长期代办窗口大小"
              onMouseDown={startWindowResize}
            />
            <div
              className="widget-section-header"
              data-tauri-drag-region
              onMouseDown={startWindowDrag}
            >
              <div>
                <h2 data-tauri-drag-region>长期代办</h2>
                <span className="widget-section-meta" data-tauri-drag-region>
                  今日计划
                </span>
              </div>
              <div className="widget-section-tools">
                <button
                  type="button"
                  className="widget-tool-btn"
                  title={
                    collapsedSections.longTerm ? "展开长期代办" : "收起长期代办"
                  }
                  onMouseDown={keepTodoClickLocal}
                  onClick={toggleSection("longTerm")}
                >
                  {collapsedSections.longTerm ? "+" : "−"}
                </button>
                <strong data-tauri-drag-region>
                  未完成 {longTermIncompleteCount}
                </strong>
              </div>
            </div>
            <div
              className="widget-section-list"
              aria-hidden={collapsedSections.longTerm}
            >
              {longTermTodos.length === 0 ? (
                <div className="empty-message compact">今天没有长期代办</div>
              ) : (
                longTermTodos.map(renderLocalTodo)
              )}
            </div>
          </section>
        )}
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
