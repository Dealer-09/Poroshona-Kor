import {
  IsNumber,
  IsString,
  IsNotEmpty,
  IsISO8601,
  ValidateNested,
  IsArray,
  IsEnum,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BehavioralSignal, AppIntent } from '@autopilot/shared';

export class StartSessionDto {
  @IsString()
  @IsNotEmpty()
  appOpened: string;

  @IsEnum(AppIntent)
  declaredIntent: AppIntent;
}

export class BehavioralSignalDto implements BehavioralSignal {
  @IsNumber()
  scrollVelocity: number;

  @IsNumber()
  tabSwitchCount: number;

  @IsNumber()
  clickRate: number;

  @IsNumber()
  passiveTime: number;

  @IsNumber()
  activeTime: number;

  @IsISO8601()
  timestamp: string;

  @IsString()
  @IsNotEmpty()
  sessionId: string;

  // userId is NOT sent by the extension — it is read from the JWT in the gateway.
  // Keeping this optional so the DTO does not reject batches that omit it.
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  activeDomain?: string;

  @IsOptional()
  @IsString()
  activeTabTitle?: string;

  // Stage 2: Infinite scroll signals
  @IsOptional()
  @IsNumber()
  scrollDepthPercent?: number;

  @IsOptional()
  @IsNumber()
  pageResetCount?: number;

  // Stage 2: Pomodoro break flag
  @IsOptional()
  @IsBoolean()
  isPomodoroBreak?: boolean;
}

export class BehavioralSignalBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BehavioralSignalDto)
  signals: BehavioralSignalDto[];
}
