import { IsEnum } from 'class-validator';
import { PlanTier } from '@businessbrain/database';

export class ChangePlanDto {
  @IsEnum(PlanTier)
  planTier!: PlanTier;
}
