import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { SignalsModule } from './signals/signals.module';
import { SessionsModule } from './sessions/sessions.module';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { QueuesModule } from './queues/queues.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { AiModule } from './ai/ai.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          url: configService.get<string>('REDIS_URL'),
        },
      }),
    }),
    // BullBoard exposes raw queue job payloads (sessionIds, signal streams) with
    // no auth, so only mount the dashboard when explicitly enabled (e.g. local
    // dev). In production leave ENABLE_BULL_BOARD unset.
    ...(process.env.ENABLE_BULL_BOARD === 'true'
      ? [
          BullBoardModule.forRoot({
            route: '/admin/queues',
            adapter: ExpressAdapter,
          }),
        ]
      : []),
    PrismaModule,
    RedisModule,
    AuthModule,
    SignalsModule,
    SessionsModule,
    QueuesModule,
    AnalyticsModule,
    AiModule,
    UsersModule,
  ],
})
export class AppModule {}
