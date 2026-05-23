import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  // In production, this MUST come from an environment variable (32 bytes)
  private readonly algorithm = 'aes-256-gcm';
  private readonly secretKey = process.env.ENCRYPTION_SECRET as string;

  constructor(private readonly prisma: PrismaService) {}

  private encrypt(text: string): string {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(
        this.algorithm,
        Buffer.from(this.secretKey),
        iv,
      );
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag().toString('hex');
      // Format: iv:authTag:encryptedText
      return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (e) {
      this.logger.error('Encryption failed', e);
      throw new Error('Encryption failed');
    }
  }

  private decrypt(hash: string): string {
    if (!hash || !hash.includes(':')) return hash; // Fallback for legacy plain text keys
    try {
      const parts = hash.split(':');
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encryptedText = parts[2];
      const decipher = crypto.createDecipheriv(
        this.algorithm,
        Buffer.from(this.secretKey),
        iv,
      );
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (e) {
      this.logger.error('Decryption failed', e);
      return ''; // Return empty string if decryption fails (e.g., secret changed)
    }
  }

  async getSettings(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        createdAt: true,
        groqApiKey: true,
        geminiApiKey: true,
      },
    });

    // Decrypt to compute the mask accurately
    const rawGroq = user?.groqApiKey ? this.decrypt(user.groqApiKey) : null;
    const rawGemini = user?.geminiApiKey
      ? this.decrypt(user.geminiApiKey)
      : null;

    const maskedGroqKey = rawGroq ? `****${rawGroq.slice(-4)}` : null;
    const maskedGeminiKey = rawGemini ? `****${rawGemini.slice(-4)}` : null;

    return {
      email: user?.email,
      createdAt: user?.createdAt,
      hasGroqKey: !!user?.groqApiKey,
      maskedGroqKey,
      hasGeminiKey: !!user?.geminiApiKey,
      maskedGeminiKey,
    };
  }

  async updateSettings(
    userId: string,
    data: { groqApiKey?: string | null; geminiApiKey?: string | null },
  ) {
    const updateData: {
      groqApiKey?: string | null;
      geminiApiKey?: string | null;
    } = {};
    if (data.groqApiKey !== undefined) {
      updateData.groqApiKey = data.groqApiKey
        ? this.encrypt(data.groqApiKey)
        : null;
    }
    if (data.geminiApiKey !== undefined) {
      updateData.geminiApiKey = data.geminiApiKey
        ? this.encrypt(data.geminiApiKey)
        : null;
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });
    return { success: true };
  }

  /** Internal use only — returns the raw key for the classification service */
  async getRawGroqApiKey(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { groqApiKey: true },
    });
    return user?.groqApiKey ? this.decrypt(user.groqApiKey) : null;
  }

  async getRawGeminiApiKey(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { geminiApiKey: true },
    });
    return user?.geminiApiKey ? this.decrypt(user.geminiApiKey) : null;
  }
}
