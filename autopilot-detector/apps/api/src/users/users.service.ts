import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, createdAt: true, groqApiKey: true },
    });
    // Mask key for display: show last 4 chars only
    const maskedKey = user?.groqApiKey
      ? `****${user.groqApiKey.slice(-4)}`
      : null;
    return { email: user?.email, createdAt: user?.createdAt, hasGroqKey: !!user?.groqApiKey, maskedKey };
  }

  async updateGroqApiKey(userId: string, apiKey: string | null) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { groqApiKey: apiKey },
    });
    return { success: true };
  }

  /** Internal use only — returns the raw key for the classification service */
  async getRawGroqApiKey(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { groqApiKey: true },
    });
    return user?.groqApiKey ?? null;
  }
}
