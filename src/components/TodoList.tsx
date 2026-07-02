import { useEffect, useMemo, useState } from "react";
import { LongTermStage, TodoItem, TodoType } from "../types";
import {
  createTimeRange,
  formatTimeRangeLabel,
  getTodoTimeLabel,
  parseTimeRange,
} from "../timeRanges";
import {
  getInclusiveDayCount,
  getLongTermDisplayText,
  getLongTermMetaText,
  getLongTermTodoInfo,
  isLongTermTodo,
  isTodoCompletedOnDate,
  validateStages,
} from "../todoUtils";
import "./TodoList.css";

export interface TodoDraft {
  type: TodoType;
  text: string;
  date: string;
  timeRange?: string;
  startDate?: string;
  endDate?: string;
  stages?: LongTermStage[];
}

interface TodoListProps {
  todos: TodoItem[];
  selectedDate: string;
  recentTimeRanges: string[];
  onAddTodo: (draft: TodoDraft) => void;
  onUpdateTodo: (id: string, draft: TodoDraft) => void;
  onToggleTodo: (id: string) => void;
  onDeleteTodo: (id: string) => void;
  onEarlyCompleteTodo: (id: string, note: string) => void;
}

interface TodoFormState {
  type: TodoType;
  text: string;
  startTime: string;
  endTime: string;
  startDate: string;
  endDate: string;
  stages: LongTermStage[];
}

const createStage = (
  startDay = 1,
  endDay = 1,
  note = ""
): LongTermStage => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  startDay,
  endDay,
  note,
});

function createEmptyFormState(selectedDate: string): TodoFormState {
  return {
    type: "normal",
    text: "",
    startTime: "",
    endTime: "",
    startDate: selectedDate,
    endDate: selectedDate,
    stages: [],
  };
}

function createFormStateFromTodo(todo: TodoItem, selectedDate: string): TodoFormState {
  const parsedTimeRange = parseTimeRange(todo.timeRange);
  const startDate = todo.startDate ?? todo.date ?? selectedDate;

  return {
    type: isLongTermTodo(todo) ? "longTerm" : "normal",
    text: todo.text,
    startTime: parsedTimeRange?.start ?? "",
    endTime: parsedTimeRange?.end ?? "",
    startDate,
    endDate: todo.endDate ?? startDate,
    stages: (todo.stages ?? []).map((stage) => ({ ...stage })),
  };
}

function TodoList({
  todos,
  selectedDate,
  recentTimeRanges,
  onAddTodo,
  onUpdateTodo,
  onToggleTodo,
  onDeleteTodo,
  onEarlyCompleteTodo,
}: TodoListProps) {
  const [formState, setFormState] = useState<TodoFormState>(() =>
    createEmptyFormState(selectedDate)
  );
  const [editingTodoId, setEditingTodoId] = useState<string | undefined>();
  const [openMenuTodoId, setOpenMenuTodoId] = useState<string | undefined>();

  useEffect(() => {
    if (!editingTodoId) {
      setFormState((current) => ({
        ...current,
        startDate: current.type === "longTerm" ? current.startDate : selectedDate,
        endDate: current.type === "longTerm" ? current.endDate : selectedDate,
      }));
    }
  }, [editingTodoId, selectedDate]);

  const selectedTimeRange = createTimeRange(formState.startTime, formState.endTime);
  const hasPartialTimeRange = Boolean(formState.startTime || formState.endTime);
  const longTermTotalDays = getInclusiveDayCount(formState.startDate, formState.endDate);
  const stageError =
    formState.type === "longTerm" && formState.stages.length > 0
      ? validateStages(formState.stages, longTermTotalDays)
      : undefined;
  const canSubmit =
    Boolean(formState.text.trim()) &&
    (formState.type === "normal"
      ? !hasPartialTimeRange || Boolean(selectedTimeRange)
      : Boolean(selectedTimeRange) && longTermTotalDays > 0 && !stageError);

  const dateError = useMemo(() => {
    if (formState.type !== "longTerm") {
      return "";
    }

    if (longTermTotalDays < 1) {
      return "结束日期不能早于开始日期";
    }

    return "";
  }, [formState.type, longTermTotalDays]);
  const timeError =
    formState.type === "longTerm" && !selectedTimeRange
      ? "长期待办必须设置有效时间段"
      : "";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      return;
    }

    const draft: TodoDraft = {
      type: formState.type,
      text: formState.text.trim(),
      date: formState.type === "longTerm" ? formState.startDate : selectedDate,
      timeRange: selectedTimeRange,
      startDate: formState.type === "longTerm" ? formState.startDate : undefined,
      endDate: formState.type === "longTerm" ? formState.endDate : undefined,
      stages:
        formState.type === "longTerm"
          ? formState.stages.map((stage) => ({
              ...stage,
              startDay: Math.trunc(stage.startDay),
              endDay: Math.trunc(stage.endDay),
              note: stage.note.trim(),
            }))
          : undefined,
    };

    if (editingTodoId) {
      onUpdateTodo(editingTodoId, draft);
    } else {
      onAddTodo(draft);
    }

    setFormState(createEmptyFormState(selectedDate));
    setEditingTodoId(undefined);
  };

  const applyRecentTimeRange = (timeRange: string) => {
    const parsed = parseTimeRange(timeRange);
    if (parsed) {
      setFormState((current) => ({
        ...current,
        startTime: parsed.start,
        endTime: parsed.end,
      }));
    }
  };

  const setType = (type: TodoType) => {
    setFormState((current) => ({
      ...current,
      type,
      startDate: type === "longTerm" ? current.startDate : selectedDate,
      endDate: type === "longTerm" ? current.endDate : selectedDate,
      stages: type === "longTerm" ? current.stages : [],
    }));
  };

  const updateStage = (
    id: string,
    patch: Partial<Pick<LongTermStage, "startDay" | "endDay" | "note">>
  ) => {
    setFormState((current) => ({
      ...current,
      stages: current.stages.map((stage) =>
        stage.id === id ? { ...stage, ...patch } : stage
      ),
    }));
  };

  const addStage = () => {
    const nextStartDay =
      formState.stages.length > 0
        ? Math.min(
            longTermTotalDays || 1,
            Math.max(...formState.stages.map((stage) => stage.endDay)) + 1
          )
        : 1;
    setFormState((current) => ({
      ...current,
      stages: [...current.stages, createStage(nextStartDay, nextStartDay)],
    }));
  };

  const removeStage = (id: string) => {
    setFormState((current) => ({
      ...current,
      stages: current.stages.filter((stage) => stage.id !== id),
    }));
  };

  const startEdit = (todo: TodoItem) => {
    setEditingTodoId(todo.id);
    setOpenMenuTodoId(undefined);
    setFormState(createFormStateFromTodo(todo, selectedDate));
  };

  const cancelEdit = () => {
    setEditingTodoId(undefined);
    setFormState(createEmptyFormState(selectedDate));
  };

  const earlyComplete = (todo: TodoItem) => {
    const note = window.prompt("提前完成备注", "提前完成");
    if (note !== null) {
      onEarlyCompleteTodo(todo.id, note);
      setOpenMenuTodoId(undefined);
    }
  };

  return (
    <div className="todo-list-container">
      <form className="todo-input-form" onSubmit={handleSubmit}>
        <div className="todo-type-toggle" aria-label="待办类型">
          <button
            type="button"
            className={`type-btn ${formState.type === "normal" ? "active" : ""}`}
            onClick={() => setType("normal")}
          >
            普通待办
          </button>
          <button
            type="button"
            className={`type-btn ${formState.type === "longTerm" ? "active" : ""}`}
            onClick={() => setType("longTerm")}
          >
            长期待办
          </button>
        </div>

        <input
          type="text"
          className="todo-input"
          placeholder={formState.type === "longTerm" ? "长期计划名称..." : "添加新的待办事项..."}
          value={formState.text}
          onChange={(e) =>
            setFormState((current) => ({ ...current, text: e.target.value }))
          }
        />

        {formState.type === "longTerm" && (
          <div className="date-range-row">
            <label className="date-range-field">
              <span>开始</span>
              <input
                type="date"
                value={formState.startDate}
                onChange={(e) =>
                  setFormState((current) => ({
                    ...current,
                    startDate: e.target.value,
                    endDate:
                      current.endDate < e.target.value ? e.target.value : current.endDate,
                  }))
                }
              />
            </label>
            <span className="time-range-separator">至</span>
            <label className="date-range-field">
              <span>结束</span>
              <input
                type="date"
                value={formState.endDate}
                min={formState.startDate}
                onChange={(e) =>
                  setFormState((current) => ({
                    ...current,
                    endDate: e.target.value,
                  }))
                }
              />
            </label>
          </div>
        )}

        <div className="time-range-row">
          <label className="time-range-field">
            <span>开始</span>
            <input
              type="time"
              className="time-range-input"
              value={formState.startTime}
              onChange={(e) =>
                setFormState((current) => ({ ...current, startTime: e.target.value }))
              }
            />
          </label>
          <span className="time-range-separator">至</span>
          <label className="time-range-field">
            <span>结束</span>
            <input
              type="time"
              className="time-range-input"
              value={formState.endTime}
              min={formState.startTime || undefined}
              onChange={(e) =>
                setFormState((current) => ({ ...current, endTime: e.target.value }))
              }
            />
          </label>
        </div>

        {recentTimeRanges.length > 0 && (
          <div className="recent-time-ranges" aria-label="最近使用的时间段">
            {recentTimeRanges.map((timeRange) => (
              <button
                key={timeRange}
                type="button"
                className={`time-btn ${selectedTimeRange === timeRange ? "active" : ""}`}
                onClick={() => applyRecentTimeRange(timeRange)}
              >
                {formatTimeRangeLabel(timeRange)}
              </button>
            ))}
          </div>
        )}

        {formState.type === "longTerm" && (
          <div className="stage-editor">
            <div className="stage-editor-header">
              <span>阶段任务</span>
              <span>{longTermTotalDays > 0 ? `共 ${longTermTotalDays} 天` : ""}</span>
            </div>
            {formState.stages.map((stage) => (
              <div key={stage.id} className="stage-row">
                <label>
                  第
                  <input
                    type="number"
                    min={1}
                    max={longTermTotalDays || undefined}
                    value={stage.startDay}
                    onChange={(e) =>
                      updateStage(stage.id, { startDay: Number(e.target.value) })
                    }
                  />
                  天
                </label>
                <label>
                  到
                  <input
                    type="number"
                    min={1}
                    max={longTermTotalDays || undefined}
                    value={stage.endDay}
                    onChange={(e) =>
                      updateStage(stage.id, { endDay: Number(e.target.value) })
                    }
                  />
                  天
                </label>
                <input
                  type="text"
                  className="stage-note-input"
                  placeholder="阶段备注"
                  value={stage.note}
                  onChange={(e) => updateStage(stage.id, { note: e.target.value })}
                />
                <button
                  type="button"
                  className="stage-remove-btn"
                  onClick={() => removeStage(stage.id)}
                  title="删除阶段"
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="stage-add-btn" onClick={addStage}>
              + 添加阶段
            </button>
          </div>
        )}

        {(timeError || dateError || stageError) && (
          <div className="form-error">{timeError || dateError || stageError}</div>
        )}

        <div className="form-actions">
          {editingTodoId && (
            <button type="button" className="cancel-btn" onClick={cancelEdit}>
              取消
            </button>
          )}
          <button type="submit" className="add-btn" disabled={!canSubmit}>
            {editingTodoId ? "保存修改" : "+ 添加"}
          </button>
        </div>
      </form>

      <div className="todo-list">
        {todos.length === 0 ? (
          <div className="empty-state">
            <p>暂无待办事项</p>
            <p className="empty-hint">添加一个新的待办开始你的一天 ✨</p>
          </div>
        ) : (
          todos.map((todo) => {
            const completed = isTodoCompletedOnDate(todo, selectedDate);
            const timeLabel = getTodoTimeLabel(todo);
            const longTermInfo = getLongTermTodoInfo(todo, selectedDate);
            const isLongTerm = Boolean(longTermInfo);
            const metaText = getLongTermMetaText(todo, selectedDate);

            return (
              <div
                key={todo.id}
                className={`todo-item ${completed ? "completed" : ""} ${
                  isLongTerm ? "long-term" : ""
                } ${longTermInfo?.earlyCompletedToday ? "early-completed" : ""}`}
              >
                {longTermInfo && (
                  <div className="long-term-progress-track" aria-hidden="true">
                    {longTermInfo.progressSegments.map((segment) => (
                      <span
                        key={segment.date}
                        className={`long-term-progress-segment ${segment.status}`}
                        title={`第 ${segment.dayIndex} 天`}
                      />
                    ))}
                  </div>
                )}
                <input
                  type="checkbox"
                  className="todo-checkbox"
                  checked={completed}
                  onChange={() => onToggleTodo(todo.id)}
                />
                <div className="todo-content">
                  <span className="todo-text">
                    {isLongTerm ? getLongTermDisplayText(todo, selectedDate) : todo.text}
                  </span>
                  <div className="todo-meta-row">
                    {timeLabel && <span className="todo-time">{timeLabel}</span>}
                    {metaText && <span className="todo-plan-meta">{metaText}</span>}
                  </div>
                </div>
                {isLongTerm ? (
                  <div className="todo-menu-wrap">
                    <button
                      type="button"
                      className="more-btn"
                      onClick={() =>
                        setOpenMenuTodoId(openMenuTodoId === todo.id ? undefined : todo.id)
                      }
                      title="更多"
                    >
                      ⋯
                    </button>
                    {openMenuTodoId === todo.id && (
                      <div className="todo-menu">
                        <button type="button" onClick={() => startEdit(todo)}>
                          编辑
                        </button>
                        <button type="button" onClick={() => earlyComplete(todo)}>
                          提前完成
                        </button>
                        <button type="button" onClick={() => onDeleteTodo(todo.id)}>
                          删除
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    className="delete-btn"
                    onClick={() => onDeleteTodo(todo.id)}
                    title="删除"
                  >
                    🗑️
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default TodoList;
