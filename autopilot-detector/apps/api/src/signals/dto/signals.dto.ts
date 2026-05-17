import { IsNumber, IsString, IsNotEmpty, IsISO8601, ValidateNested, IsArray, IsEnum } from 'class-validator';
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

  @IsString()
  @IsNotEmpty()
  userId: string;
}

export class BehavioralSignalBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BehavioralSignalDto)
  signals: BehavioralSignalDto[];
}
