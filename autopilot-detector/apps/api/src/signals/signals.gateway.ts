import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  UsePipes,
  ValidationPipe,
  ParseArrayPipe,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { StartSessionDto, BehavioralSignalDto } from './dto/signals.dto';
import { AutopilotScoreService } from './autopilot-score.service';
import { InterventionTimingService } from './intervention-timing.service';
import {
  ContentClassificationService,
  ContentClassification,
} from './content-classification.service';
import { UsersService } from '../users/users.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AppIntent, OnsetPrediction } from '@autopilot/shared';
import {
  PredictionService,
  PredictionFeature,
} from '../prediction/prediction.service';

interface JwtPayload {
  sub: string;
  email: string;
}

@WebSocketGateway({ cors: true })
export class SignalsGateway
  implements
    OnGatewayConnection,
    OnModuleInit,
    OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SignalsGateway.name);

  // Dedicated Redis connection for pub/sub (a subscriber connection cannot also
  // issue normal commands). Stored so it can be closed on shutdown.
  private interventionSubscriber: ReturnType<RedisService['getClient']> | null =
    null;

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private redisService: RedisService,
    private scoreService: AutopilotScoreService,
    private timingService: InterventionTimingService,
    private classificationService: ContentClassificationService,
    private usersService: UsersService,
    private predictionService: PredictionService,
    @InjectQueue('embedding') private embeddingQueue: Queue,
  ) {}

  async onModuleInit() {
    const subscriber = this.redisService.getClient().duplicate();
    this.interventionSubscriber = subscriber;
    await subscriber.subscribe('interventions');
    subscriber.on('message', (channel, message) => {
      this.logger.debug(`[RedisSub] message on channel "${channel}"`);
      if (channel === 'interventions') {
        try {
          const payload = JSON.parse(message) as {
            userId: string;
            intervention: any;
          };
          this.logger.debug(
            `[RedisSub] emitting intervention:trigger to room user:${payload.userId}`,
          );
          this.server
            .to(`user:${payload.userId}`)
            .emit('intervention:trigger', payload.intervention);
        } catch (e) {
          this.logger.error('Failed to parse intervention message', e as Error);
        }
      }
    });
  }

  async onModuleDestroy() {
    // Close the dedicated subscriber connection so it doesn't leak across
    // shutdowns / dev hot-reloads (it was previously a local const, never closed).
    if (this.interventionSubscriber) {
      try {
        await this.interventionSubscriber.quit();
      } catch {
        this.interventionSubscriber.disconnect();
      }
      this.interventionSubscriber = null;
    }
  }

  handleConnection(client: Socket) {
    try {
      const auth = client.handshake.auth as Record<string, unknown> | undefined;
      const token =
        (auth?.token as string | undefined) ||
        client.handshake.headers.authorization?.split(' ')[1];
      if (!token) {
        client.disconnect();
        return;
      }

      const decoded = this.jwtService.verify<JwtPayload>(token);
      const clientData = client.data as { user?: JwtPayload };
      clientData.user = decoded;

      // Join user-specific room
      this.logger.debug(
        `Client connected: ${client.id}, joining room user:${decoded.sub}`,
      );
      void client.join(`user:${decoded.sub}`);
    } catch (e: any) {
      this.logger.warn(`Connection auth failed: ${e.message}`);
      client.disconnect();
    }
  }


  @SubscribeMessage('session:start')
  @UsePipes(new ValidationPipe({ transform: true }))
  async handleSessionStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: StartSessionDto,
  ) {
    const clientData = client.data as { user?: JwtPayload };
    const user = clientData.user;
    const userId = user?.sub;
    if (!userId) return;

    const session = await this.prisma.session.create({
      data: {
        userId,
        appOpened: payload.appOpened,
        declaredIntent: payload.declaredIntent,
      },
    });

    this.logger.debug(`New session started, intent: ${payload.declaredIntent}`);
    this.server
      .to(`user:${userId}`)
      .emit('session:created', { sessionId: session.id });
  }

  @SubscribeMessage('session:metadata')
  async handleSessionMetadata(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: { sessionId: string; pageTitle?: string; pageCategory?: string },
  ) {
    const clientData = client.data as { user?: JwtPayload };
    const userId = clientData.user?.sub;
    if (!userId) return;

    // Ownership-scoped update: updateMany with {id, userId} so a client cannot
    // mutate another user's session by guessing its id (IDOR). count===0 means
    // the session isn't theirs (or doesn't exist) — silently ignore.
    await this.prisma.session.updateMany({
      where: { id: payload.sessionId, userId },
      data: {
        pageTitle: payload.pageTitle,
        pageCategory: payload.pageCategory,
      },
    });
  }

  @SubscribeMessage('session:end')
  async handleSessionEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string },
  ) {
    const clientData = client.data as { user?: JwtPayload };
    const user = clientData.user;
    const userId = user?.sub;
    if (!userId) return;

    // Ownership-scoped: only end a session that belongs to the caller.
    const { count } = await this.prisma.session.updateMany({
      where: { id: payload.sessionId, userId },
      data: { endedAt: new Date() },
    });
    if (count === 0) {
      // Not the caller's session (or already gone) — do not touch Redis/queues.
      return;
    }

    // Cleanup Redis memory, but leave it alive for 5 minutes (300s)
    // so the EmbeddingProcessor (BullMQ worker) has time to read the signals!
    const redis = this.redisService.getClient();
    const key = `session:${payload.sessionId}:signals`;
    const batchCountKey = `session:${payload.sessionId}:batchCount`;
    await redis.expire(key, 300);
    await redis.expire(batchCountKey, 300);

    await this.embeddingQueue.add('generate-embedding', {
      sessionId: payload.sessionId,
    });

    this.server
      .to(`user:${userId}`)
      .emit('session:ended', { sessionId: payload.sessionId });
  }

  @SubscribeMessage('signal:batch')
  @UsePipes(new ValidationPipe({ transform: true }))
  async handleSignalBatch(
    @ConnectedSocket() client: Socket,
    @MessageBody(new ParseArrayPipe({ items: BehavioralSignalDto }))
    signals: BehavioralSignalDto[],
  ) {
    if (!signals || signals.length === 0) return;

    const sessionId = signals[0].sessionId;
    if (!sessionId) return;

    const clientData = client.data as {
      user?: JwtPayload;
      ownedSessions?: Set<string>;
    };
    const userId = clientData.user?.sub;
    if (!userId) return;

    // --- Ownership check (IDOR guard) ---
    // signals[0].sessionId is client-supplied; verify the session belongs to the
    // authenticated user before writing ANY data under it. Cache verified session
    // ids on the socket so we don't re-query the DB on every 4s batch.
    if (!clientData.ownedSessions) clientData.ownedSessions = new Set();
    if (!clientData.ownedSessions.has(sessionId)) {
      const owned = await this.prisma.session.findFirst({
        where: { id: sessionId, userId },
        select: { id: true },
      });
      if (!owned) {
        // Not the caller's session — drop the batch silently (no buffer, no score).
        return;
      }
      clientData.ownedSessions.add(sessionId);
    }

    const key = `session:${sessionId}:signals`;
    const redis = this.redisService.getClient();

    const signalStrings = signals.map((s) => JSON.stringify(s));

    // IMPORTANT: check current buffer length — if >= 100, drop the oldest 20 entries first (LTRIM)
    const currentLen = await redis.llen(key);

    if (currentLen >= 100) {
      // Remove oldest 20 entries by keeping from index 20 to the end
      await redis.ltrim(key, 20, -1);
    }

    // Store in Redis as a rolling buffer
    await redis.rpush(key, ...signalStrings);

    // Failsafe to guarantee max length is strictly bound to 100
    // even if the batch itself was very large
    await redis.ltrim(key, -100, -1);
    await redis.expire(key, 86400); // 24 hours fallback TTL

    // Batch counting and heuristic score calculation
    const batchCountKey = `session:${sessionId}:batchCount`;
    const batchCount = await redis.incr(batchCountKey);
    await redis.expire(batchCountKey, 86400); // 24 hours fallback TTL

    // --- Phase 1: durable per-timestep event store (ML training data) ---
    // Persist every incoming signal as a SessionEvent. The Redis buffer is the
    // hot, capped, TTL-bound working memory; SessionEvent is the permanent
    // sequence record the prediction model learns from. Best-effort: never let a
    // persistence hiccup break the live scoring path.
    void this.persistSessionEvents(sessionId, signals).catch((e) =>
      this.logger.error('Failed to persist SessionEvents', e as Error),
    );

    // Calculate score every 6 batches (~24 seconds at the extension's ~4s batch interval)
    // This prevents hammering the database and the AI Classification API
    if (batchCount % 6 === 0) {
      const rawSignals = await redis.lrange(key, 0, -1);
      const parsedSignals = rawSignals.map(
        (s) => JSON.parse(s) as BehavioralSignalDto,
      );

      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
      });

      const sessionIntent = session?.declaredIntent as string as AppIntent;

      // Grab the dominant tab title from the most recent signal in the batch
      const latestTitle =
        parsedSignals[parsedSignals.length - 1]?.activeTabTitle ?? '';
      const latestDomain =
        parsedSignals[parsedSignals.length - 1]?.activeDomain ?? '';

      // Run AI classification only when session has an intent and we have a title
      let classification: ContentClassification | undefined = undefined;
      if (sessionIntent && latestTitle) {
        const userGroqKey = await this.usersService.getRawGroqApiKey(userId);
        classification = await this.classificationService.classify(
          latestTitle,
          latestDomain,
          sessionIntent,
          userGroqKey,
        );
      }

      const autopilotScore = this.scoreService.computeScore(
        parsedSignals,
        sessionIntent,
        classification,
      );
      autopilotScore.sessionId = sessionId;

      await this.prisma.autopilotScore.create({
        data: {
          sessionId,
          score: autopilotScore.score,
          focusFragmentation: autopilotScore.focusFragmentation,
          passiveRatio: autopilotScore.passiveRatio,
          cognitiveDrift: autopilotScore.cognitiveDrift,
          doomscrollProbability: autopilotScore.doomscrollProbability,
          timestamp: new Date(autopilotScore.timestamp),
        },
      });

      // Record the latest drift so per-event persistence can stamp `runningDrift`
      // onto subsequent SessionEvents (a model feature). TTL mirrors the buffer.
      await redis.set(
        `session:${sessionId}:lastScore`,
        String(autopilotScore.score),
        'EX',
        86400,
      );

      this.server.to(`user:${userId}`).emit('score:update', autopilotScore);
      this.logger.debug(`Live score computed: ${autopilotScore.score}`);

      // --- Phase 2: forward-looking onset prediction ---
      // Build a recent feature window and ask the PredictionService for the
      // probability of doomscroll onset within the next 5 minutes, then push it
      // to the client as a distinct `prediction:risk` event.
      try {
        const window = await this.buildPredictionWindow(sessionId);
        if (window.length > 0) {
          const prediction = await this.predictionService.predictOnset(window);
          const payload: OnsetPrediction = {
            sessionId,
            probability: prediction.probability,
            horizonMinutes: prediction.horizonMinutes,
            source: prediction.source,
            timestamp: new Date().toISOString(),
          };
          this.server.to(`user:${userId}`).emit('prediction:risk', payload);

          // Pre-emptive intervention: if onset is likely soon (and we're not in a
          // pomodoro break), fire an early NUDGE through the SAME cooldown-gated
          // path so it can't spam. This is the "catch you before it locks in" payoff.
          const inBreak = parsedSignals.some((s) => s.isPomodoroBreak === true);
          if (prediction.probability >= 0.7 && session && !inBreak) {
            await this.timingService.evaluateAndTrigger(
              session,
              // Treat a high-confidence prediction as at least NUDGE-worthy; use
              // the higher of the real score and a synthetic threshold so the
              // existing type-mapping still reacts proportionally.
              Math.max(autopilotScore.score, 55),
              parsedSignals,
            );
          }
        }
      } catch (e) {
        this.logger.error('Prediction step failed (non-fatal)', e as Error);
      }

      // Trigger AI Intervention job if score breaches the NUDGE threshold
      if (autopilotScore.score > 50 && session) {
        await this.timingService.evaluateAndTrigger(
          session,
          autopilotScore.score,
          parsedSignals,
        );
      }
    }
  }

  /**
   * Phase 1: persist a batch of raw signals as durable SessionEvent rows — the
   * per-timestep training sequence for the onset-prediction model. Derived
   * features (secondsSinceIntent, hourOfDay, runningDrift) are computed here.
   */
  private async persistSessionEvents(
    sessionId: string,
    signals: BehavioralSignalDto[],
  ): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { startedAt: true },
    });
    if (!session) return;

    const redis = this.redisService.getClient();
    const lastScoreRaw = await redis.get(`session:${sessionId}:lastScore`);
    const runningDrift = lastScoreRaw ? Number(lastScoreRaw) : 0;
    const startedMs = session.startedAt.getTime();

    const rows = signals.map((s) => {
      const ts = new Date(s.timestamp);
      return {
        sessionId,
        timestamp: ts,
        scrollVelocity: s.scrollVelocity,
        tabSwitchCount: Math.round(s.tabSwitchCount),
        clickRate: s.clickRate,
        passiveTime: s.passiveTime,
        activeTime: s.activeTime,
        scrollDepthPercent: s.scrollDepthPercent ?? null,
        pageResetCount: s.pageResetCount ?? null,
        activeDomain: s.activeDomain ?? null,
        secondsSinceIntent: Math.max(
          0,
          Math.round((ts.getTime() - startedMs) / 1000),
        ),
        hourOfDay: ts.getHours(),
        runningDrift,
        isPomodoroBreak: s.isPomodoroBreak ?? false,
      };
    });

    await this.prisma.sessionEvent.createMany({ data: rows });
  }

  /**
   * Phase 2: assemble the recent per-timestep feature window the PredictionService
   * consumes. Reads the durable SessionEvents (most recent N), oldest-first.
   */
  private async buildPredictionWindow(
    sessionId: string,
  ): Promise<PredictionFeature[]> {
    const events = await this.prisma.sessionEvent.findMany({
      where: { sessionId },
      orderBy: { timestamp: 'desc' },
      take: 30,
    });
    return events.reverse().map((e) => ({
      scrollVelocity: e.scrollVelocity,
      tabSwitchCount: e.tabSwitchCount,
      clickRate: e.clickRate,
      passiveTime: e.passiveTime,
      activeTime: e.activeTime,
      scrollDepthPercent: e.scrollDepthPercent ?? 0,
      pageResetCount: e.pageResetCount ?? 0,
      secondsSinceIntent: e.secondsSinceIntent,
      hourOfDay: e.hourOfDay,
      runningDrift: e.runningDrift,
    }));
  }
}
