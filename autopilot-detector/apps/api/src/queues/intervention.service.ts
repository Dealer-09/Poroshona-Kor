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
    this.logger.log(`Generating intervention for session: ${sessionId} (Score: ${score})`);

    // 1. Get current session
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // 2. Generate embedding of current session state
    const currentEmbedding = await this.embeddingService.generateEmbedding(
      session,
      signals,
      'RETRIEVAL_QUERY',
    );

    // 3. Find top 3 similar past sessions
    const similarSessions = await this.embeddingService.findSimilarSessions(
      currentEmbedding,
      session.userId,
      3,
    );

    // Build context string from past sessions
    const pastOutcomes = similarSessions
      .map(
        (s) =>
          `Intent: ${s.declaredIntent}, App: ${s.appOpened}, Interventions: ${s.interventions?.length || 0}`,
      )
      .join(' | ');

    // 4. Build RAG prompt
    const systemPrompt =
      'You are a gentle digital wellbeing coach. Be concise, non-judgmental, and specific. Max 2 sentences.';
    
    let userPrompt = `User intended to ${session.declaredIntent} on ${session.appOpened}.\n`;
    if (session.pageTitle) {
      userPrompt += `They are currently viewing content titled: "${session.pageTitle}"`;
      if (session.pageCategory) {
        userPrompt += ` (Category: ${session.pageCategory})`;
      }
      userPrompt += `.\n`;
    }
    userPrompt += `Current autopilot score: ${score}/100.\n`;
    userPrompt += `Past similar sessions led to: ${pastOutcomes || 'No past sessions'}.\n`;
    userPrompt += `Generate a contextual nudge.`;

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
      this.logger.error(`Groq API failed using model ${modelToUse}, using fallback message`, error);
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
    await redis.publish('interventions', JSON.stringify({
      userId: session.userId,
      intervention
    }));

    return intervention;
  }
}
