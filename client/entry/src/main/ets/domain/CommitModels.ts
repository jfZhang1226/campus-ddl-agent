import { ChecklistItem, Notice, Task } from './StorageModels';
import { TaskDraft } from './TaskContracts';

/** Creation only: IDs, task binding and initial state are owned by the client. */
export class ChecklistCreateDraft {
  label: string = '';
  sourceNoticeId: string | null = null;
}

export class TaskChangeDraft {
  action: string = 'create';
  taskId: string | null = null;
  expectedVersion: number | null = null;
  draft: TaskDraft = new TaskDraft();
  checklistCreates: ChecklistCreateDraft[] = [];
}

export class ProposalDraft {
  sessionId: string = '';
  expectedRevision: number = 0;
  // Prepared by the trusted notice importer, not raw model metadata.
  notices: Notice[] = [];
  changes: TaskChangeDraft[] = [];
}

export interface ProposedTaskChange {
  action: string;
  taskId: string;
  expectedVersion: number | null;
  before: Task | null;
  draft: TaskDraft;
}

export interface CommitProposal {
  recordType: string;
  id: string;
  sessionId: string;
  kind: string;
  changes: ProposedTaskChange[];
  notices: Notice[];
  sourceNoticeIds: string[];
  expectedRevision: number;
  state: string;
  createdAt: string;
  operationId: string | null;
  // Required for v2; absent in preserved v1 records.
  checklistItems?: ChecklistItem[];
}

export class ConfirmedCommitRequest {
  proposalId: string;
  operationId: string;
  expectedRevision: number;
  constructor(proposalId: string, operationId: string, revision: number) {
    this.proposalId = proposalId; this.operationId = operationId; this.expectedRevision = revision;
  }
}

export interface CommitReceipt {
  recordType: string;
  operationId: string;
  proposalId: string;
  expectedRevision: number;
  resultStatus: string;
  affectedTaskIds: string[];
  changedTaskIds: string[];
  tasks: Task[];
  committedRevision: number;
  confirmedAt: string;
  createdAt: string;
  // Required for v2; exact creation results, never a live view of later edits.
  notices?: Notice[];
  createdChecklistItemIds?: string[];
  checklistItems?: ChecklistItem[];
}
