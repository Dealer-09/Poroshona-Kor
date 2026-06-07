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
      throw new BadRequestException(
        'moodRating must be an integer between 1 and 5',
      );
    }

    // Calculate average autopilot score for this session
    const scores = await this.prisma.autopilotScore.findMany({
      where: { sessionId },
      select: { score: true },
    });

    const avgScore =
      scores.length > 0
        ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length
        : 0;

    // Atomically: update the session mood AND upsert the MoodEntry so the two
    // sources of truth can't diverge (previously two separate writes).
    await this.prisma.$transaction([
      this.prisma.session.update({
        where: { id: sessionId },
        data: { moodRating },
      }),
      this.prisma.moodEntry.upsert({
        where: { sessionId },
        update: { moodRating, avgScore },
        create: { userId, sessionId, moodRating, avgScore },
      }),
    ]);

    // Stage 3: the mood rating is the weak supervision signal — now that it's in,
    // compute per-step onset labels for this session's event sequence so it can
    // be used to train the prediction model. Best-effort; never fail the request.
    try {
      const updated = await this.labelSessionEvents(sessionId, moodRating);
      return { ok: true, moodRating, avgScore, labeledEvents: updated };
    } catch {
      return { ok: true, moodRating, avgScore };
    }
  }

  /**
   * Weak-labeling pass for onset prediction.
   *
   * A step is a POSITIVE example (`onsetLabel = true`) iff the session was rated
   * poorly (mood ≤ 3) AND, within the next ONSET_HORIZON_MS, the drift crosses and
   * stays above ONSET_DRIFT_THRESHOLD — i.e. this timestep sits in the run-up to a
   * doomscroll onset. Otherwise it's a NEGATIVE example. Well-rated sessions
   * (mood ≥ 4) are all negatives (a "good" session by definition had no bad onset).
   */
  private async labelSessionEvents(
    sessionId: string,
    moodRating: number,
  ): Promise<number> {
    const ONSET_DRIFT_THRESHOLD = 60; // drift considered "in autopilot"
    const ONSET_HORIZON_MS = 5 * 60 * 1000; // look-ahead window: 5 minutes
    const SUSTAIN_COUNT = 2; // need ≥2 consecutive high-drift steps to count as onset

    const events = await this.prisma.sessionEvent.findMany({
      where: { sessionId },
      orderBy: { timestamp: 'asc' },
      select: { id: true, timestamp: true, runningDrift: true },
    });
    if (events.length === 0) return 0;

    const sessionWasBad = moodRating <= 3;

    const updates = events.map((ev, i) => {
      let onsetLabel = false;
      if (sessionWasBad) {
        const horizonEnd = ev.timestamp.getTime() + ONSET_HORIZON_MS;
        let consecutive = 0;
        for (let j = i + 1; j < events.length; j++) {
          if (events[j].timestamp.getTime() > horizonEnd) break;
          if (events[j].runningDrift >= ONSET_DRIFT_THRESHOLD) {
            consecutive++;
            if (consecutive >= SUSTAIN_COUNT) {
              onsetLabel = true;
              break;
            }
          } else {
            consecutive = 0;
          }
        }
      }
      return this.prisma.sessionEvent.update({
        where: { id: ev.id },
        data: { onsetLabel },
      });
    });

    await this.prisma.$transaction(updates);
    return updates.length;
  }
}
