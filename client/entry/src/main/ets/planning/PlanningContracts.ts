import { Task } from '../domain/StorageModels';
import { AvailabilityBlock, PlanBlock, UnscheduledWork, WeekPlanCandidate } from './WeekPlanner';

export const PLAN_PROPOSAL_RECORD: string = 't16.proposal.v4';
export const PLAN_OPERATION_RECORD: string = 't16.operation.v4';
export interface AvailabilityDraft { startAt: string; endAt: string; }
/** Full explicit intent; IDs and resulting blocks are derived by trusted client rules. */
export class PlanningIntent {
  action: string = 'availability';
  availability: AvailabilityDraft[] | null = null;
  fromAt: string | null = null;
  toAt: string | null = null;
  blockId: string | null = null;
  locked: boolean | null = null;
  remainingMinutes: number | null = null;
}
export interface PlanningChange {
  intent: PlanningIntent;
  tasksBefore: Task[];
  beforeAvailability: AvailabilityBlock[];
  beforeBlocks: PlanBlock[];
  afterAvailability: AvailabilityBlock[];
  afterBlocks: PlanBlock[];
  candidate: WeekPlanCandidate | null;
}
export interface PlanningResult {
  availability: AvailabilityBlock[];
  blocks: PlanBlock[];
  unscheduled: UnscheduledWork[];
}
