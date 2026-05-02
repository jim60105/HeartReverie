// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program. If not, see <https://www.gnu.org/licenses/>.

import { computed, ref } from "vue";
import type {
  ActionButtonClickContext,
  ActionButtonDescriptor,
  PluginDescriptor,
  RunPluginPromptOptions,
} from "@/types";
import { usePlugins } from "@/composables/usePlugins";
import { useChapterNav } from "@/composables/useChapterNav";
import { useChatApi } from "@/composables/useChatApi";
import { useNotification } from "@/composables/useNotification";
import { frontendHooks } from "@/lib/plugin-hooks";

export interface VisibleActionButton extends ActionButtonDescriptor {
  pluginName: string;
  declarationOrder: number;
}

const pendingKey = ref<string | null>(null);

function resolvePriority(d: ActionButtonDescriptor): number {
  return typeof d.priority === "number" && Number.isFinite(d.priority)
    ? d.priority
    : 100;
}

function resolveVisibleWhen(
  d: ActionButtonDescriptor,
): "last-chapter-backend" | "backend-only" {
  return d.visibleWhen ?? "last-chapter-backend";
}

function descriptorMatches(
  d: ActionButtonDescriptor,
  isLastChapter: boolean,
  hasChapters: boolean,
): boolean {
  const v = resolveVisibleWhen(d);
  if (v === "backend-only") return true;
  // "last-chapter-backend" — mirror MainLayout.showChatInput predicate so the
  // bar shows up on a fresh story (no chapters yet) as well as on the last
  // chapter of an existing story.
  return isLastChapter || !hasChapters;
}

export function usePluginActions() {
  const { plugins } = usePlugins();
  const chapterNav = useChapterNav();
  const { isLastChapter, chapters, currentIndex, getBackendContext, reloadToLast } =
    chapterNav;

  const actionButtons = computed<VisibleActionButton[]>(() => {
    // Reactivity: read currentIndex so visibility recomputes on chapter change.
    void currentIndex.value;
    void chapters.value.length;

    const visible: VisibleActionButton[] = [];
    const pluginList = plugins.value as PluginDescriptor[];

    for (const p of pluginList) {
      if (!Array.isArray(p.actionButtons)) continue;
      let order = 0;
      for (const desc of p.actionButtons) {
        if (
          descriptorMatches(
            desc,
            isLastChapter.value,
            chapters.value.length > 0,
          )
        ) {
          visible.push({
            ...desc,
            pluginName: p.name,
            declarationOrder: order,
          });
        }
        order++;
      }
    }

    visible.sort((a, b) => {
      const pa = resolvePriority(a);
      const pb = resolvePriority(b);
      if (pa !== pb) return pa - pb;
      if (a.pluginName !== b.pluginName) {
        return a.pluginName < b.pluginName ? -1 : 1;
      }
      return a.declarationOrder - b.declarationOrder;
    });

    return visible;
  });

  async function clickButton(buttonId: string, pluginName: string): Promise<void> {
    const key = `${pluginName}:${buttonId}`;
    // Spec: only block re-clicks on the EXACT pending key. Other plugins'
    // buttons (or this plugin's other buttons) remain clickable; backend
    // generation lock is the source of truth for cross-plugin concurrency.
    if (pendingKey.value === key) return;
    pendingKey.value = key;
    try {
      const ctx = getBackendContext();
      const lastChapterIndex = chapters.value.length > 0
        ? chapters.value.length - 1
        : null;
      const series = ctx.series ?? "";
      const name = ctx.story ?? "";
      const storyDir = series && name ? `${series}/${name}` : "";

      const { notify } = useNotification();
      const chatApi = useChatApi();

      const clickCtx: ActionButtonClickContext = {
        buttonId,
        pluginName,
        series,
        name,
        storyDir,
        lastChapterIndex,
        runPluginPrompt: (promptFile: string, opts?: RunPluginPromptOptions) =>
          chatApi.runPluginPrompt(pluginName, promptFile, {
            series,
            name,
            ...(opts ?? {}),
          }),
        notify: (input) => {
          notify({
            title: input.title ?? "外掛通知",
            body: input.body,
            level: input.level,
          });
        },
        reload: () => reloadToLast(),
      };

      await frontendHooks.dispatch("action-button:click", clickCtx);
    } finally {
      pendingKey.value = null;
    }
  }

  return {
    actionButtons,
    pendingKey,
    clickButton,
  };
}
