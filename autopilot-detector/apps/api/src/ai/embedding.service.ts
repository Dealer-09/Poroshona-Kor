import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Session } from '@prisma/client';
import { BehavioralSignal } from '@autopilot/shared';
import { UsersService } from '../users/users.service';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly serverGeminiKey: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private usersService: UsersService,
  ) {
    this.serverGeminiKey =
      this.configService.get<string>('GEMINI_API_KEY') || '';
  }

  private async getAiClient(userId?: string): Promise<GoogleGenAI> {
    let activeKey = this.serverGeminiKey;
    if (userId) {
      const userKey = await this.usersService.getRawGeminiApiKey(userId);
      if (userKey) activeKey = userKey;
    }

    if (!activeKey) {
      throw new Error('No Gemini API key available (neither user nor server)');
    }
    return new GoogleGenAI({ apiKey: activeKey });
  }

  async generateEmbedding(
    session: Session,
    signals: BehavioralSignal[],
    taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' = 'RETRIEVAL_DOCUMENT',
  ): Promise<number[]> {
    this.logger.log(`Generating embedding for session ${session.id}...`);

    const summary = this.createSessionSummary(session, signals);
    const aiClient = await this.getAiClient(session.userId);

    const response = await aiClient.models.embedContent({
      model: 'gemini-embedding-001',
      contents: summary,
      config: {
        outputDimensionality: 512,
        taskType: taskType,
      },
    });

    if (
      !response.embeddings ||
      response.embeddings.length === 0 ||
      !response.embeddings[0].values
    ) {
      throw new Error('Failed to generate embedding');
    }

    return response.embeddings[0].values;
  }

  async embedQuery(text: string, userId?: string): Promise<number[]> {
    this.logger.log(
      `Generating embedding for query: "${text.substring(0, 30)}..."`,
    );
    const aiClient = await this.getAiClient(userId);

    const response = await aiClient.models.embedContent({
      model: 'gemini-embedding-001',
      contents: text,
      config: {
        outputDimensionality: 512,
        taskType: 'RETRIEVAL_QUERY',
      },
    });

    if (
      !response.embeddings ||
      response.embeddings.length === 0 ||
      !response.embeddings[0].values
    ) {
      throw new Error('Failed to generate query embedding');
    }

    return response.embeddings[0].values;
  }

  async storeEmbedding(sessionId: string, embedding: number[]): Promise<void> {
    this.logger.log(`Storing embedding for session ${sessionId}...`);
    const vectorString = `[${embedding.join(',')}]`;

    // Delete any existing embedding for this session first (upsert semantics
    // without needing a UNIQUE constraint on sessionId)
    await this.prisma.$executeRaw`
      DELETE FROM "SessionEmbedding" WHERE "sessionId" = ${sessionId}::uuid
    `;

    // Insert the new embedding
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
    const sessions = await this.prisma.session.findMany({
      where: { id: { in: sessionIds } },
      include: {
        interventions: true,
      },
    });

    // `findMany({ in })` does NOT preserve the cosine-distance ordering from the
    // raw query, so re-sort by the ranked `sessionIds` to keep "most similar"
    // first (the RAG prompt and "Session 1/2/3" labeling depend on this order).
    const rank = new Map(sessionIds.map((id, i) => [id, i]));
    return sessions.sort(
      (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0),
    );
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
