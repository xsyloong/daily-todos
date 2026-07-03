import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DataFileStatus,
  DataFileSwitchResult,
  JiraDiagnosticResult,
  JiraConfigView,
  JiraTestResult,
  TodoItem,
} from "./types";
import {
  getTodoTimeRange,
  parseTimeRange,
  uniqueRecentTimeRanges,
} from "./timeRanges";
import {
  getLocalDateString,
  getLongTermDisplayText,
  getTodosForDate,
  isLongTermTodo,
  isTodoCompletedOnDate,
  markLongTermTodoEarlyComplete,
  normalizeLongTermTodo,
  toggleTodoCompletionForDate,
} from "./todoUtils";
import Calendar from "./components/Calendar";
import TodoList, { TodoDraft } from "./components/TodoList";
import Header from "./components/Header";
import "./App.css";

const RECENT_TIME_RANGES_KEY = "daily-todo-app:recent-time-ranges";
const DEFAULT_JIRA_JQL =
  "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";

interface JiraConfigFormState {
  enabled: boolean;
  siteUrl: string;
  email: string;
  apiToken: string;
  apiTokenConfigured: boolean;
  refreshIntervalSeconds: string;
  maxIssues: string;
  jql: string;
  configPath: string;
}

function loadStoredRecentTimeRanges(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_TIME_RANGES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? uniqueRecentTimeRanges(parsed.filter((item): item is string => typeof item === "string"))
      : [];
  } catch (error) {
    console.error("加载最近使用时间段失败:", error);
    return [];
  }
}

function saveStoredRecentTimeRanges(timeRanges: string[]) {
  try {
    localStorage.setItem(RECENT_TIME_RANGES_KEY, JSON.stringify(timeRanges));
  } catch (error) {
    console.error("保存最近使用时间段失败:", error);
  }
}

function normalizeTodos(todos: TodoItem[]): TodoItem[] {
  return todos.map((todo) => normalizeLongTermTodo(todo));
}

function createJiraFormState(config?: JiraConfigView): JiraConfigFormState {
  return {
    enabled: config?.enabled ?? false,
    siteUrl: config?.siteUrl ?? "",
    email: config?.email ?? "",
    apiToken: "",
    apiTokenConfigured: config?.apiTokenConfigured ?? false,
    refreshIntervalSeconds: String(config?.refreshIntervalSeconds ?? 60),
    maxIssues: String(config?.maxIssues ?? 20),
    jql: config?.jql ?? DEFAULT_JIRA_JQL,
    configPath: config?.configPath ?? "",
  };
}

function App() {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(
    getLocalDateString()
  );
  const [showCalendar, setShowCalendar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [storedRecentTimeRanges, setStoredRecentTimeRanges] = useState<string[]>(
    () => loadStoredRecentTimeRanges()
  );
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(true);
  const [dataFileStatus, setDataFileStatus] = useState<DataFileStatus | undefined>();
  const [dataFileInput, setDataFileInput] = useState("");
  const [dataFileLoading, setDataFileLoading] = useState(false);
  const [jiraForm, setJiraForm] = useState<JiraConfigFormState>(() =>
    createJiraFormState()
  );
  const [jiraLoading, setJiraLoading] = useState(true);
  const [jiraSaving, setJiraSaving] = useState(false);
  const [jiraMessage, setJiraMessage] = useState("");
  const [jiraDiagnostic, setJiraDiagnostic] = useState<JiraDiagnosticResult | undefined>();

  const loadTodos = async () => {
    try {
      const loadedTodos = await invoke<TodoItem[]>("load_todos");
      setTodos(normalizeTodos(loadedTodos));
    } catch (error) {
      console.error("加载待办失败:", error);
    }
  };

  const loadDataFileStatus = async () => {
    try {
      const status = await invoke<DataFileStatus>("get_data_file_status");
      setDataFileStatus(status);
      setDataFileInput(status.dataFolderPath ?? "");
    } catch (error) {
      console.error("加载数据文件状态失败:", error);
    }
  };

  const loadJiraConfig = async () => {
    try {
      const config = await invoke<JiraConfigView>("load_jira_config");
      setJiraForm(createJiraFormState(config));
    } catch (error) {
      console.error("加载 Jira 配置失败:", error);
      setJiraMessage(`加载 Jira 配置失败: ${error}`);
    } finally {
      setJiraLoading(false);
    }
  };

  const saveTodos = async (newTodos: TodoItem[]) => {
    try {
      await invoke("save_todos", { todos: newTodos });
      setTodos(newTodos);
    } catch (error) {
      console.error("保存待办失败:", error);
    }
  };

  // 加载数据
  useEffect(() => {
    loadTodos();
    loadDataFileStatus();
    loadJiraConfig();
    loadAutostartStatus();
  }, []);

  const loadAutostartStatus = async () => {
    try {
      const enabled = await invoke<boolean>("is_autostart_enabled");
      setAutostartEnabled(enabled);
    } catch (error) {
      console.error("加载开机启动状态失败:", error);
    } finally {
      setAutostartLoading(false);
    }
  };

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
      const today = getLocalDateString(now);

      const updatedTodos = todos.map((todo) => {
        if (isLongTermTodo(todo)) {
          if (
            !getTodosForDate([todo], today).length ||
            isTodoCompletedOnDate(todo, today) ||
            todo.notifiedDates?.includes(today)
          ) {
            return todo;
          }

          const parsedTimeRange = parseTimeRange(todo.timeRange);
          if (parsedTimeRange?.start === currentTime) {
            invoke("show_notification", {
              title: "长期待办提醒",
              body: getLongTermDisplayText(todo, today),
            });
            return {
              ...todo,
              notifiedDates: Array.from(new Set([...(todo.notifiedDates ?? []), today])).sort(),
            };
          }

          return todo;
        }

        if (todo.date === today && !todo.completed && !todo.notified) {
          let shouldNotify = false;

          const timeRange = getTodoTimeRange(todo);
          const parsedTimeRange = parseTimeRange(timeRange);
          if (parsedTimeRange?.start === currentTime) {
            shouldNotify = true;
          } else if (!parsedTimeRange && todo.timeSlot === "custom" && todo.customTime === currentTime) {
            shouldNotify = true;
          }

          if (shouldNotify) {
            invoke("show_notification", {
              title: "待办提醒",
              body: todo.text,
            });
            return { ...todo, notified: true };
          }
        }
        return todo;
      });

      if (JSON.stringify(updatedTodos) !== JSON.stringify(todos)) {
        saveTodos(updatedTodos);
      }
    }, 60000);
    return () => window.clearInterval(interval);
  }, [todos]);

  const recentTimeRanges = useMemo(() => {
    const todoTimeRanges = todos
      .slice()
      .reverse()
      .map((todo) => todo.timeRange);
    return uniqueRecentTimeRanges([...storedRecentTimeRanges, ...todoTimeRanges], 5);
  }, [storedRecentTimeRanges, todos]);

  const rememberTimeRange = (timeRange?: string) => {
    const nextRecentTimeRanges = uniqueRecentTimeRanges(
      [timeRange, ...storedRecentTimeRanges],
      5
    );

    if (nextRecentTimeRanges.length > 0) {
      setStoredRecentTimeRanges(nextRecentTimeRanges);
      saveStoredRecentTimeRanges(nextRecentTimeRanges);
    }
  };

  const createTodoFromDraft = (draft: TodoDraft, existing?: TodoItem): TodoItem => {
    const parsedTimeRange = parseTimeRange(draft.timeRange);
    const normalizedTimeRange = parsedTimeRange
      ? `${parsedTimeRange.start}-${parsedTimeRange.end}`
      : undefined;

    if (draft.type === "longTerm") {
      return normalizeLongTermTodo({
        ...existing,
        id: existing?.id ?? Date.now().toString(),
        type: "longTerm",
        text: draft.text,
        completed: false,
        date: draft.startDate ?? draft.date,
        startDate: draft.startDate,
        endDate: draft.endDate,
        timeRange: normalizedTimeRange,
        stages: draft.stages ?? [],
        completedDates: existing?.completedDates ?? [],
        notifiedDates: existing?.notifiedDates ?? [],
        earlyCompletedDate: existing?.earlyCompletedDate,
        earlyCompletedNote: existing?.earlyCompletedNote,
        notified: false,
      });
    }

    return {
      ...existing,
      id: existing?.id ?? Date.now().toString(),
      type: "normal",
      text: draft.text,
      completed: existing?.completed ?? false,
      date: draft.date,
      timeRange: normalizedTimeRange,
      startDate: undefined,
      endDate: undefined,
      stages: undefined,
      completedDates: undefined,
      notifiedDates: undefined,
      earlyCompletedDate: undefined,
      earlyCompletedNote: undefined,
      notified: false,
    };
  };

  const addTodo = (draft: TodoDraft) => {
    const newTodo = createTodoFromDraft(draft);
    saveTodos([...todos, newTodo]);
    rememberTimeRange(newTodo.timeRange);
  };

  const updateTodo = (id: string, draft: TodoDraft) => {
    let updatedTimeRange: string | undefined;
    const updatedTodos = todos.map((todo) => {
      if (todo.id !== id) {
        return todo;
      }

      const updatedTodo = createTodoFromDraft(draft, todo);
      updatedTimeRange = updatedTodo.timeRange;
      return updatedTodo;
    });
    saveTodos(updatedTodos);
    rememberTimeRange(updatedTimeRange);
  };

  const toggleTodo = (id: string) => {
    const updatedTodos = todos.map((todo) =>
      todo.id === id ? toggleTodoCompletionForDate(todo, selectedDate) : todo
    );
    saveTodos(updatedTodos);
  };

  const deleteTodo = (id: string) => {
    saveTodos(todos.filter((todo) => todo.id !== id));
  };

  const earlyCompleteTodo = (id: string, note: string) => {
    const updatedTodos = todos.map((todo) =>
      todo.id === id && isLongTermTodo(todo)
        ? markLongTermTodoEarlyComplete(todo, selectedDate, note)
        : todo
    );
    saveTodos(updatedTodos);
  };

  const toggleWidget = async () => {
    try {
      await invoke("toggle_widget_mode");
      console.log("切换小组件模式成功");
    } catch (error) {
      console.error("切换小组件模式失败:", error);
      alert(`切换小组件模式失败: ${error}`);
    }
  };

  const toggleAutostart = async () => {
    const nextEnabled = !autostartEnabled;
    setAutostartLoading(true);
    try {
      const enabled = await invoke<boolean>("set_autostart_enabled", {
        enabled: nextEnabled,
      });
      setAutostartEnabled(enabled);
    } catch (error) {
      console.error("设置开机启动失败:", error);
      alert(`设置开机启动失败: ${error}`);
    } finally {
      setAutostartLoading(false);
    }
  };

  const applyDataFileResult = (result: DataFileSwitchResult) => {
    setTodos(normalizeTodos(result.todos));
    setDataFileStatus(result.status);
    setDataFileInput(result.status.dataFolderPath ?? "");
  };

  const useDataFile = async () => {
    const path = dataFileInput.trim();
    if (!path) {
      alert("请输入数据文件夹路径");
      return;
    }

    setDataFileLoading(true);
    try {
      const result = await invoke<DataFileSwitchResult>("set_data_folder_path", {
        path,
        currentTodos: todos,
      });
      applyDataFileResult(result);
    } catch (error) {
      console.error("设置数据文件失败:", error);
      alert(`设置数据文件失败: ${error}`);
    } finally {
      setDataFileLoading(false);
    }
  };

  const reloadDataFile = async () => {
    setDataFileLoading(true);
    try {
      const result = await invoke<DataFileSwitchResult>("reload_todos_from_file");
      applyDataFileResult(result);
    } catch (error) {
      console.error("重新加载数据文件失败:", error);
      alert(`重新加载数据文件失败: ${error}`);
    } finally {
      setDataFileLoading(false);
    }
  };

  const resetDataFile = async () => {
    const shouldReset = window.confirm(
      "恢复默认位置会把当前待办保存到默认本地数据文件，是否继续？"
    );
    if (!shouldReset) {
      return;
    }

    setDataFileLoading(true);
    try {
      const result = await invoke<DataFileSwitchResult>("reset_data_file_path", {
        currentTodos: todos,
      });
      applyDataFileResult(result);
    } catch (error) {
      console.error("恢复默认数据文件失败:", error);
      alert(`恢复默认数据文件失败: ${error}`);
    } finally {
      setDataFileLoading(false);
    }
  };

  const saveJiraConfig = async (shouldTest = false) => {
    setJiraSaving(true);
    setJiraMessage("");
    try {
      const savedConfig = await invoke<JiraConfigView>("save_jira_config", {
        input: {
          enabled: jiraForm.enabled,
          siteUrl: jiraForm.siteUrl,
          email: jiraForm.email,
          apiToken: jiraForm.apiToken || null,
          refreshIntervalSeconds: Number(jiraForm.refreshIntervalSeconds) || 60,
          maxIssues: Number(jiraForm.maxIssues) || 20,
          jql: jiraForm.jql,
        },
      });
      setJiraForm(createJiraFormState(savedConfig));

      if (shouldTest) {
        const result = await invoke<JiraTestResult>("test_jira_connection");
        const countText = result.hasMore
          ? `当前返回 ${result.issueCount} 条，还有更多结果未展示`
          : `当前返回 ${result.issueCount} 条`;
        const warningText =
          result.warnings.length > 0 ? `；Jira 警告：${result.warnings.join("；")}` : "";
        setJiraMessage(
          result.issueCount === 0
            ? `${result.message}，${countText}。若 Jira 页面里有未完成任务，请检查邮箱是否是同一个 Atlassian 账号，或临时把 JQL 改为 assignee = currentUser() ORDER BY updated DESC 测试。${warningText}`
            : `${result.message}，${countText}${warningText}`
        );
      } else {
        setJiraMessage("Jira 配置已保存");
      }
      return true;
    } catch (error) {
      console.error("保存 Jira 配置失败:", error);
      setJiraMessage(`Jira 配置失败: ${error}`);
      return false;
    } finally {
      setJiraSaving(false);
    }
  };

  const diagnoseJiraConfig = async () => {
    setJiraSaving(true);
    setJiraMessage("");
    setJiraDiagnostic(undefined);
    try {
      const saved = await saveJiraConfig(false);
      if (!saved) {
        return;
      }
      const result = await invoke<JiraDiagnosticResult>("diagnose_jira_connection");
      setJiraDiagnostic(result);
      setJiraMessage("Jira 诊断完成");
    } catch (error) {
      console.error("Jira 诊断失败:", error);
      setJiraMessage(`Jira 诊断失败: ${error}`);
    } finally {
      setJiraSaving(false);
    }
  };

  const todosForSelectedDate = getTodosForDate(todos, selectedDate);
  const completedCount = todosForSelectedDate.filter((t) =>
    isTodoCompletedOnDate(t, selectedDate)
  ).length;
  const totalCount = todosForSelectedDate.length;

  return (
    <div className="app">
      <Header
        selectedDate={selectedDate}
        onToggleWidget={toggleWidget}
        onToggleCalendar={() => setShowCalendar(!showCalendar)}
        onOpenSettings={() => setShowSettings(true)}
      />

      {showSettings ? (
        <div className="settings-page">
          <div className="settings-page-header">
            <div>
              <h2>设置</h2>
              <p>Jira、数据文件和开机启动配置</p>
            </div>
            <button type="button" onClick={() => setShowSettings(false)}>
              返回
            </button>
          </div>

          <section className="settings-section">
            <div className="settings-section-title">
              <h3>Jira 只读展示</h3>
              <span>配置文件仅保存在本机应用数据目录</span>
            </div>
            <div className="jira-config-panel">
              <div className="jira-config-header">
                <label className="jira-enable-toggle">
                  <input
                    type="checkbox"
                    checked={jiraForm.enabled}
                    disabled={jiraLoading || jiraSaving}
                    onChange={(e) =>
                      setJiraForm((current) => ({
                        ...current,
                        enabled: e.target.checked,
                      }))
                    }
                  />
                  <span>启用 Jira 只读展示</span>
                </label>
                <span className="jira-token-status">
                  Token {jiraForm.apiTokenConfigured ? "已保存" : "未保存"}
                </span>
              </div>
              <div className="jira-config-grid">
                <input
                  type="text"
                  className="jira-config-input"
                  value={jiraForm.siteUrl}
                  disabled={jiraLoading || jiraSaving}
                  placeholder="https://your-domain.atlassian.net"
                  onChange={(e) =>
                    setJiraForm((current) => ({ ...current, siteUrl: e.target.value }))
                  }
                />
                <input
                  type="email"
                  className="jira-config-input"
                  value={jiraForm.email}
                  disabled={jiraLoading || jiraSaving}
                  placeholder="Jira 登录邮箱"
                  onChange={(e) =>
                    setJiraForm((current) => ({ ...current, email: e.target.value }))
                  }
                />
                <input
                  type="password"
                  className="jira-config-input"
                  value={jiraForm.apiToken}
                  disabled={jiraLoading || jiraSaving}
                  placeholder={jiraForm.apiTokenConfigured ? "留空保留已保存 Token" : "API Token"}
                  onChange={(e) =>
                    setJiraForm((current) => ({ ...current, apiToken: e.target.value }))
                  }
                />
                <input
                  type="number"
                  min={30}
                  max={3600}
                  className="jira-config-input compact"
                  value={jiraForm.refreshIntervalSeconds}
                  disabled={jiraLoading || jiraSaving}
                  title="刷新间隔秒数"
                  onChange={(e) =>
                    setJiraForm((current) => ({
                      ...current,
                      refreshIntervalSeconds: e.target.value,
                    }))
                  }
                />
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="jira-config-input compact"
                  value={jiraForm.maxIssues}
                  disabled={jiraLoading || jiraSaving}
                  title="最大展示数量"
                  onChange={(e) =>
                    setJiraForm((current) => ({ ...current, maxIssues: e.target.value }))
                  }
                />
              </div>
              <textarea
                className="jira-jql-input"
                value={jiraForm.jql}
                disabled={jiraLoading || jiraSaving}
                rows={3}
                onChange={(e) =>
                  setJiraForm((current) => ({ ...current, jql: e.target.value }))
                }
              />
              <div className="jira-config-actions">
                <span className="jira-config-path" title={jiraForm.configPath}>
                  {jiraForm.configPath || "Jira 配置读取中..."}
                </span>
                <button type="button" disabled={jiraLoading || jiraSaving} onClick={() => saveJiraConfig(false)}>
                  保存
                </button>
                <button type="button" disabled={jiraLoading || jiraSaving} onClick={() => saveJiraConfig(true)}>
                  测试连接
                </button>
                <button type="button" disabled={jiraLoading || jiraSaving} onClick={diagnoseJiraConfig}>
                  诊断
                </button>
              </div>
              {jiraMessage && <div className="jira-config-message">{jiraMessage}</div>}
              {jiraDiagnostic && (
                <div className="jira-diagnostic">
                  <div className="jira-diagnostic-user">
                    当前 token 用户：{jiraDiagnostic.displayName}
                    {jiraDiagnostic.emailAddress ? ` · ${jiraDiagnostic.emailAddress}` : ""}
                  </div>
                  <div className="jira-diagnostic-list">
                    {jiraDiagnostic.queries.map((query) => (
                      <div key={query.label} className="jira-diagnostic-row">
                        <div className="jira-diagnostic-label">{query.label}</div>
                        <div className="jira-diagnostic-count">
                          {query.error
                            ? "失败"
                            : `${query.issueCount ?? 0} 条${query.hasMore ? "+" : ""}`}
                        </div>
                        <div className="jira-diagnostic-jql" title={query.jql}>
                          {query.error ?? query.jql}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-title">
              <h3>数据文件</h3>
              <span>本地待办同步文件夹</span>
            </div>
            <div className="data-file-panel">
              <div className="data-file-summary">
                <span className="data-file-label">数据文件夹</span>
                <span
                  className="data-file-current"
                  title={dataFileStatus?.activeDataFilePath ?? ""}
                >
                  {dataFileStatus
                    ? dataFileStatus.usingDefaultDataFile
                      ? "默认本地"
                      : dataFileStatus.activeDataFilePath
                    : "读取中..."}
                </span>
              </div>
              <div className="data-file-controls">
                <input
                  type="text"
                  className="data-file-input"
                  value={dataFileInput}
                  disabled={dataFileLoading}
                  placeholder="例如 E:\\notes"
                  onChange={(e) => setDataFileInput(e.target.value)}
                />
                <button type="button" disabled={dataFileLoading} onClick={useDataFile}>
                  使用
                </button>
                <button type="button" disabled={dataFileLoading} onClick={reloadDataFile}>
                  重新加载
                </button>
                <button type="button" disabled={dataFileLoading} onClick={resetDataFile}>
                  恢复默认
                </button>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-title">
              <h3>系统</h3>
              <span>桌面应用行为</span>
            </div>
            <label className="startup-toggle">
              <span className="startup-text">开机启动</span>
              <input
                type="checkbox"
                checked={autostartEnabled}
                disabled={autostartLoading}
                onChange={toggleAutostart}
              />
              <span className="startup-switch" aria-hidden="true" />
            </label>
          </section>
        </div>
      ) : (
        <>
      {showCalendar && (
        <Calendar
          selectedDate={selectedDate}
          onSelectDate={(date) => {
            setSelectedDate(date);
          }}
          todos={todos}
        />
      )}

      <div className="progress-bar">
        <div className="progress-text">
          {completedCount} / {totalCount} 已完成
        </div>
        <div className="progress-fill" style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }} />
      </div>

      <TodoList
        todos={todosForSelectedDate}
        selectedDate={selectedDate}
        recentTimeRanges={recentTimeRanges}
        onAddTodo={addTodo}
        onUpdateTodo={updateTodo}
        onToggleTodo={toggleTodo}
        onDeleteTodo={deleteTodo}
        onEarlyCompleteTodo={earlyCompleteTodo}
      />
      </>
      )}
    </div>
  );
}

export default App;

