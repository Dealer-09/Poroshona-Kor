import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);
  private readonly serverGroqKey: string | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
  ) {
    this.serverGroqKey = this.configService.get<string>('GROQ_API_KEY');
  }

  async generateReflection(userId: string, message: string): Promise<string> {
    const userGroqKey = await this.usersService.getRawGroqApiKey(userId);
    const activeKey = userGroqKey || this.serverGroqKey;

    if (!activeKey) {
      return "I'm sorry, I don't have an AI API key configured to respond right now. Please add one in Settings!";
    }

    // --- RAG INTEGRATION (Phase 3) ---
    // 1. Embed the user's question using Gemini
    let similarSessions: any[] = [];
    try {
      const queryEmbedding = await this.embeddingService.embedQuery(message, userId);
      // 2. Fetch the top 3 most similar past sessions using pgvector
      similarSessions = await this.embeddingService.findSimilarSessions(queryEmbedding, userId, 3);
    } catch (err) {
      this.logger.warn(`Failed to fetch RAG context: ${err}`);
    }

    // 3. Build the RAG Context Prompt
    let contextPrompt = '';
    if (similarSessions.length > 0) {
      contextPrompt = `\n\nHere are some relevant past sessions from this user for context (RAG Data):\n`;
      similarSessions.forEach((s, i) => {
        contextPrompt += `Session ${i + 1}: Intent was ${s.declaredIntent} on ${s.appOpened}. `;
        if (s.pageTitle) contextPrompt += `They watched/read "${s.pageTitle}". `;
        if (s.interventions && s.interventions.length > 0) {
          contextPrompt += `The system had to intervene with a ${s.interventions[0].type} nudge. `;
        }
        contextPrompt += `\n`;
      });
    } else {
      contextPrompt = `\n\nNo relevant past sessions found in the vector database.`;
    }

    try {
      const groq = new Groq({ apiKey: activeKey });
      const completion = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        max_tokens: 250,
        temperature: 0.7,
        messages: [
          {
            role: 'system',
            content: `You are the Digital Autopilot Coach. Your job is to help the user reflect on their digital habits, doomscrolling, and cognitive drift. Be concise, non-judgmental, and highly specific to the context provided. Limit responses to 2-3 short sentences.${contextPrompt}`,
          },
          {
            role: 'user',
            content: message,
          },
        ],
      });

      return completion.choices[0]?.message?.content?.trim() ?? "I'm here to help you reflect.";
    } catch (err) {
      this.logger.error(`Groq chat failed: ${err}`);
      return "I encountered an error connecting to my AI brain. Please try again later.";
    }
  }
}

