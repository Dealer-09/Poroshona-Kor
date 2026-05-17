import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InterventionType, BehavioralSignal } from '@autopilot/shared';

@Injectable()
export class InterventionService {
  private readonly logger = new Logger(InterventionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateIntervention(
    sessionId: string,
    score: number,
    signals: BehavioralSignal[],
  ) {
    this.logger.log(
      `Generating intervention for session: ${sessionId} (Score: ${score})`,
    );

    // Stub for future LLM integration.
    // In Phase 3, this will call Google Gemini or another LLM to generate contextual advice.
    let type = InterventionType.NUDGE;
    let message = 'You seem to be scrolling aimlessly. Time for a quick break?';

    if (score > 85) {
      type = InterventionType.REFLECTION;
      message =
        'Your focus is highly fragmented. Consider pausing for 5 minutes.';
    } else if (score > 75) {
      type = InterventionType.PAUSE;
      message = 'You are starting to drift. Let’s take a breath.';
    }

    // Save to PostgreSQL
    const intervention = await this.prisma.intervention.create({
      data: {
        sessionId,
        type,
        message,
      },
    });

    this.logger.log(`Intervention created: ${intervention.id}`);

    return intervention;
  }
}
