/** T03 names; enum refinements remain subject to A/B interface review. */
export interface Notice {
  id: string;
  rawText: string;
  sourceLabel: string | null;
  publishedAt: string | null;
  importedAt: string;
  timezone: string;
  contentHash: string;
}

export interface Task {
  id: string;
  title: string;
  course: string | null;
  kind: string | null;
  deadlinePrecision: string;
  deadlineDate: string | null;
  dueAt: string | null;
  timezone: string;
  priority: string | null;
  status: string;
  remainingMinutes: number | null;
  submissionChannel: string | null;
  noticeIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItem {
  id: string;
  taskId: string;
  label: string;
  state: string;
  sourceNoticeId: string | null;
  confirmedAt: string | null;
}

export class BusinessSnapshot {
  schemaVersion: number = 1;
  revision: number = 0;
  notices: Notice[] = [];
  tasks: Task[] = [];
  checklistItems: ChecklistItem[] = [];
  // Reserved collections are preserved as JSON objects. Their full business codecs
  // and invariants are implemented with T16/T22/T25, before those features integrate.
  availabilityBlocks: Object[] = [];
  planBlocks: Object[] = [];
  proposals: Object[] = [];
  operations: Object[] = [];
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pendingProposalId: string | null;
}

/** The gateway's normalized call shape, not the provider's function/arguments shape. */
export interface MessageToolCall {
  id: string;
  action: string;
  params: Object;
}

export interface MessageToolResult {
  id: string;
  action: string;
  params: Object;
  success: boolean;
  data: Object | null;
  errorCode: string | null;
  message: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: string;
  // text / answer / clarification / tool_calls / tool_result / legacy_tool
  type: string;
  text: string | null;
  calls: MessageToolCall[];
  results: MessageToolResult[];
  // Display hints retained for v1 history; never substitute for calls/results.
  toolName: string | null;
  toolResultSummary: string | null;
  status: string;
  createdAt: string;
}

export class SessionDocument {
  schemaVersion: number = 2;
  revision: number = 0;
  session: Session;
  messages: Message[] = [];

  constructor(session: Session) {
    this.session = session;
  }
}
