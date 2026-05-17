import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { AiChatService } from './ai-chat.service';
import { AiController } from './ai.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [AiController],
  providers: [EmbeddingService, AiChatService],
  exports: [EmbeddingService, AiChatService],
})
export class AiModule {}

