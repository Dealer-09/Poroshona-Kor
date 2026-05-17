import { Controller, Get, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SessionsService } from './sessions.service';

@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get('current')
  async getCurrentSession(@Req() req: any) {
    return this.sessionsService.getCurrentSession(req.user.id);
  }

  @Get(':id/scores')
  async getSessionScores(@Param('id') id: string) {
    return this.sessionsService.getSessionScores(id);
  }
}
