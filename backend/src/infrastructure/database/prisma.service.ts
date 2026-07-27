import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnApplicationShutdown
{
  async ping(): Promise<void> {
    await this.$queryRawUnsafe("SELECT 1");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
