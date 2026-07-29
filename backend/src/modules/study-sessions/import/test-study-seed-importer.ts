import {
  CardStatus,
  SchedulerDefinitionStatus,
  type PrismaClient,
} from "@prisma/client";

import { TEST_CONTENT_FIXTURE } from "../../content/fixtures/test-content.fixture";
import { TEST_STUDY_FIXTURE } from "../fixtures/test-study.fixture";

export interface TestStudySeedSummary {
  marker: "TEST_ONLY";
  userId: string;
  schedulerVersion: string;
  cardStates: number;
}

function assertExistingScheduler(
  scheduler: NonNullable<
    Awaited<ReturnType<PrismaClient["schedulerDefinition"]["findUnique"]>>
  >,
): void {
  const expected = TEST_STUDY_FIXTURE.scheduler;
  if (
    scheduler.status !== SchedulerDefinitionStatus.ACTIVE ||
    scheduler.algorithmMajor !== expected.algorithmMajor ||
    scheduler.parametersVersion !== expected.parametersVersion
  ) {
    throw new Error(
      `Scheduler ${scheduler.version} conflicts with the TEST_ONLY seed`,
    );
  }
}

export async function importTestStudySeed(
  prisma: PrismaClient,
): Promise<TestStudySeedSummary> {
  const fixture = TEST_STUDY_FIXTURE;
  const existingScheduler = await prisma.schedulerDefinition.findUnique({
    where: { version: fixture.scheduler.version },
  });
  if (existingScheduler === null) {
    const anotherActive = await prisma.schedulerDefinition.findFirst({
      where: { status: SchedulerDefinitionStatus.ACTIVE },
      select: { version: true, packageName: true },
    });
    if (anotherActive !== null) {
      if (anotherActive.packageName !== "TEST_ONLY") {
        throw new Error(
          `Cannot install TEST_ONLY scheduler while ${anotherActive.version} is active`,
        );
      }
      await prisma.schedulerDefinition.update({
        where: { version: anotherActive.version },
        data: { status: SchedulerDefinitionStatus.RETIRED },
      });
    }
    await prisma.schedulerDefinition.create({
      data: {
        ...fixture.scheduler,
        activeFrom: new Date(fixture.scheduler.activeFrom),
      },
    });
  } else {
    assertExistingScheduler(existingScheduler);
  }

  await prisma.user.upsert({
    where: { id: fixture.user.id },
    create: fixture.user,
    update: {
      displayName: fixture.user.displayName,
      preferredLocale: fixture.user.preferredLocale,
      status: fixture.user.status,
    },
  });
  await prisma.userSettings.upsert({
    where: { userId: fixture.user.id },
    create: {
      userId: fixture.user.id,
      ...fixture.settings,
    },
    update: fixture.settings,
  });
  await prisma.device.upsert({
    where: {
      userId_clientGeneratedId: {
        userId: fixture.user.id,
        clientGeneratedId: fixture.device.clientGeneratedId,
      },
    },
    create: {
      ...fixture.device,
      userId: fixture.user.id,
    },
    update: {
      platform: fixture.device.platform,
      appVersion: fixture.device.appVersion,
      locale: fixture.device.locale,
      timezone: fixture.device.timezone,
    },
  });

  const activeCards = new Map(
    TEST_CONTENT_FIXTURE.learningCards
      .filter(({ status }) => status === CardStatus.ACTIVE)
      .map((card) => [card.subjectEntityId, card]),
  );
  const entityByKey = new Map(
    TEST_CONTENT_FIXTURE.entities.map((entity) => [entity.contentKey, entity]),
  );
  for (const state of fixture.cardStates) {
    const entity = entityByKey.get(state.contentKey);
    const card = entity === undefined ? undefined : activeCards.get(entity.id);
    if (card === undefined) {
      throw new Error(`No active learning card for ${state.contentKey}`);
    }

    const data = {
      state: state.state,
      difficulty: state.difficulty,
      stability: state.stability,
      dueAt: new Date(state.dueAt),
      lastReviewedAt: new Date(state.lastReviewedAt),
      repetitions: state.repetitions,
      lapses: state.lapses,
      schedulerVersion: fixture.scheduler.version,
      schedulerParametersVersion: fixture.scheduler.parametersVersion,
      stateVersion: state.stateVersion,
    };
    await prisma.userCardState.upsert({
      where: {
        userId_learningCardId: {
          userId: fixture.user.id,
          learningCardId: card.id,
        },
      },
      create: {
        userId: fixture.user.id,
        learningCardId: card.id,
        ...data,
      },
      update: data,
    });
  }

  return {
    marker: fixture.marker,
    userId: fixture.user.id,
    schedulerVersion: fixture.scheduler.version,
    cardStates: fixture.cardStates.length,
  };
}
