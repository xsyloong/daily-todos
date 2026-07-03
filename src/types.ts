export type TodoType = "normal" | "longTerm";

export interface LongTermStage {
  id: string;
  startDay: number;
  endDay: number;
  note: string;
}

export interface TodoItem {
  id: string;
  text: string;
  type?: TodoType;
  completed: boolean;
  date: string; // YYYY-MM-DD
  timeRange?: string; // HH:mm-HH:mm
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  stages?: LongTermStage[];
  completedDates?: string[]; // YYYY-MM-DD values for long-term todos
  notifiedDates?: string[]; // YYYY-MM-DD values already reminded for long-term todos
  earlyCompletedDate?: string; // YYYY-MM-DD
  earlyCompletedNote?: string;
  // Legacy fields kept so existing saved todos continue to load and display.
  timeSlot?: "morning" | "afternoon" | "custom";
  customTime?: string; // HH:mm
  notified?: boolean;
}

export interface AppSettings {
  windowX: number;
  windowY: number;
  windowWidth: number;
  windowHeight: number;
  alwaysOnTop: boolean;
  dataFilePath?: string | null;
  dataFolderPath?: string | null;
}

export interface DataFileStatus {
  dataFolderPath?: string | null;
  activeDataFilePath: string;
  usingDefaultDataFile: boolean;
}

export interface DataFileSwitchResult {
  todos: TodoItem[];
  status: DataFileStatus;
}

export interface JiraConfigView {
  enabled: boolean;
  siteUrl: string;
  email: string;
  apiTokenConfigured: boolean;
  refreshIntervalSeconds: number;
  maxIssues: number;
  jql: string;
  configPath: string;
}

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  priority?: string | null;
  issueType?: string | null;
  updated?: string | null;
  dueDate?: string | null;
  url: string;
}

export interface JiraTestResult {
  issueCount: number;
  hasMore: boolean;
  warnings: string[];
  message: string;
}

export interface JiraDiagnosticQueryResult {
  label: string;
  jql: string;
  issueCount?: number | null;
  hasMore: boolean;
  error?: string | null;
}

export interface JiraDiagnosticResult {
  accountId: string;
  displayName: string;
  emailAddress?: string | null;
  queries: JiraDiagnosticQueryResult[];
}
