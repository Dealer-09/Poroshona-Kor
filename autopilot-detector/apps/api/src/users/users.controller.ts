import { Controller, Get, Put, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from './users.service';
import { IsOptional, IsString } from 'class-validator';

class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  groqApiKey?: string | null;

  @IsOptional()
  @IsString()
  geminiApiKey?: string | null;
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('settings')
  getSettings(@Request() req: { user: { id: string } }) {
    return this.usersService.getSettings(req.user.id);
  }

  @Put('settings')
  updateSettings(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.usersService.updateSettings(
      req.user.id,
      dto,
    );
  }
}
