import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { UsePipes, ValidationPipe, ParseArrayPipe, OnModuleInit } from '@nestjs/common';
import { StartSessionDto, BehavioralSignalDto } from './dto/signals.dto';
import { AutopilotScoreService } from './autopilot-score.service';
import { InterventionTimingService } from './intervention-timing.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

interface JwtPayload {
  sub: string;
  email: string;
}

@WebSocketGateway({ cors: true })
export class SignalsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer()
  server: Server;

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private redisService: RedisService,
    private scoreService: AutopilotScoreService,
    private timingService: InterventionTimingService,
    @InjectQueue('embedding') private embeddingQueue: Queue,
  ) {}

  async onModuleInit() {
    const subscriber = this.redisService.getClient().duplicate();
    await subscriber.subscribe('interventions');
    subscriber.on('message', (channel, message) => {
      if (channel === 'interventions') {
        try {
          const payload = JSON.parse(message);
          this.server.to(`user:${payload.userId}`).emit('intervention:trigger', payload.intervention);
        } catch (e) {
          console.error('Failed to parse intervention message', e);
        }
      }
    });
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
      client.join(`user:${decoded.sub}`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect() {
    // cleanup on disconnect
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

    console.log(`🚀 New Session Started! Intent: ${payload.declaredIntent}`);
    client.emit('session:created', { sessionId: session.id });
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

    await this.prisma.session.update({
      where: { id: payload.sessionId },
      data: { endedAt: new Date() },
    });

    await this.embeddingQueue.add('generate-embedding', {
      sessionId: payload.sessionId,
    });

    client.emit('session:ended', { sessionId: payload.sessionId });
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

    // Batch counting and heuristic score calculation
    const batchCountKey = `session:${sessionId}:batchCount`;
    const batchCount = await redis.incr(batchCountKey);

    // Calculate score on EVERY batch for instant testing!
    if (batchCount % 1 === 0) {
      const rawSignals = await redis.lrange(key, 0, -1);
      const parsedSignals = rawSignals.map(
        (s) => JSON.parse(s) as BehavioralSignalDto,
      );

      const autopilotScore = this.scoreService.computeScore(parsedSignals);

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

      client.emit('score:update', autopilotScore);
      console.log(
        '📈 LIVE SCORE COMPUTED:',
        JSON.stringify(autopilotScore, null, 2),
      );

      // Trigger AI Intervention job if score breaches the NUDGE threshold (or SLEEP_MODE threshold)
      if (autopilotScore.score > 50) {
        const session = await this.prisma.session.findUnique({ where: { id: sessionId }});
        if (session) {
          await this.timingService.evaluateAndTrigger(session, autopilotScore.score, parsedSignals);
        }
      }
    }
  }
}
