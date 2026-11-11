import { Notice, Task } from './StorageModels';
import { TaskDraft } from './TaskContracts';

export class TaskChangeDraft {
  action: string = 'create';
  taskId: string | null = null;
  expectedVersion: number | null = null;
  draft: TaskDraft = new TaskDraft();
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
}
