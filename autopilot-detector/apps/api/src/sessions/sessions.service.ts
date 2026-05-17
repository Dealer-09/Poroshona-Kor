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
