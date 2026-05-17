import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EmbeddingService } from '../ai/embedding.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { BehavioralSignal } from '@autopilot/shared';

interface EmbeddingJobData {
  sessionId: string;
}

@Processor('embedding')
export class EmbeddingProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbeddingProcessor.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {
    super();
  }

  async process(job: Job<EmbeddingJobData, any, string>): Promise<any> {
    this.logger.log(
      `Processing embedding job ${job.id} for session ${job.data.sessionId}`,
    );

    try {
      const session = await this.prisma.session.findUnique({
        where: { id: job.data.sessionId },
      });

      if (!session) {
        throw new Error(`Session ${job.data.sessionId} not found`);
      }

      const redis = this.redisService.getClient();
      const signalsKey = `session:${session.id}:signals`;
      const rawSignals = await redis.lrange(signalsKey, 0, -1);

      const signals = rawSignals.map((s) => JSON.parse(s) as BehavioralSignal);

      const embedding = await this.embeddingService.generateEmbedding(
        session,
        signals,
        'RETRIEVAL_DOCUMENT',
      );

      await this.embeddingService.storeEmbedding(session.id, embedding);

      this.logger.log(
        `Successfully generated and stored embedding for session ${session.id}`,
      );
    } catch (error) {
      this.logger.error(`Failed to process embedding job ${job.id}`, error);
      throw error;
    }
  }
}
