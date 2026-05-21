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

// Plugin: response-notify — Notify user when LLM generation completes

import { getPluginSettings } from '../_shared/utils.js';

export function register(hooks) {
  hooks.register('notification', (context) => {
    const settings = getPluginSettings(hooks);
    if (settings.enabled === false) return;
    if (context.event !== 'chat:done') return;
    if (typeof context.notify !== 'function') return;

    const isHidden = document.visibilityState === 'hidden';
    // Default `true` preserves the plugin's original always-notify behaviour
    // (channel switches between `in-app` and `auto` based on visibility).
    // Setting it to `false` opts in to "hidden tabs only".
    const notifyWhenVisible = settings.notifyWhenVisible !== false;
    if (!isHidden && !notifyWhenVisible) return;

    const title = typeof settings.notifyTitle === 'string' ? settings.notifyTitle : '故事生成完成';
    const body = typeof settings.notifyBody === 'string' ? settings.notifyBody : '新的章節已經寫入完成';
    const level = typeof settings.notifyLevel === 'string' ? settings.notifyLevel : 'success';

    context.notify({
      title,
      body,
      level,
      channel: isHidden ? 'auto' : 'in-app',
    });
  }, 100);
}
