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

export interface Message {
  id: string;
  sessionId: string;
  role: string;
  text: string;
  toolName: string | null;
  toolResultSummary: string | null;
  status: string;
  createdAt: string;
}

export class SessionDocument {
  schemaVersion: number = 1;
  revision: number = 0;
  session: Session;
  messages: Message[] = [];

  constructor(session: Session) {
    this.session = session;
  }
}
