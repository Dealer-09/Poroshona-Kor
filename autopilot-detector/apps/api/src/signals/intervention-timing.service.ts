import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { BehavioralSignal } from '@autopilot/shared';
import { Session } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class InterventionTimingService {
  private readonly logger = new Logger(InterventionTimingService.name);

  constructor(
    private readonly redisService: RedisService,
    @InjectQueue('ai-intervention') private aiQueue: Queue,
  ) {}

  async evaluateAndTrigger(
    session: Session,
    score: number,
    signals: BehavioralSignal[],
  ): Promise<boolean> {
    const userId = session.userId;
    const redis = this.redisService.getClient();
    const lastInterventionKey = `user:${userId}:lastIntervention`;
    const lastTimestamp = await redis.get(lastInterventionKey);

    const now = new Date();

    // 1. Cooldown check (Set to 15 minutes to prevent spamming the user)
    if (lastTimestamp) {
      const diffSeconds = (now.getTime() - parseInt(lastTimestamp, 10)) / 1000;
      if (diffSeconds < 15 * 60) {
        this.logger.debug(
          `Cooldown active for user ${userId} (${diffSeconds.toFixed(1)}s elapsed). Skipping intervention.`,
        );
        return false;
      }
    }

    // Stage 2: Pomodoro break guard — no interventions during a break
    const isInPomodoroBreak = signals.some((s) => s.isPomodoroBreak === true);
    if (isInPomodoroBreak) {
      this.logger.debug(
        `User ${userId} is in a Pomodoro break. Skipping intervention.`,
      );
      return false;
    }

    // 2. Active typing guard
    // Check if activeTime is dominant in the last 30 seconds (last 3 batches if each is 10s)
    const recentSignals = signals.slice(-3);

    const recentActive = recentSignals.reduce(
      (acc, s) => acc + s.activeTime,
      0,
    );
    const recentPassive = recentSignals.reduce(
      (acc, s) => acc + s.passiveTime,
      0,
    );
    if (recentSignals.length > 0 && recentActive > recentPassive * 2) {
      this.logger.debug(
        `User ${userId} is actively typing. Skipping intervention.`,
      );
      return false;
    }

    let shouldTrigger = false;

    // Stage 2: Passive mode guard — PASSIVE sessions only get nudge-level interventions
    // No overlays (PAUSE, REFLECTION, SLEEP_MODE) in silent tracking mode
    const isPassiveSession = session.declaredIntent === 'PASSIVE';

    // 3. Evaluation logic
    const currentHour = now.getHours();
    const isLateNight = currentHour >= 23 || currentHour < 6;
    const sessionDurationMinutes =
      (now.getTime() - session.startedAt.getTime()) / 60000;

    // Track 60+ crossings
    const crossingKey = `session:${session.id}:crossings`;

    if (isPassiveSession) {
      // Passive mode: only trigger a gentle NUDGE for very high scores (>70), no overlays
      if (score > 70) {
        const todayNudgeKey = `user:${userId}:nudge:${now.toISOString().split('T')[0]}`;
        const hasNudgedToday = await redis.get(todayNudgeKey);
        if (!hasNudgedToday) {
          shouldTrigger = true;
          await redis.set(todayNudgeKey, '1', 'EX', 86400);
        }
      }
    } else {
      if (isLateNight && score > 50) {
        shouldTrigger = true; // SLEEP_MODE
      } else if (score > 85 || sessionDurationMinutes > 90) {
        shouldTrigger = true; // REFLECTION
      } else if (score > 75) {
        shouldTrigger = true; // PAUSE
      } else if (score > 60) {
        const crossings = await redis.incr(crossingKey);
        // ponytail: set TTL so orphaned keys don't accumulate forever
        await redis.expire(crossingKey, 90000); // 25 hours
        if (crossings >= 3) {
          shouldTrigger = true; // PAUSE (upgrade)
        } else {
          // NUDGE
          // Check if first time today
          const todayNudgeKey = `user:${userId}:nudge:${now.toISOString().split('T')[0]}`;
          const hasNudgedToday = await redis.get(todayNudgeKey);
          if (!hasNudgedToday) {
            shouldTrigger = true;
            await redis.set(todayNudgeKey, '1', 'EX', 86400); // Expire in 1 day
          }
        }
      }
    }

    if (shouldTrigger) {
      this.logger.log(
        `Triggering intervention for session ${session.id} with score ${score}`,
      );

      // Immediately set the cooldown in Redis to prevent spamming while the AI queue processes
      await redis.set(lastInterventionKey, now.getTime().toString(), 'EX', 15 * 60);

      // Enqueue to AI service for generating the actual message and saving
      await this.aiQueue.add('generate-intervention', {
        sessionId: session.id,
        score,
        signals,
      });
      return true;
    }

    return false;
  }
}
