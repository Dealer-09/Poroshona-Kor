import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Session } from '@prisma/client';
import { BehavioralSignal } from '@autopilot/shared';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private ai: GoogleGenAI;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.ai = new GoogleGenAI({
      apiKey: this.configService.get<string>('GEMINI_API_KEY'),
    });
  }

  async generateEmbedding(
    session: Session,
    signals: BehavioralSignal[],
    taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' = 'RETRIEVAL_DOCUMENT',
  ): Promise<number[]> {
    this.logger.log(`Generating embedding for session ${session.id}...`);
    
    const summary = this.createSessionSummary(session, signals);

    const response = await this.ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: summary,
      config: {
        outputDimensionality: 512,
        taskType: taskType,
      },
    });

    if (!response.embeddings || response.embeddings.length === 0 || !response.embeddings[0].values) {
      throw new Error('Failed to generate embedding');
    }

    return response.embeddings[0].values;
  }

  async storeEmbedding(sessionId: string, embedding: number[]): Promise<void> {
    this.logger.log(`Storing embedding for session ${sessionId}...`);
    const vectorString = `[${embedding.join(',')}]`;

    // Upsert or insert via raw SQL for pgvector
    await this.prisma.$executeRaw`
      INSERT INTO "SessionEmbedding" ("id", "sessionId", "embedding")
      VALUES (gen_random_uuid(), ${sessionId}::uuid, ${vectorString}::vector)
    `;
  }

  async findSimilarSessions(
    embedding: number[],
    userId: string,
    limit: number = 3,
  ): Promise<(Session & { interventions: any[] })[]> {
    const vectorString = `[${embedding.join(',')}]`;
    
    // Find sessions using cosine distance (<=>)
    const similarEmbeddings = await this.prisma.$queryRaw<
      Array<{ sessionId: string }>
    >`
      SELECT "sessionId"
      FROM "SessionEmbedding" e
      JOIN "Session" s ON s.id = e."sessionId"
      WHERE s."userId" = ${userId}::uuid
      ORDER BY e.embedding <=> ${vectorString}::vector
      LIMIT ${limit}
    `;

    if (similarEmbeddings.length === 0) {
      return [];
    }

    const sessionIds = similarEmbeddings.map((e) => e.sessionId);
    return this.prisma.session.findMany({
      where: { id: { in: sessionIds } },
      include: {
        interventions: true,
      },
    });
  }

  private createSessionSummary(
    session: Session,
    signals: BehavioralSignal[],
  ): string {
    // Generate a textual summary that captures the essence of the session for embedding
    const avgScroll =
      signals.reduce((acc, s) => acc + s.scrollVelocity, 0) /
      (signals.length || 1);
    const totalPassive = signals.reduce((acc, s) => acc + s.passiveTime, 0);
    const totalActive = signals.reduce((acc, s) => acc + s.activeTime, 0);
    const passiveRatio =
      totalPassive + totalActive === 0
        ? 0
        : totalPassive / (totalPassive + totalActive);

    let context = `User intended to ${session.declaredIntent} on ${session.appOpened}. `;
    if (session.pageTitle) {
      context += `Content title: "${session.pageTitle}". `;
    }
    if (session.pageCategory) {
      context += `Content category: "${session.pageCategory}". `;
    }
    context += `Average scroll velocity was ${avgScroll.toFixed(2)}. Passive time ratio was ${(passiveRatio * 100).toFixed(1)}%. Total signals analyzed: ${signals.length}.`;
    
    return context;
  }
}
