import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SessionsService {
  constructor(private prisma: PrismaService) {}

  async getCurrentSession(userId: string) {
    const session = await this.prisma.session.findFirst({
      where: { userId },
      orderBy: { startedAt: 'desc' },
    });
    return session || null;
  }

  async getAllSessions(userId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      include: {
        scores: {
          select: { score: true },
        },
        interventions: {
          select: { id: true, type: true },
        },
      },
    });

    return sessions.map((session) => {
      const peakScore = session.scores.reduce(
        (max, s) => Math.max(max, s.score),
        0,
      );

      // Determine inferred actual behavior based on peak score (simplistic heuristic)
      let actualBehavior = 'Study';
      if (peakScore > 85) actualBehavior = 'Doomscrolling';
      else if (peakScore > 60) actualBehavior = 'Mixed';
      else if (peakScore > 40) actualBehavior = 'Entertainment';

      return {
        id: session.id,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        appOpened: session.appOpened,
        declaredIntent: session.declaredIntent,
        peakScore,
        interventionsCount: session.interventions.length,
        actualBehavior,
      };
    });
  }

  async getSessionScores(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    const scores = await this.prisma.autopilotScore.findMany({
      where: { sessionId },
      orderBy: { timestamp: 'asc' },
    });

    return scores;
  }
}
