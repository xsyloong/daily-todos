import type { TodoItem } from "./types";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const LEGACY_MORNING_RANGE = "09:00-12:00";
const LEGACY_AFTERNOON_RANGE = "14:00-18:00";

interface ParsedTimeRange {
  start: string;
  end: string;
}

export function parseTimeRange(timeRange?: string): ParsedTimeRange | undefined {
  if (!timeRange) {
    return undefined;
  }

  const [start, end] = timeRange.split("-").map((value) => value.trim());
  if (isValidTime(start) && isValidTime(end)) {
    return { start, end };
  }

  return undefined;
}

export function createTimeRange(start: string, end: string): string | undefined {
  const normalizedStart = start.trim();
  const normalizedEnd = end.trim();

  if (
    !isValidTime(normalizedStart) ||
    !isValidTime(normalizedEnd) ||
    normalizedStart >= normalizedEnd
  ) {
    return undefined;
  }

  return `${normalizedStart}-${normalizedEnd}`;
}

export function formatTimeRangeLabel(timeRange: string): string {
  const parsed = parseTimeRange(timeRange);
  return parsed ? `${parsed.start} - ${parsed.end}` : timeRange;
}

export function getTodoTimeRange(todo: TodoItem): string | undefined {
  const parsed = parseTimeRange(todo.timeRange);
  if (parsed) {
    return createTimeRange(parsed.start, parsed.end);
  }

  if (todo.timeSlot === "morning") {
    return LEGACY_MORNING_RANGE;
  }

  if (todo.timeSlot === "afternoon") {
    return LEGACY_AFTERNOON_RANGE;
  }

  return undefined;
}

export function getTodoTimeLabel(todo: TodoItem): string {
  const timeRange = getTodoTimeRange(todo);
  if (timeRange) {
    return formatTimeRangeLabel(timeRange);
  }

  if (todo.timeSlot === "custom" && todo.customTime) {
    return todo.customTime;
  }

  return "";
}

export function uniqueRecentTimeRanges(
  timeRanges: Array<string | undefined>,
  limit = 5
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const timeRange of timeRanges) {
    const parsed = parseTimeRange(timeRange);
    if (!parsed) {
      continue;
    }

    const normalized = createTimeRange(parsed.start, parsed.end);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function isValidTime(value?: string): value is string {
  return Boolean(value && TIME_PATTERN.test(value));
}
