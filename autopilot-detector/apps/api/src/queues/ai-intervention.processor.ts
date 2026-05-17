import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InterventionService } from './intervention.service';
import { BehavioralSignal } from '@autopilot/shared';

interface AiInterventionJobData {
  sessionId: string;
  score: number;
  signals: BehavioralSignal[];
}

@Processor('ai-intervention')
export class AiInterventionProcessor extends WorkerHost {
  private readonly logger = new Logger(AiInterventionProcessor.name);

  constructor(private readonly interventionService: InterventionService) {
    super();
  }

  async process(job: Job<AiInterventionJobData, any, string>): Promise<any> {
    this.logger.log(
      `Processing job ${job.id} of type ${job.name} for session ${job.data.sessionId}`,
    );

    try {
      const result = await this.interventionService.generateIntervention(
        job.data.sessionId,
        job.data.score,
        job.data.signals,
      );

      return result;
    } catch (error) {
      this.logger.error(`Failed to process job ${job.id}`, error);
      throw error; // Let BullMQ retry
    }
  }
}
