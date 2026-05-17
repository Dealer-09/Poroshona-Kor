import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { AiInterventionProcessor } from './ai-intervention.processor';
import { InterventionService } from './intervention.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { RedisModule } from '../redis/redis.module';
import { EmbeddingProcessor } from './embedding.processor';

@Module({
  imports: [
    PrismaModule,
    AiModule,
    RedisModule,
    BullModule.registerQueue({
      name: 'ai-intervention',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    }),
    BullModule.registerQueue({
      name: 'embedding',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    }),
    BullBoardModule.forFeature({
      name: 'ai-intervention',
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'embedding',
      adapter: BullMQAdapter,
    }),
  ],
  providers: [InterventionService, AiInterventionProcessor, EmbeddingProcessor],
  exports: [BullModule, InterventionService],
})
export class QueuesModule {}
