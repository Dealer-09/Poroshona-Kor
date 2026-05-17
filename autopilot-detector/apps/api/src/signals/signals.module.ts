import { Module } from '@nestjs/common';
import { SignalsGateway } from './signals.gateway';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [AuthModule, PrismaModule, RedisModule],
  providers: [SignalsGateway],
})
export class SignalsModule {}
