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
import { UsePipes, ValidationPipe, ParseArrayPipe } from '@nestjs/common';
import { StartSessionDto, BehavioralSignalDto } from './dto/signals.dto';

@WebSocketGateway({ cors: true })
export class SignalsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token || client.handshake.headers.authorization?.split(' ')[1];
      if (!token) {
        client.disconnect();
        return;
      }
      
      const decoded = this.jwtService.verify(token);
      client.data.user = decoded;
    } catch (error) {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    // cleanup on disconnect
  }

  @SubscribeMessage('session:start')
  @UsePipes(new ValidationPipe({ transform: true }))
  async handleSessionStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: StartSessionDto,
  ) {
    const userId = client.data.user?.sub;
    if (!userId) return;

    const session = await this.prisma.session.create({
      data: {
        userId,
        appOpened: payload.appOpened,
        declaredIntent: payload.declaredIntent,
      },
    });

    client.emit('session:created', { sessionId: session.id });
  }

  @SubscribeMessage('session:end')
  async handleSessionEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string },
  ) {
    const userId = client.data.user?.sub;
    if (!userId) return;

    await this.prisma.session.update({
      where: { id: payload.sessionId },
      data: { endedAt: new Date() },
    });

    client.emit('session:ended', { sessionId: payload.sessionId });
  }

  @SubscribeMessage('signal:batch')
  @UsePipes(new ValidationPipe({ transform: true }))
  async handleSignalBatch(
    @ConnectedSocket() client: Socket,
    @MessageBody(new ParseArrayPipe({ items: BehavioralSignalDto })) signals: BehavioralSignalDto[],
  ) {
    if (!signals || signals.length === 0) return;
    
    const sessionId = signals[0].sessionId;
    if (!sessionId) return;

    const key = `session:${sessionId}:signals`;
    const redis = this.redisService.getClient();

    const signalStrings = signals.map(s => JSON.stringify(s));
    
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
  }
}
