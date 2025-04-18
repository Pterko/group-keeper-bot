import { Update, UserFromGetMe } from "@grammyjs/types";
import { Context as DefaultContext, SessionFlavor, type Api } from "grammy";
import type { AutoChatActionFlavor } from "@grammyjs/auto-chat-action";
import type { HydrateFlavor } from "@grammyjs/hydrate";
import type { I18nFlavor } from "@grammyjs/i18n";
import type { ParseModeFlavor } from "@grammyjs/parse-mode";
import type { Logger } from "#root/logger.js";
import { FileFlavor } from "@grammyjs/files";
import { ChatMembersFlavor } from "@grammyjs/chat-members";

export type SessionData = {
  // field?: string;
};

type ExtendedContextFlavor = {
  logger: Logger;
  interactedWithUser: boolean;
  triggeredFeatures: ('cats-bulge' | 'download-video' | 'furry' | 'google-images' | 'llama' | 'roll' | 'welcome')[]
};

type VideoConverterContext = {
  videoConverterState: {
    url?: string;
  };
};

export type Context = FileFlavor<
  ParseModeFlavor<
    HydrateFlavor<
      DefaultContext &
        ExtendedContextFlavor &
        SessionFlavor<SessionData> &
        I18nFlavor &
        AutoChatActionFlavor
    >
  >
> & VideoConverterContext
  & ChatMembersFlavor;

interface Dependencies {
  logger: Logger;
}

export function createContextConstructor({ logger }: Dependencies) {
  return class extends DefaultContext implements ExtendedContextFlavor {
    logger: Logger;
    interactedWithUser = false;
    triggeredFeatures = [];

    constructor(update: Update, api: Api, me: UserFromGetMe) {
      super(update, api, me);

      this.logger = logger.child({
        update_id: this.update.update_id,
      });
    }
  } as unknown as new (update: Update, api: Api, me: UserFromGetMe) => Context;
}
