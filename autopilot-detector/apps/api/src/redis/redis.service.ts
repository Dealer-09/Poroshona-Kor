import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly redisClient: Redis;

  constructor(private configService: ConfigService) {
    const redisUrl =
      this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.redisClient = new Redis(redisUrl);
  }

  onModuleInit() {
    this.redisClient.on('connect', () => {
      console.log('Redis connected successfully.');
    });
    this.redisClient.on('error', (err) => {
      console.error('Redis connection error:', err);
    });
  }

  onModuleDestroy() {
    this.redisClient.disconnect();
  }

  getClient(): Redis {
    return this.redisClient;
  }
}
