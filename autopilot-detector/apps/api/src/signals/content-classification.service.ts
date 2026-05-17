import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import { AppIntent } from '@autopilot/shared';

export type ContentType =
  | 'lecture' // educational video (MIT lecture, Khan Academy, Coursera)
  | 'tutorial' // how-to / coding tutorial
  | 'reading' // article, docs, wikipedia — requires slow scrolling to engage
  | 'entertainment' // movie, TV show, non-educational video
  | 'gaming' // gaming stream, gameplay video
  | 'social' // social media feed, news feed
  | 'unknown';

export interface ContentClassification {
  isRelevantToIntent: boolean;
  contentType: ContentType;
  reason: string;
  confidence: number;
  aiPowered: boolean; // true when Groq was called, false when keyword-only
}

// Keyword-based fast-path — no API token needed
const LECTURE_KEYWORDS = [
  'lecture',
  'course',
  'lesson',
  'class',
  'tutorial',
  'mit opencourseware',
  'stanford',
  'coursera',
  'edx',
  'khan academy',
  'crash course',
  'explained',
  'introduction to',
  'how to',
  'learn ',
  'university',
  'academic',
  ' 101',
  'programming',
  'algorithm',
  'data structure',
  'calculus',
  'physics',
  'chemistry',
  'biology',
  'mathematics',
  'machine learning',
  'deep learning',
  'lecture notes',
  'study guide',
  'exam prep',
];

const ENTERTAINMENT_KEYWORDS = [
  'funny',
  'meme',
  'prank',
  'challenge',
  'vlog',
  'reaction',
  'highlights',
  'compilation',
  'best moments',
  'trailer',
  'movie',
  'series',
  'episode',
  'music video',
  'song',
  'roast',
  'drama',
  'exposed',
  'celebrity',
];

const GAMING_KEYWORDS = [
  'gameplay',
  "let's play",
  'playthrough',
  'gaming',
  'gta',
  'minecraft',
  'fortnite',
  'valorant',
  'cod',
  'call of duty',
  'esports',
  'speedrun',
  'no commentary',
  'game review',
  'game trailer',
];

function quickClassify(title: string, domain: string): ContentType | null {
  const lower = title.toLowerCase();
  if (GAMING_KEYWORDS.some((k) => lower.includes(k))) return 'gaming';
  if (ENTERTAINMENT_KEYWORDS.some((k) => lower.includes(k)))
    return 'entertainment';
  if (LECTURE_KEYWORDS.some((k) => lower.includes(k))) return 'lecture';

  if (
    domain.includes('wikipedia.org') ||
    domain.includes('docs.') ||
    domain.includes('stackoverflow.com') ||
    domain.includes('github.com') ||
    domain.includes('medium.com') ||
    domain.includes('dev.to') ||
    domain.includes('arxiv.org')
  ) {
    return 'reading';
  }

  return null; // needs AI (or no key → unknown)
}

@Injectable()
export class ContentClassificationService {
  private readonly logger = new Logger(ContentClassificationService.name);
  private readonly serverGroqKey: string | undefined;
  // In-memory cache: key = `${title}::${domain}::${intent}`, value = classification
  private cache = new Map<string, ContentClassification>();

  constructor(private readonly configService: ConfigService) {
    this.serverGroqKey = this.configService.get<string>('GROQ_API_KEY');
  }

  /**
   * Classify the content the user is currently viewing.
   *
   * @param title         Active tab title
   * @param domain        Active tab hostname (e.g. youtube.com)
   * @param intent        User's declared session intent
   * @param userGroqKey   Optional personal Groq API key from user settings.
   *                      If omitted AND no server key exists, falls back to keyword-only.
   */
  async classify(
    title: string,
    domain: string,
    intent: AppIntent,
    userGroqKey?: string | null,
  ): Promise<ContentClassification> {
    const cacheKey = `${title.slice(0, 80)}::${domain}::${intent}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // LRU Eviction: prevent infinite memory leak
    if (this.cache.size > 1000) {
      const firstKey = Array.from(this.cache.keys())[0];
      if (firstKey) this.cache.delete(firstKey);
    }

    // 1. Try keyword-based classification first (instant, zero cost)
    const quickType = quickClassify(title, domain);
    if (quickType !== null) {
      const result = this.buildResult(
        quickType,
        intent,
        0.85,
        'keyword-match',
        false,
      );
      this.cache.set(cacheKey, result);
      return result;
    }

    // 2. Determine which API key to use
    //    Priority: user's own key > server key > none (keyword fallback only)
    const activeKey = userGroqKey || this.serverGroqKey;

    if (!activeKey) {
      // No AI available — return "unknown" so the score service falls back to domain rules
      const fallback = this.buildResult(
        'unknown',
        intent,
        0.3,
        'no-api-key-fallback',
        false,
      );
      this.cache.set(cacheKey, fallback);
      this.logger.debug(
        `No Groq key available for "${title}" — using keyword-only fallback`,
      );
      return fallback;
    }

    // 3. Call Groq with the available key
    try {
      const groq = new Groq({ apiKey: activeKey });
      const completion = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        max_tokens: 80,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You are a content classifier. Respond ONLY with valid JSON — no markdown, no explanation. Schema: {"contentType":"lecture"|"tutorial"|"reading"|"entertainment"|"gaming"|"social"|"unknown","isRelevantToIntent":true|false,"confidence":0.0-1.0}',
          },
          {
            role: 'user',
            content: `Tab title: "${title}"\nDomain: "${domain}"\nUser declared intent: "${intent}"\n\nClassify the content type and whether it is relevant to the user's intent.`,
          },
        ],
      });

      const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
      const parsed = JSON.parse(raw) as Partial<ContentClassification>;

      const result: ContentClassification = {
        contentType: parsed.contentType ?? 'unknown',
        isRelevantToIntent: parsed.isRelevantToIntent ?? false,
        confidence: parsed.confidence ?? 0.5,
        reason: 'llm-classification',
        aiPowered: true,
      };

      this.cache.set(cacheKey, result);
      this.logger.debug(
        `[AI] "${title}" → ${result.contentType} (relevant: ${result.isRelevantToIntent}, key: ${userGroqKey ? 'user' : 'server'})`,
      );
      return result;
    } catch (err) {
      this.logger.warn(`Groq classification failed for "${title}": ${err}`);
      const fallback = this.buildResult(
        'unknown',
        intent,
        0.3,
        'llm-error-fallback',
        false,
      );
      return fallback;
    }
  }

  private buildResult(
    contentType: ContentType,
    intent: AppIntent,
    confidence: number,
    reason: string,
    aiPowered: boolean,
  ): ContentClassification {
    const studyRelevantTypes: ContentType[] = [
      'lecture',
      'tutorial',
      'reading',
    ];
    const isRelevantToIntent =
      (intent === AppIntent.STUDY || intent === AppIntent.TUTORIAL) &&
      studyRelevantTypes.includes(contentType);

    return { contentType, isRelevantToIntent, confidence, reason, aiPowered };
  }
}
