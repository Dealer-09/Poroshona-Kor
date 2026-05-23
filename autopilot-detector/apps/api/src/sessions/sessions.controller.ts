import { Controller, Get, Patch, Param, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SessionsService } from './sessions.service';

import { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
  };
}

@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  async getAllSessions(@Req() req: AuthenticatedRequest) {
    return this.sessionsService.getAllSessions(req.user.id);
  }

  @Get('current')
  async getCurrentSession(@Req() req: AuthenticatedRequest) {
    return this.sessionsService.getCurrentSession(req.user.id);
  }

  @Get(':id/scores')
  async getSessionScores(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.sessionsService.getSessionScores(id, req.user.id);
  }

  // Stage 2: Save post-session mood rating
  @Patch(':id/mood')
  async saveMood(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { moodRating: number },
  ) {
    return this.sessionsService.saveMoodRating(id, req.user.id, body.moodRating);
  }
}

