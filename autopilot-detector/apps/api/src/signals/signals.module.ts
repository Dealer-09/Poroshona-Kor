import { Module } from '@nestjs/common';
import { SignalsGateway } from './signals.gateway';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AutopilotScoreService } from './autopilot-score.service';
import { QueuesModule } from '../queues/queues.module';
import { InterventionTimingService } from './intervention-timing.service';
import { ContentClassificationService } from './content-classification.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [AuthModule, PrismaModule, RedisModule, QueuesModule, UsersModule],
  providers: [
    SignalsGateway,
    AutopilotScoreService,
    InterventionTimingService,
    ContentClassificationService,
  ],
})
export class SignalsModule {}
