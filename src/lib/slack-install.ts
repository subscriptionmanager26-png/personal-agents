import { decryptToken, encryptToken } from "@/lib/crypto";
import { getRedis, updateStore, getStore } from "@/lib/store";
import type { SlackWorkspaceInstall } from "@/lib/types";

const INSTALL_PREFIX = "pa:slack:install:";
const INSTALL_INDEX = "pa:slack:installs";

export async function saveSlackInstall(input: {
  teamId: string;
  teamName?: string;
  botToken: string;
  botUserId: string;
  installedByUserId?: string;
  scopes?: string[];
}) {
  const install: SlackWorkspaceInstall = {
    teamId: input.teamId,
    teamName: input.teamName,
    botTokenEnc: encryptToken(input.botToken),
    botUserId: input.botUserId,
    installedByUserId: input.installedByUserId,
    scopes: input.scopes ?? [],
    installedAt: new Date().toISOString(),
    isActive: true,
  };

  const redis = getRedis();
  if (redis) {
    await redis.set(`${INSTALL_PREFIX}${input.teamId}`, install);
    await redis.sadd(INSTALL_INDEX, input.teamId);
  }
  await updateStore((store) => {
    store.slackInstalls[input.teamId] = install;
  });
  return install;
}

export async function getSlackInstall(teamId: string) {
  if (!teamId) return undefined;
  const redis = getRedis();
  if (redis) {
    const stored = await redis.get<SlackWorkspaceInstall>(
      `${INSTALL_PREFIX}${teamId}`,
    );
    if (stored?.isActive) return stored;
  }
  const store = await getStore();
  const stored = store.slackInstalls?.[teamId];
  if (!stored?.isActive) return undefined;
  return stored;
}

export async function getSlackInstallBotToken(teamId: string) {
  const install = await getSlackInstall(teamId);
  if (!install?.botTokenEnc) {
    return process.env.SLACK_BOT_TOKEN?.trim() || undefined;
  }
  return decryptToken(install.botTokenEnc);
}

export async function deactivateSlackInstall(teamId: string) {
  const redis = getRedis();
  if (redis) {
    const key = `${INSTALL_PREFIX}${teamId}`;
    const stored = await redis.get<SlackWorkspaceInstall>(key);
    if (stored) {
      await redis.set(key, {
        ...stored,
        isActive: false,
        botTokenEnc: "",
        uninstalledAt: new Date().toISOString(),
      });
      await redis.srem(INSTALL_INDEX, teamId);
    }
  }
  await updateStore((store) => {
    const stored = store.slackInstalls[teamId];
    if (!stored) return;
    store.slackInstalls[teamId] = {
      ...stored,
      isActive: false,
      botTokenEnc: "",
      uninstalledAt: new Date().toISOString(),
    };
  });
}
