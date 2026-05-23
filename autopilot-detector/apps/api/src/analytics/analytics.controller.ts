import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('heatmap')
  async getWeeklyHeatmap(@Req() req: { user: { id: string } }) {
    return this.analyticsService.getWeeklyHeatmap(req.user.id);
  }

  // Stage 2: Mood × Drift correlation data for scatter chart
  @Get('mood-correlation')
  async getMoodCorrelation(@Req() req: { user: { id: string } }) {
    return this.analyticsService.getMoodCorrelation(req.user.id);
  }
}
