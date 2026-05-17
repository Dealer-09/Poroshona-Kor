import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, createdAt: true, groqApiKey: true, geminiApiKey: true },
    });
    // Mask keys for display
    const maskedGroqKey = user?.groqApiKey ? `****${user.groqApiKey.slice(-4)}` : null;
    const maskedGeminiKey = user?.geminiApiKey ? `****${user.geminiApiKey.slice(-4)}` : null;

    return { 
      email: user?.email, 
      createdAt: user?.createdAt, 
      hasGroqKey: !!user?.groqApiKey, 
      maskedGroqKey,
      hasGeminiKey: !!user?.geminiApiKey,
      maskedGeminiKey 
    };
  }

  async updateSettings(userId: string, data: { groqApiKey?: string | null, geminiApiKey?: string | null }) {
    await this.prisma.user.update({
      where: { id: userId },
      data,
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

  async getRawGeminiApiKey(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { geminiApiKey: true },
    });
    return user?.geminiApiKey ?? null;
  }
}

