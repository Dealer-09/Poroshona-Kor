import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [EmbeddingService],
  exports: [EmbeddingService],
})
export class AiModule {}
