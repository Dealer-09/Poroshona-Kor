import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiChatService } from './ai-chat.service';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly chatService: AiChatService) {}

  @Post('chat')
  async chat(
    @Request() req: { user: { id: string } },
    @Body() body: { message: string },
  ) {
    const response = await this.chatService.generateReflection(
      req.user.id,
      body.message,
    );
    return { response };
  }

  @Get('daily-summary')
  async getDailySummary(@Request() req: { user: { id: string } }) {
    const summary = await this.chatService.generateDailySummary(req.user.id);
    return { summary };
  }
}
