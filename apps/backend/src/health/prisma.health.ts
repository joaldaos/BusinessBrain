import { Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicatorResult,
  HealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        'PostgreSQL no responde',
        this.getStatus(key, false, { error: (error as Error).message }),
      );
    }
  }
}
