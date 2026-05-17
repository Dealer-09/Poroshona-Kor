import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getWeeklyHeatmap(userId: string) {
    // We fetch the user's scores for the last 4 weeks.
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

    const scores = await this.prisma.autopilotScore.findMany({
      where: {
        session: { userId },
        timestamp: { gte: fourWeeksAgo },
      },
      select: {
        score: true,
        timestamp: true,
        sessionId: true,
      },
    });

    // Also fetch interventions to count them
    const interventions = await this.prisma.intervention.findMany({
      where: {
        session: { userId },
        triggeredAt: { gte: fourWeeksAgo },
      },
      select: {
        triggeredAt: true,
      },
    });

    // Initialize 7 days x 24 hours grid
    const heatmap: Record<
      string,
      { totalScore: number; scoreCount: number; interventions: number }
    > = {};
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        heatmap[`${d}-${h}`] = {
          totalScore: 0,
          scoreCount: 0,
          interventions: 0,
        };
      }
    }

    // Populate scores
    for (const s of scores) {
      const d = s.timestamp.getDay(); // 0 (Sun) to 6 (Sat)
      const h = s.timestamp.getHours(); // 0 to 23
      const key = `${d}-${h}`;
      heatmap[key].totalScore += s.score;
      heatmap[key].scoreCount += 1;
    }

    // Populate interventions
    for (const i of interventions) {
      const d = i.triggeredAt.getDay();
      const h = i.triggeredAt.getHours();
      const key = `${d}-${h}`;
      heatmap[key].interventions += 1;
    }

    // Format output
    const result: {
      day: number;
      hour: number;
      avgScore: number | null;
      interventionCount: number;
    }[] = [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const cell = heatmap[`${d}-${h}`];
        const avgScore =
          cell.scoreCount > 0 ? cell.totalScore / cell.scoreCount : null;
        result.push({
          day: d,
          hour: h,
          avgScore,
          interventionCount: cell.interventions,
        });
      }
    }

    return result;
  }
}
