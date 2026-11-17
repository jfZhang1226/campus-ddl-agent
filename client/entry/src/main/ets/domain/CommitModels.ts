import { ChecklistItem, Notice, Task } from './StorageModels';
import { TaskDraft } from './TaskContracts';
import { PlanningChange, PlanningIntent, PlanningResult } from '../planning/PlanningContracts';

/** Creation only: IDs, task binding and initial state are owned by the client. */
export class ChecklistCreateDraft {
  label: string = '';
  sourceNoticeId: string | null = null;
}

/** Client-owned material state intent; the current item/version is read during staging. */
export class ChecklistStateDraft {
  itemId: string = '';
  state: string = 'pending';
}

export interface ProposedChecklistState {
  itemId: string;
  taskId: string;
  before: ChecklistItem;
  state: string;
}

export interface UserSubmissionSnapshot {
  id: string;
  taskId: string;
  taskVersion: number;
  confirmedSubmittedAt: string;
  submissionChannel: string | null;
  sourceNoticeIds: string[];
  materials: ChecklistItem[];
}

export class TaskChangeDraft {
  action: string = 'create';
  taskId: string | null = null;
  expectedVersion: number | null = null;
  draft: TaskDraft = new TaskDraft();
  checklistCreates: ChecklistCreateDraft[] = [];
  checklistUpdates?: ChecklistStateDraft[];
  confirmSubmission?: boolean;
}

export class ProposalDraft {
  sessionId: string = '';
  expectedRevision: number = 0;
  // Prepared by the trusted notice importer, not raw model metadata.
  notices: Notice[] = [];
  changes: TaskChangeDraft[] = [];
  planning?: PlanningIntent;
}

export interface ProposedTaskChange {
  action: string;
  taskId: string;
  expectedVersion: number | null;
  before: Task | null;
  draft: TaskDraft;
  confirmSubmission?: boolean;
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
  // v3 only: original material state is immutable evidence, not a live pointer.
  checklistUpdates?: ProposedChecklistState[];
  checklistBefore?: ChecklistItem[];
  planning?: PlanningChange;
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
  updatedChecklistItems?: ChecklistItem[];
  submissionSnapshots?: UserSubmissionSnapshot[];
  planning?: PlanningResult;
}
