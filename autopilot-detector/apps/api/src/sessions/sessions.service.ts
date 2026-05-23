import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SessionsService {
  constructor(private prisma: PrismaService) {}

  async getCurrentSession(userId: string) {
    const session = await this.prisma.session.findFirst({
      where: { userId, endedAt: null },
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
      else if (peakScore > 60) actualBehavior = 'Entertainment';
      else if (peakScore > 40) actualBehavior = 'Mixed';

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

  async getSessionScores(sessionId: string, userId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.userId !== userId) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    const scores = await this.prisma.autopilotScore.findMany({
      where: { sessionId },
      orderBy: { timestamp: 'asc' },
    });

    return scores;
  }

  // Stage 2: Save post-session mood rating and upsert MoodEntry for correlation chart
  async saveMoodRating(sessionId: string, userId: string, moodRating: number) {
    // IDOR check: ensure the session belongs to this user
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.userId !== userId) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    // Validate mood rating range
    if (moodRating < 1 || moodRating > 5 || !Number.isInteger(moodRating)) {
      throw new BadRequestException('moodRating must be an integer between 1 and 5');
    }

    // Update moodRating on Session
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { moodRating },
    });

    // Calculate average autopilot score for this session
    const scores = await this.prisma.autopilotScore.findMany({
      where: { sessionId },
      select: { score: true },
    });

    const avgScore =
      scores.length > 0
        ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length
        : 0;

    // Upsert MoodEntry for the correlation chart
    await this.prisma.moodEntry.upsert({
      where: { sessionId },
      update: { moodRating, avgScore },
      create: { userId, sessionId, moodRating, avgScore },
    });

    return { ok: true, moodRating, avgScore };
  }
}
