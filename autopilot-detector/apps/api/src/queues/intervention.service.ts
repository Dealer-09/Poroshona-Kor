import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InterventionType, BehavioralSignal } from '@autopilot/shared';
import { EmbeddingService } from '../ai/embedding.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import Groq from 'groq-sdk';
import { UsersService } from '../users/users.service';

@Injectable()
export class InterventionService {
  private readonly logger = new Logger(InterventionService.name);
  private readonly serverGroqKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly usersService: UsersService,
  ) {
    this.serverGroqKey = this.configService.get<string>('GROQ_API_KEY') || '';
  }

  private async getGroqClient(userId: string): Promise<Groq> {
    let activeKey = this.serverGroqKey;
    const userKey = await this.usersService.getRawGroqApiKey(userId);
    if (userKey) activeKey = userKey;

    if (!activeKey) {
      throw new Error('No Groq API key available (neither user nor server)');
    }
    return new Groq({ apiKey: activeKey });
  }

  async generateIntervention(
    sessionId: string,
    score: number,
    signals: BehavioralSignal[],
  ) {
    this.logger.log(
      `Generating intervention for session: ${sessionId} (Score: ${score})`,
    );

    // 1. Get current session
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // 2. Generate embedding of current session state and find top 3 similar past sessions
    let similarSessions: any[] = [];
    try {
      const currentEmbedding = await this.embeddingService.generateEmbedding(
        session,
        signals,
        'RETRIEVAL_QUERY',
      );

      similarSessions = await this.embeddingService.findSimilarSessions(
        currentEmbedding,
        session.userId,
        3,
      );
    } catch (error: any) {
      this.logger.warn(
        `Embedding or similarity search failed. Falling back to clean RAG context. Error: ${error.message}`,
      );
    }

    // Build context string from past sessions
    const pastOutcomes = similarSessions
      .map(
        (s) =>
          `Intent: ${s.declaredIntent}, App: ${s.appOpened}, Interventions: ${s.interventions?.length || 0}`,
      )
      .join(' | ');

    // 4. Build context-rich RAG prompt (Stage 2 upgrade)
    // Extract the most recent signal context
    const latestSignal = signals[signals.length - 1];
    const activeDomain = latestSignal?.activeDomain || session.appOpened || 'the browser';
    const activeTabTitle = latestSignal?.activeTabTitle || session.pageTitle || '';
    const pageResetRate = (
      signals.reduce((acc, s) => acc + (s.pageResetCount ?? 0), 0) /
      Math.max(0.1, (new Date().getTime() - session.startedAt.getTime()) / 60000)
    ).toFixed(1);

    // Determine intervention type first so we can reference it in the prompt
    let type = InterventionType.NUDGE;
    let modelToUse = 'llama-3.1-8b-instant';
    if (score > 85) {
      type = InterventionType.REFLECTION;
      modelToUse = 'llama-3.3-70b-versatile';
    } else if (score > 75) {
      type = InterventionType.PAUSE;
    }

    const systemPrompt =
      'You are the Autopilot Detector intervention engine. Generate ONE short, punchy intervention message (max 15 words). Be specific — use the exact domain and intent provided. Be firm but non-judgmental. No emojis. No quotes around the output.';

    const userPrompt = `User said they opened the browser to: ${session.declaredIntent}.
They are currently on: ${activeDomain}${activeTabTitle ? ` ("${activeTabTitle}")` : ''}.
Their cognitive drift score is ${score}/100.
They have refreshed the infinite scroll ${pageResetRate} times per minute.
Past session context: ${pastOutcomes || 'No previous sessions'}.
Intervention type: ${type}.
Generate the intervention message.`;

    this.logger.log(`Prompt context: domain=${activeDomain}, intent=${session.declaredIntent}, type=${type}`);

    // 5. Call Groq API
    let message = `You said ${session.declaredIntent?.toLowerCase() || 'focus'}. ${activeDomain} says otherwise. Score: ${score}.`;
    try {
      const groqClient = await this.getGroqClient(session.userId);
      const chatCompletion = await groqClient.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        model: modelToUse,
        max_tokens: 60,
      });

      if (chatCompletion.choices[0]?.message?.content) {
        message = chatCompletion.choices[0].message.content.trim();
      }
    } catch (error) {
      this.logger.error(
        `Groq API failed using model ${modelToUse}, using fallback message`,
        error,
      );
    }

    // 6. Save to PostgreSQL
    const intervention = await this.prisma.intervention.create({
      data: {
        sessionId,
        type,
        message,
      },
    });

    this.logger.log(`Intervention created: ${intervention.id}`);

    // 7. Publish to Redis for WebSocket delivery
    const redis = this.redisService.getClient();
    await redis.publish(
      'interventions',
      JSON.stringify({
        userId: session.userId,
        intervention,
      }),
    );

    return intervention;
  }
}
