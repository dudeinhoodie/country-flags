import { Module } from "@nestjs/common";

import { Fsrs6SchedulerAdapter } from "./fsrs6-scheduler.adapter";

@Module({
  providers: [Fsrs6SchedulerAdapter],
  exports: [Fsrs6SchedulerAdapter],
})
export class SchedulerModule {}
