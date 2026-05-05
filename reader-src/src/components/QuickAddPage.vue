<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useAuth } from "@/composables/useAuth";
import {
  deriveLoreFilename,
  ensureMdExtension,
  isValidSeriesOrStoryName,
  validateLoreFilename,
} from "@/lib/lore-filename";

const router = useRouter();
const { getAuthHeaders } = useAuth();

const seriesName = ref("");
const storyName = ref("");
const characterName = ref("");
const characterFilename = ref("");
const characterContent = ref("");
const worldInfoName = ref("");
const worldInfoFilename = ref("world_info.md");
const worldInfoContent = ref("");

const errors = reactive<Record<string, string>>({});

interface Acknowledgement {
  filename: string;
  acknowledged: boolean;
}
const acknowledgements = reactive<{
  character: Acknowledgement;
  worldInfo: Acknowledgement;
}>({
  character: { filename: "", acknowledged: false },
  worldInfo: { filename: "", acknowledged: false },
});
// Filenames that were successfully PUT in the most recent submission attempt
// (used to skip preflight + PUT on retry after a partial failure).
const lastSuccess = reactive<{ character: string; worldInfo: string }>({
  character: "",
  worldInfo: "",
});
const submitting = ref(false);
const stepStatus = ref("");
const noticeReused = ref(false);

const characterActive = computed(
  () =>
    characterName.value.trim() !== "" &&
    characterContent.value.trim() !== "",
);
const worldInfoActive = computed(
  () =>
    worldInfoName.value.trim() !== "" &&
    worldInfoContent.value.trim() !== "",
);

const requiredOk = computed(
  () => seriesName.value.trim() !== "" && storyName.value.trim() !== "",
);

function resolveCharacterFilename(): string {
  const typed = ensureMdExtension(characterFilename.value);
  if (typed) return typed;
  return deriveLoreFilename(characterName.value, "character.md");
}

function resolveWorldInfoFilename(): string {
  const typed = ensureMdExtension(worldInfoFilename.value);
  if (typed) return typed;
  return deriveLoreFilename(worldInfoName.value, "world_info.md");
}

const collisionsAcknowledged = computed(() => {
  if (characterActive.value) {
    const fn = resolveCharacterFilename();
    const a = acknowledgements.character;
    if (a.filename !== "" && (a.filename !== fn || !a.acknowledged)) {
      return false;
    }
  }
  if (worldInfoActive.value) {
    const fn = resolveWorldInfoFilename();
    const a = acknowledgements.worldInfo;
    if (a.filename !== "" && (a.filename !== fn || !a.acknowledged)) {
      return false;
    }
  }
  return true;
});

const submitDisabled = computed(
  () => !requiredOk.value || submitting.value || !collisionsAcknowledged.value,
);

// Invalidate stale acknowledgements / cached successes when the resolved
// filename changes (user edited the filename or the source name).
watch(
  () => (characterActive.value ? resolveCharacterFilename() : ""),
  (fn, prev) => {
    if (fn !== prev) {
      if (acknowledgements.character.filename !== fn) {
        acknowledgements.character = { filename: "", acknowledged: false };
      }
      if (lastSuccess.character !== fn) lastSuccess.character = "";
    }
  },
);
watch(
  () => (worldInfoActive.value ? resolveWorldInfoFilename() : ""),
  (fn, prev) => {
    if (fn !== prev) {
      if (acknowledgements.worldInfo.filename !== fn) {
        acknowledgements.worldInfo = { filename: "", acknowledged: false };
      }
      if (lastSuccess.worldInfo !== fn) lastSuccess.worldInfo = "";
    }
  },
);

function clearErrors() {
  for (const k of Object.keys(errors)) delete errors[k];
}

function validate(): boolean {
  clearErrors();
  let ok = true;
  if (seriesName.value.trim() === "") {
    errors.seriesName = "系列名稱為必填";
    ok = false;
  } else if (!isValidSeriesOrStoryName(seriesName.value)) {
    errors.seriesName = "系列名稱無效（不可以底線開頭或為保留名稱）";
    ok = false;
  }
  if (storyName.value.trim() === "") {
    errors.storyName = "故事名稱為必填";
    ok = false;
  } else if (!isValidSeriesOrStoryName(storyName.value)) {
    errors.storyName = "故事名稱無效（不可以底線開頭或為保留名稱）";
    ok = false;
  }
  // All-or-skipped per group
  const charNameFilled = characterName.value.trim() !== "";
  const charBodyFilled = characterContent.value.trim() !== "";
  if (charNameFilled !== charBodyFilled) {
    errors.character = "請填寫名稱與內容，或將兩者都留空";
    ok = false;
  }
  const wiNameFilled = worldInfoName.value.trim() !== "";
  const wiBodyFilled = worldInfoContent.value.trim() !== "";
  if (wiNameFilled !== wiBodyFilled) {
    errors.worldInfo = "請填寫名稱與內容，或將兩者都留空";
    ok = false;
  }
  if (characterActive.value) {
    const fn = resolveCharacterFilename();
    const v = validateLoreFilename(fn);
    if (!v.valid) {
      errors.characterFilename = "檔案名稱無效";
      ok = false;
    }
  }
  if (worldInfoActive.value) {
    const fn = resolveWorldInfoFilename();
    const v = validateLoreFilename(fn);
    if (!v.valid) {
      errors.worldInfoFilename = "檔案名稱無效";
      ok = false;
    }
  }
  return ok;
}

async function preflightExists(filename: string): Promise<boolean> {
  const url = `/api/lore/story/${encodeURIComponent(seriesName.value)}/${encodeURIComponent(storyName.value)}/${encodeURIComponent(filename)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { ...getAuthHeaders() } });
  } catch (err) {
    throw new Error(
      `預檢典籍失敗：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`預檢典籍失敗：${res.status} ${res.statusText}`.trim());
}

async function postInit(): Promise<{ created: boolean }> {
  const url = `/api/stories/${encodeURIComponent(seriesName.value)}/${encodeURIComponent(storyName.value)}/init`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `建立故事失敗：${(body as { detail?: string }).detail ?? res.statusText}`,
    );
  }
  return { created: res.status === 201 };
}

async function putLore(
  filename: string,
  displayName: string,
  body: string,
  groupLabel: "角色典籍" | "世界典籍",
): Promise<void> {
  const url = `/api/lore/story/${encodeURIComponent(seriesName.value)}/${encodeURIComponent(storyName.value)}/${encodeURIComponent(filename)}`;
  const content = `# ${displayName}\n\n${body}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({
      frontmatter: { enabled: true, priority: 0 },
      content,
    }),
  });
  if (!res.ok) {
    const rb = await res.json().catch(() => ({}));
    throw new Error(
      `建立${groupLabel}失敗：${(rb as { detail?: string }).detail ?? res.statusText}`,
    );
  }
}

async function onSubmit(e: Event) {
  e.preventDefault();
  if (submitting.value) return;
  if (!validate()) return;

  const charFn = characterActive.value ? resolveCharacterFilename() : "";
  const wiFn = worldInfoActive.value ? resolveWorldInfoFilename() : "";

  submitting.value = true;
  stepStatus.value = "建立中… 預檢";
  try {
    let needAck = false;
    // Character preflight (skip when this filename was already written
    // successfully in the current attempt).
    if (characterActive.value && lastSuccess.character !== charFn) {
      // Drop a stale ack tied to a different filename before preflighting.
      if (acknowledgements.character.filename !== charFn) {
        acknowledgements.character = { filename: "", acknowledged: false };
      }
      const exists = await preflightExists(charFn);
      if (exists) {
        const a = acknowledgements.character;
        if (a.filename === charFn && a.acknowledged) {
          // confirmed for this exact filename — proceed
        } else {
          acknowledgements.character = { filename: charFn, acknowledged: false };
          needAck = true;
        }
      } else {
        acknowledgements.character = { filename: "", acknowledged: false };
      }
    }
    if (worldInfoActive.value && lastSuccess.worldInfo !== wiFn) {
      if (acknowledgements.worldInfo.filename !== wiFn) {
        acknowledgements.worldInfo = { filename: "", acknowledged: false };
      }
      const exists = await preflightExists(wiFn);
      if (exists) {
        const a = acknowledgements.worldInfo;
        if (a.filename === wiFn && a.acknowledged) {
          // confirmed
        } else {
          acknowledgements.worldInfo = { filename: wiFn, acknowledged: false };
          needAck = true;
        }
      } else {
        acknowledgements.worldInfo = { filename: "", acknowledged: false };
      }
    }
    if (needAck) {
      stepStatus.value = "";
      submitting.value = false;
      return;
    }

    stepStatus.value = "建立中… 故事";
    const initResult = await postInit();
    noticeReused.value = !initResult.created;

    if (characterActive.value && lastSuccess.character !== charFn) {
      stepStatus.value = "建立中… 角色典籍";
      await putLore(charFn, characterName.value, characterContent.value, "角色典籍");
      lastSuccess.character = charFn;
    }
    if (worldInfoActive.value && lastSuccess.worldInfo !== wiFn) {
      stepStatus.value = "建立中… 世界典籍";
      await putLore(wiFn, worldInfoName.value, worldInfoContent.value, "世界典籍");
      lastSuccess.worldInfo = wiFn;
    }

    stepStatus.value = "完成";
    router.push({
      name: "story",
      params: { series: seriesName.value, story: storyName.value },
    });
  } catch (err) {
    errors.submit = err instanceof Error ? err.message : String(err);
    stepStatus.value = "";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="quick-add">
    <h2>快速新增系列</h2>
    <form @submit="onSubmit">
      <div class="field">
        <label for="qa-series">系列名稱</label>
        <input id="qa-series" v-model="seriesName" type="text" required />
        <p v-if="errors.seriesName" class="field-error">{{ errors.seriesName }}</p>
      </div>
      <div class="field">
        <label for="qa-story">故事名稱</label>
        <input id="qa-story" v-model="storyName" type="text" required />
        <p v-if="errors.storyName" class="field-error">{{ errors.storyName }}</p>
      </div>

      <fieldset class="group">
        <legend>角色（選填）</legend>
        <div class="field">
          <label for="qa-char-name">角色名稱</label>
          <input id="qa-char-name" v-model="characterName" type="text" />
        </div>
        <div class="field">
          <label for="qa-char-fn">角色檔案名稱</label>
          <input
            id="qa-char-fn"
            v-model="characterFilename"
            type="text"
            placeholder="留空時自動由角色名稱推導"
          />
          <p v-if="errors.characterFilename" class="field-error">
            {{ errors.characterFilename }}
          </p>
        </div>
        <div class="field">
          <label for="qa-char-body">角色設定內容</label>
          <textarea id="qa-char-body" v-model="characterContent" rows="6" />
        </div>
        <p v-if="errors.character" class="field-error">{{ errors.character }}</p>
        <div v-if="acknowledgements.character.filename" class="collision">
          <p class="warning">已存在同名典籍：{{ acknowledgements.character.filename }}</p>
          <label>
            <input v-model="acknowledgements.character.acknowledged" type="checkbox" />
            覆寫現有典籍
          </label>
        </div>
      </fieldset>

      <fieldset class="group">
        <legend>世界典籍（選填）</legend>
        <div class="field">
          <label for="qa-wi-name">世界典籍名稱</label>
          <input id="qa-wi-name" v-model="worldInfoName" type="text" />
        </div>
        <div class="field">
          <label for="qa-wi-fn">世界典籍檔案名稱</label>
          <input id="qa-wi-fn" v-model="worldInfoFilename" type="text" />
          <p v-if="errors.worldInfoFilename" class="field-error">
            {{ errors.worldInfoFilename }}
          </p>
        </div>
        <div class="field">
          <label for="qa-wi-body">世界典籍內容</label>
          <textarea id="qa-wi-body" v-model="worldInfoContent" rows="6" />
        </div>
        <p v-if="errors.worldInfo" class="field-error">{{ errors.worldInfo }}</p>
        <div v-if="acknowledgements.worldInfo.filename" class="collision">
          <p class="warning">已存在同名典籍：{{ acknowledgements.worldInfo.filename }}</p>
          <label>
            <input v-model="acknowledgements.worldInfo.acknowledged" type="checkbox" />
            覆寫現有典籍
          </label>
        </div>
      </fieldset>

      <div class="actions">
        <button
          type="submit"
          class="themed-btn"
          :disabled="submitDisabled"
        >
          建立
        </button>
      </div>

      <div class="status" role="status" aria-live="polite">
        <p v-if="stepStatus">{{ stepStatus }}</p>
        <p v-if="noticeReused" class="notice">已沿用現有故事資料夾</p>
        <p v-if="errors.submit" class="field-error">{{ errors.submit }}</p>
      </div>
    </form>
  </div>
</template>

<style scoped>
.quick-add {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  box-sizing: border-box;
}
.quick-add h2 {
  color: var(--text-title);
  margin-bottom: 1.5rem;
  font-size: 1.2rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 1rem;
}
.field label {
  font-weight: 600;
  font-size: 0.875rem;
}
.field input,
.field textarea {
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
  font-size: 0.95rem;
  padding: 0.5rem;
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  background: var(--btn-bg);
  color: var(--text-name);
}
.field textarea {
  resize: vertical;
}
.field-error {
  color: #b41e3c;
  font-size: 0.85rem;
  margin: 0.25rem 0 0;
}
.group {
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  padding: 1rem;
  margin-bottom: 1.5rem;
}
.group legend {
  padding: 0 0.5rem;
  font-weight: 600;
}
.collision {
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: rgba(180, 30, 60, 0.08);
  border-radius: 4px;
}
.collision .warning {
  margin: 0 0 0.5rem;
  color: #b41e3c;
}
.actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 1rem;
}
.status {
  margin-top: 1rem;
  min-height: 1.5rem;
}
.notice {
  color: #555;
  font-style: italic;
  font-size: 0.9rem;
}
</style>
