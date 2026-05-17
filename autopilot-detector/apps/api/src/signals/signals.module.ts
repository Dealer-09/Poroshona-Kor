import { Module } from '@nestjs/common';
import { SignalsGateway } from './signals.gateway';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AutopilotScoreService } from './autopilot-score.service';
import { QueuesModule } from '../queues/queues.module';

@Module({
  imports: [AuthModule, PrismaModule, RedisModule, QueuesModule],
  providers: [SignalsGateway, AutopilotScoreService],
})
export class SignalsModule {}
