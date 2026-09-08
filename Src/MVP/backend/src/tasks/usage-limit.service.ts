import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import {
  UsageCounter,
  UsageCounterDocument,
} from './schemas/usage-counter.schema';
import { AppException } from '../common/exceptions/app.exception';

// RF.66 — one Task started counts as one, per user, per calendar month,
// checked inside POST /tasks before anything is persisted. Deliberately
// increment-first-then-roll-back rather than read-then-write: the schema's
// own comment already settled on $inc + upsert as the primitive that keeps
// two concurrent requests from reading the same count and losing an
// increment. A conditional filter (count <= cap - batchSize) combined with
// upsert would silently let a brand-new user's first, oversized batch
// through — there'd be no existing document for the filter to compare
// against — so the cap is enforced by checking the result and undoing the
// increment if it overshot, not by trying to make the increment itself
// conditional.
@Injectable()
export class UsageLimitService {
  constructor(
    @InjectModel(UsageCounter.name)
    private readonly usageCounterModel: Model<UsageCounterDocument>,
    private readonly config: ConfigService,
  ) {}

  async checkAndIncrement(userId: string, taskCount: number): Promise<void> {
    const yearMonth = this.currentYearMonth();
    const limit = this.config.get<number>('MONTHLY_TASK_LIMIT')!;

    const updated = await this.usageCounterModel.findOneAndUpdate(
      { userId, yearMonth },
      { $inc: { count: taskCount } },
      { upsert: true, new: true },
    );

    if (updated.count > limit) {
      // Compensate: this request doesn't get to keep the quota it just
      // reserved, since it's being rejected outright, not partially
      // accepted — no Task from this batch is ever created.
      await this.usageCounterModel.updateOne(
        { userId, yearMonth },
        { $inc: { count: -taskCount } },
      );
      throw new AppException(
        'USAGE_LIMIT_EXCEEDED',
        `Monthly task limit of ${limit} exceeded`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private currentYearMonth(): string {
    return new Date().toISOString().slice(0, 7);
  }
}
