import type { LongTermStage, TodoItem } from "./types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LongTermTodoInfo {
  startDate: string;
  endDate: string;
  totalDays: number;
  dayIndex: number;
  progressPercent: number;
  progressSegments: LongTermProgressSegment[];
  stage?: LongTermStage;
  stageNote: string;
  earlyCompletedToday: boolean;
}

export type LongTermProgressStatus = "completed" | "missed" | "pending";

export interface LongTermProgressSegment {
  date: string;
  dayIndex: number;
  status: LongTermProgressStatus;
}

export function getLocalDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isLongTermTodo(todo: TodoItem): boolean {
  return todo.type === "longTerm";
}

export function getTodosForDate(todos: TodoItem[], date: string): TodoItem[] {
  return todos.filter((todo) => isTodoVisibleOnDate(todo, date));
}

export function isTodoVisibleOnDate(todo: TodoItem, date: string): boolean {
  if (!isLongTermTodo(todo)) {
    return todo.date === date;
  }

  return Boolean(getLongTermTodoInfo(todo, date));
}

export function isTodoCompletedOnDate(todo: TodoItem, date: string): boolean {
  if (!isLongTermTodo(todo)) {
    return todo.completed;
  }

  return Boolean(todo.completedDates?.includes(date));
}

export function getLongTermTodoInfo(
  todo: TodoItem,
  date: string
): LongTermTodoInfo | undefined {
  if (!isLongTermTodo(todo)) {
    return undefined;
  }

  const startDate = getLongTermStartDate(todo);
  const endDate = todo.endDate;
  if (!startDate || !endDate || !isValidDateString(date)) {
    return undefined;
  }

  if (date < startDate || date > endDate) {
    return undefined;
  }

  if (todo.earlyCompletedDate && date > todo.earlyCompletedDate) {
    return undefined;
  }

  const totalDays = getInclusiveDayCount(startDate, endDate);
  const dayIndex = getInclusiveDayCount(startDate, date);
  if (totalDays < 1 || dayIndex < 1 || dayIndex > totalDays) {
    return undefined;
  }

  const stage = getStageForDay(todo.stages ?? [], dayIndex);
  return {
    startDate,
    endDate,
    totalDays,
    dayIndex,
    progressPercent: Math.min(100, Math.max(0, ((dayIndex - 1) / totalDays) * 100)),
    progressSegments: getLongTermProgressSegments(todo, startDate, date, totalDays),
    stage,
    stageNote: stage?.note.trim() ?? "",
    earlyCompletedToday: todo.earlyCompletedDate === date,
  };
}

export function getLongTermDisplayText(todo: TodoItem, date: string): string {
  const info = getLongTermTodoInfo(todo, date);
  if (!info) {
    return todo.text;
  }

  const stageNote = info.stageNote ? `（${info.stageNote}）` : "";
  return `${todo.text} 第 ${info.dayIndex}/${info.totalDays} 天${stageNote}`;
}

export function getLongTermMetaText(todo: TodoItem, date: string): string {
  const info = getLongTermTodoInfo(todo, date);
  if (!info) {
    return "";
  }

  if (info.earlyCompletedToday) {
    return todo.earlyCompletedNote?.trim()
      ? `已提前完成：${todo.earlyCompletedNote.trim()}`
      : "已提前完成";
  }

  return `${info.startDate} - ${info.endDate}`;
}

export function getLongTermProgressStatusForDate(
  todo: TodoItem,
  date: string,
  referenceDate = getLocalDateString()
): LongTermProgressStatus | undefined {
  if (!isLongTermTodo(todo)) {
    return undefined;
  }

  const startDate = getLongTermStartDate(todo);
  const endDate = todo.endDate;
  if (!startDate || !endDate || !isValidDateString(date)) {
    return undefined;
  }

  if (date < startDate || date > endDate) {
    return undefined;
  }

  if (todo.earlyCompletedDate && date > todo.earlyCompletedDate) {
    return undefined;
  }

  if (date < referenceDate) {
    return todo.completedDates?.includes(date) ? "completed" : "missed";
  }

  return "pending";
}

export function toggleTodoCompletionForDate(todo: TodoItem, date: string): TodoItem {
  if (!isLongTermTodo(todo)) {
    return { ...todo, completed: !todo.completed };
  }

  const completedDates = new Set(todo.completedDates ?? []);
  if (completedDates.has(date)) {
    completedDates.delete(date);
  } else {
    completedDates.add(date);
  }

  return {
    ...todo,
    completedDates: Array.from(completedDates).sort(),
  };
}

export function markLongTermTodoEarlyComplete(
  todo: TodoItem,
  date: string,
  note: string
): TodoItem {
  const completedDates = new Set(todo.completedDates ?? []);
  completedDates.add(date);

  return {
    ...todo,
    earlyCompletedDate: date,
    earlyCompletedNote: note.trim() || "提前完成",
    completedDates: Array.from(completedDates).sort(),
  };
}

export function normalizeLongTermTodo(todo: TodoItem): TodoItem {
  if (!isLongTermTodo(todo)) {
    return todo;
  }

  const startDate = getLongTermStartDate(todo);
  const endDate = todo.endDate;
  const completedDates = filterDatesInRange(todo.completedDates ?? [], startDate, endDate);
  const notifiedDates = filterDatesInRange(todo.notifiedDates ?? [], startDate, endDate);
  const totalDays = startDate && endDate ? getInclusiveDayCount(startDate, endDate) : 0;
  const stages = sanitizeStages(todo.stages ?? [], totalDays);
  const earlyCompletedDate =
    todo.earlyCompletedDate &&
    startDate &&
    endDate &&
    todo.earlyCompletedDate >= startDate &&
    todo.earlyCompletedDate <= endDate
      ? todo.earlyCompletedDate
      : undefined;

  return {
    ...todo,
    date: startDate ?? todo.date,
    startDate,
    completedDates,
    notifiedDates,
    stages,
    earlyCompletedDate,
    earlyCompletedNote: earlyCompletedDate ? todo.earlyCompletedNote : undefined,
  };
}

export function validateStages(stages: LongTermStage[], totalDays: number): string | undefined {
  const sortedStages = [...stages].sort((a, b) => a.startDay - b.startDay);
  let previousEnd = 0;

  for (const stage of sortedStages) {
    if (!stage.note.trim()) {
      return "阶段备注不能为空";
    }

    if (stage.startDay < 1 || stage.endDay < 1) {
      return "阶段天数不能小于 1";
    }

    if (stage.startDay > stage.endDay) {
      return "阶段开始天数不能晚于结束天数";
    }

    if (stage.endDay > totalDays) {
      return `阶段结束天数不能超过总天数 ${totalDays}`;
    }

    if (stage.startDay <= previousEnd) {
      return "阶段天数不能重叠";
    }

    previousEnd = stage.endDay;
  }

  return undefined;
}

export function getInclusiveDayCount(startDate: string, endDate: string): number {
  const start = getDateStamp(startDate);
  const end = getDateStamp(endDate);
  if (start === undefined || end === undefined || end < start) {
    return 0;
  }

  return Math.floor((end - start) / DAY_MS) + 1;
}

function getLongTermStartDate(todo: TodoItem): string | undefined {
  return todo.startDate ?? todo.date;
}

function getStageForDay(stages: LongTermStage[], dayIndex: number): LongTermStage | undefined {
  return stages.find((stage) => stage.startDay <= dayIndex && dayIndex <= stage.endDay);
}

function getLongTermProgressSegments(
  todo: TodoItem,
  startDate: string,
  currentDate: string,
  totalDays: number
): LongTermProgressSegment[] {
  const completedDates = new Set(todo.completedDates ?? []);

  return Array.from({ length: totalDays }, (_, index) => {
    const date = addDaysToDateString(startDate, index);
    const status =
      getLongTermProgressStatusForDate(todo, date, currentDate) ??
      (completedDates.has(date) ? "completed" : "pending");

    return {
      date,
      dayIndex: index + 1,
      status,
    };
  });
}

function sanitizeStages(stages: LongTermStage[], totalDays: number): LongTermStage[] {
  if (totalDays < 1) {
    return [];
  }

  return stages
    .filter((stage) => stage.note.trim())
    .map((stage) => ({
      ...stage,
      startDay: Math.max(1, Math.trunc(stage.startDay)),
      endDay: Math.min(totalDays, Math.max(1, Math.trunc(stage.endDay))),
      note: stage.note.trim(),
    }))
    .filter((stage) => stage.startDay <= stage.endDay)
    .sort((a, b) => a.startDay - b.startDay);
}

function filterDatesInRange(
  dates: string[],
  startDate?: string,
  endDate?: string
): string[] {
  if (!startDate || !endDate) {
    return [];
  }

  return Array.from(
    new Set(dates.filter((date) => date >= startDate && date <= endDate))
  ).sort();
}

function isValidDateString(value?: string): value is string {
  return Boolean(value && DATE_PATTERN.test(value) && getDateStamp(value) !== undefined);
}

function getDateStamp(date: string): number | undefined {
  if (!DATE_PATTERN.test(date)) {
    return undefined;
  }

  const [year, month, day] = date.split("-").map(Number);
  const stamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(stamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return undefined;
  }

  return stamp;
}

export function addDaysToDateString(date: string, days: number): string {
  const stamp = getDateStamp(date);
  if (stamp === undefined) {
    return date;
  }

  const nextDate = new Date(stamp + days * DAY_MS);
  const year = nextDate.getUTCFullYear();
  const month = String(nextDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(nextDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
