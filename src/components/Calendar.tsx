import { useEffect, useMemo, useState } from "react";
import { TodoItem } from "../types";
import {
  addDaysToDateString,
  getLocalDateString,
  getLongTermProgressStatusForDate,
  getLongTermTodoInfo,
  getTodosForDate,
  isLongTermTodo,
  isTodoCompletedOnDate,
  LongTermProgressStatus,
} from "../todoUtils";
import "./Calendar.css";

interface CalendarProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  todos: TodoItem[];
}

interface LongTermDaySummary {
  total: number;
  completed: number;
  missed: number;
  pending: number;
  status?: LongTermProgressStatus;
}

interface DetailLongTermTodo {
  todo: TodoItem;
  dayIndex: number;
  totalDays: number;
  stageNote: string;
  status: LongTermProgressStatus;
  progressSegments: Array<{
    date: string;
    status: LongTermProgressStatus;
  }>;
}

function Calendar({ selectedDate, onSelectDate, todos }: CalendarProps) {
  const [detailDate, setDetailDate] = useState(selectedDate);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const date = new Date(selectedDate + "T00:00:00");
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });

  useEffect(() => {
    setDetailDate(selectedDate);
  }, [selectedDate]);

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startWeekday = firstDay.getDay();

    return { daysInMonth, startWeekday, year, month };
  };

  const getTodoStatsForDate = (dateStr: string) => {
    const todosForDate = getTodosForDate(todos, dateStr);
    const completed = todosForDate.filter((t) => isTodoCompletedOnDate(t, dateStr)).length;
    return { total: todosForDate.length, completed };
  };

  const { daysInMonth, startWeekday, year, month } = getDaysInMonth(currentMonth);
  const today = getLocalDateString();
  const todayDate = new Date(`${today}T00:00:00`);
  const canGoNext =
    year < todayDate.getFullYear() ||
    (year === todayDate.getFullYear() && month < todayDate.getMonth());
  const longTermTodos = useMemo(
    () => todos.filter((todo) => isLongTermTodo(todo)),
    [todos]
  );

  const getLongTermSummaryForDate = (dateStr: string): LongTermDaySummary => {
    const statuses = longTermTodos
      .map((todo) => getLongTermProgressStatusForDate(todo, dateStr, today))
      .filter((status): status is LongTermProgressStatus => Boolean(status));

    const completed = statuses.filter((status) => status === "completed").length;
    const missed = statuses.filter((status) => status === "missed").length;
    const pending = statuses.filter((status) => status === "pending").length;
    const status =
      statuses.length === 0
        ? undefined
        : pending > 0
          ? "pending"
          : missed > 0
            ? "missed"
            : "completed";

    return {
      total: statuses.length,
      completed,
      missed,
      pending,
      status,
    };
  };

  const getDetailLongTermTodos = (dateStr: string): DetailLongTermTodo[] =>
    longTermTodos
      .map((todo) => {
        const info = getLongTermTodoInfo(todo, dateStr);
        const status = getLongTermProgressStatusForDate(todo, dateStr, today);
        if (!info || !status) {
          return undefined;
        }

        return {
          todo,
          dayIndex: info.dayIndex,
          totalDays: info.totalDays,
          stageNote: info.stageNote,
          status,
          progressSegments: buildLongTermProgressSegments(todo, today),
        };
      })
      .filter((item): item is DetailLongTermTodo => Boolean(item));

  const prevMonth = () => {
    setCurrentMonth(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    if (!canGoNext) {
      return;
    }

    setCurrentMonth(new Date(year, month + 1, 1));
  };

  const selectDate = (dateStr: string) => {
    setDetailDate(dateStr);
    onSelectDate(dateStr);
  };

  const renderDays = () => {
    const days = [];

    for (let i = 0; i < startWeekday; i++) {
      days.push(<div key={`empty-${i}`} className="calendar-day empty" />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const stats = getTodoStatsForDate(dateStr);
      const longTermSummary = getLongTermSummaryForDate(dateStr);
      const isSelected = dateStr === selectedDate;
      const isToday = dateStr === today;
      const isFuture = dateStr > today;

      days.push(
        <button
          key={day}
          type="button"
          className={`calendar-day ${isSelected ? "selected" : ""} ${isToday ? "today" : ""} ${
            isFuture ? "future" : ""
          }`}
          disabled={isFuture}
          onClick={() => selectDate(dateStr)}
        >
          <span className="day-number">{day}</span>
          {longTermSummary.status && (
            <>
              <span className={`long-term-summary-bar ${longTermSummary.status}`} />
              <span className="long-term-count">长{longTermSummary.total}</span>
            </>
          )}
          {stats.total > 0 && !longTermSummary.status && (
            <span className="day-indicator">
              <span
                className="dot"
                style={{
                  backgroundColor:
                    stats.completed === stats.total ? "#4caf50" : "#ff9800",
                }}
              />
            </span>
          )}
        </button>
      );
    }

    return days;
  };

  const detailStats = getTodoStatsForDate(detailDate);
  const detailLongTermTodos = getDetailLongTermTodos(detailDate);
  const detailSummary = getLongTermSummaryForDate(detailDate);

  return (
    <div className="calendar-overlay">
      <div className="calendar">
        <div className="calendar-header">
          <button type="button" onClick={prevMonth}>&lt;</button>
          <span className="calendar-month">
            {year}年{month + 1}月
          </span>
          <button type="button" onClick={nextMonth} disabled={!canGoNext}>&gt;</button>
        </div>
        <div className="calendar-weekdays">
          {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
            <div key={day} className="weekday">
              {day}
            </div>
          ))}
        </div>
        <div className="calendar-days">{renderDays()}</div>

        <div className="calendar-detail">
          <div className="calendar-detail-header">
            <div>
              <div className="calendar-detail-date">{detailDate}</div>
              <div className="calendar-detail-count">
                总待办 {detailStats.completed}/{detailStats.total}
              </div>
            </div>
            {detailSummary.status && (
              <span className={`calendar-detail-summary ${detailSummary.status}`}>
                长期 {detailSummary.completed}/{detailSummary.total}
              </span>
            )}
          </div>

          {detailLongTermTodos.length > 0 ? (
            <div className="calendar-detail-list">
              {detailLongTermTodos.map((item) => (
                <div key={item.todo.id} className="calendar-detail-item">
                  <div className="calendar-detail-title-row">
                    <span className="calendar-detail-title">{item.todo.text}</span>
                    <span className={`calendar-detail-status ${item.status}`}>
                      {getStatusLabel(item.status)}
                    </span>
                  </div>
                  <div className="calendar-detail-meta">
                    第 {item.dayIndex}/{item.totalDays} 天
                    {item.stageNote ? ` · ${item.stageNote}` : ""}
                  </div>
                  <div className="calendar-detail-progress" aria-hidden="true">
                    {item.progressSegments.map((segment) => (
                      <span
                        key={segment.date}
                        className={`calendar-detail-progress-piece ${segment.status}`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="calendar-detail-empty">当天没有长期任务</div>
          )}
        </div>
      </div>
    </div>
  );
}

function buildLongTermProgressSegments(
  todo: TodoItem,
  today: string
): Array<{ date: string; status: LongTermProgressStatus }> {
  const startDate = todo.startDate ?? todo.date;
  const endDate = todo.earlyCompletedDate ?? todo.endDate;
  if (!startDate || !endDate || startDate > endDate) {
    return [];
  }

  const segments: Array<{ date: string; status: LongTermProgressStatus }> = [];
  let cursor = startDate;

  while (cursor <= endDate) {
    segments.push({
      date: cursor,
      status: getLongTermProgressStatusForDate(todo, cursor, today) ?? "pending",
    });
    cursor = addDaysToDateString(cursor, 1);
  }

  return segments;
}

function getStatusLabel(status: LongTermProgressStatus): string {
  if (status === "completed") {
    return "已完成";
  }

  if (status === "missed") {
    return "未完成";
  }

  return "未结算";
}

export default Calendar;
