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

    // 4. Build RAG prompt
    const systemPrompt =
      'You are a strict, smart digital wellbeing coach. The user is currently DISTRACTED and in "autopilot" mode. Do NOT praise their focus, autonomy, or work under any circumstances. You must contextually and firmly nudge them to return to their declared focus goal. Be extremely concise, direct, and max 2 sentences.';

    let userPrompt = `The user declared their intent to study/work on: "${session.declaredIntent}".\n`;
    if (session.pageTitle) {
      userPrompt += `However, they are currently wasting time watching/viewing: "${session.pageTitle}"`;
      if (session.pageCategory) {
        userPrompt += ` (Genre/Category: ${session.pageCategory})`;
      }
      userPrompt += `.\n`;
    }
    userPrompt += `Their distraction autopilot score is: ${score}/100 (which is extremely high and bad!).\n`;
    userPrompt += `Past RAG context logs: ${pastOutcomes || 'No previous interventions'}.\n`;
    userPrompt += `Write a highly relevant, firm nudge encouraging them to get back to their declared goal: "${session.declaredIntent}".`;

    // 5. Determine type and best Groq model dynamically
    let type = InterventionType.NUDGE;
    let modelToUse = 'llama-3.1-8b-instant'; // Ultra-fast default model

    if (score > 85) {
      type = InterventionType.REFLECTION;
      modelToUse = 'llama-3.3-70b-versatile'; // Use high-reasoning 70B model for deep cognitive breaks!
    } else if (score > 75) {
      type = InterventionType.PAUSE;
    }

    // 6. Call Groq API
    let message = 'You seem to be scrolling aimlessly. Time for a quick break?';
    try {
      const groqClient = await this.getGroqClient(session.userId);
      const chatCompletion = await groqClient.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        model: modelToUse,
        max_tokens: 150,
      });

      if (chatCompletion.choices[0]?.message?.content) {
        message = chatCompletion.choices[0].message.content;
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

    // Set the cooldown timestamp in Redis only AFTER successful creation and broadcast!
    const lastInterventionKey = `user:${session.userId}:lastIntervention`;
    await redis.set(lastInterventionKey, Date.now().toString());

    return intervention;
  }
}
