import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TodoItem } from "./types";
import { getTodoTimeLabel } from "./timeRanges";
import {
  getLocalDateString,
  getLongTermDisplayText,
  getLongTermTodoInfo,
  getTodosForDate,
  isTodoCompletedOnDate,
  normalizeLongTermTodo,
  toggleTodoCompletionForDate,
} from "./todoUtils";
import "./Wallpaper.css";

function Wallpaper() {
  const [todos, setTodos] = useState<TodoItem[]>([]);
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

  useEffect(() => {
    void loadTodos();
    const interval = setInterval(() => void loadTodos(), 5000);
    return () => clearInterval(interval);
  }, [loadTodos]);

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
  const completedCount = todayTodos.filter((todo) =>
    isTodoCompletedOnDate(todo, currentDate)
  ).length;
  const totalCount = todayTodos.length;

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

  const formatDate = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const weekday = weekdays[date.getDay()];
    return `${year}年${month}月${day}日 ${weekday}`;
  };

  return (
    <div className="wallpaper-container" onMouseDown={startWindowDrag}>
      <div className="wallpaper-content" data-tauri-drag-region>
        <div className="wallpaper-header" data-tauri-drag-region>
          <h1 className="wallpaper-title" data-tauri-drag-region>今日待办</h1>
          <div className="wallpaper-date" data-tauri-drag-region>{formatDate()}</div>
          <div className="wallpaper-progress" data-tauri-drag-region>
            <span className="progress-text">
              {completedCount} / {totalCount}
            </span>
            <div className="progress-bar-bg">
              <div
                className="progress-bar-fill"
                style={{
                  width: totalCount > 0 ? `${(completedCount / totalCount) * 100}%` : "0%",
                }}
              />
            </div>
          </div>
        </div>

        <div className="wallpaper-todos">
          {todayTodos.length === 0 ? (
            <div className="empty-message">今天没有待办事项 ✨</div>
          ) : (
            todayTodos.map((todo) => {
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
            })
          )}
        </div>

        <div
          className="wallpaper-footer"
          data-tauri-drag-region
        >
          左键托盘图标打开编辑窗口
        </div>
      </div>
    </div>
  );
}

export default Wallpaper;
