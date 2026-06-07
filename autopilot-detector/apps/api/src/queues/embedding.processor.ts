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

      // The Redis buffer is best-effort and TTL-bound (shrunk to ~300s at
      // session end). If it expired or the session ended before any signals
      // were collected, there is nothing meaningful to embed — skip rather than
      // persist a contentless "0 signals" vector that would pollute RAG results.
      if (rawSignals.length === 0) {
        this.logger.warn(
          `No buffered signals for session ${session.id} (buffer empty/expired). Skipping embedding.`,
        );
        return;
      }

      // Drop any individually-corrupt buffer entries instead of throwing the
      // whole job (which would retry forever on the same poisoned data).
      const signals = rawSignals
        .map((s) => {
          try {
            return JSON.parse(s) as BehavioralSignal;
          } catch {
            this.logger.warn(
              `Skipping corrupt signal entry in session ${session.id} buffer`,
            );
            return null;
          }
        })
        .filter((s): s is BehavioralSignal => s !== null);

      if (signals.length === 0) {
        this.logger.warn(
          `All buffered signals for session ${session.id} were corrupt. Skipping embedding.`,
        );
        return;
      }

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
