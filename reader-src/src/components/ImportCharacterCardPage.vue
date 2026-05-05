<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useAuth } from "@/composables/useAuth";
import { parseCharacterCard } from "@/lib/character-card-parser";
import {
  deriveLoreFilename,
  ensureMdExtension,
  isValidSeriesOrStoryName,
  validateLoreFilename,
  sanitiseTags,
} from "@/lib/lore-filename";
import type { ParsedCharacterCard } from "@/types/character-card";

const router = useRouter();
const { getAuthHeaders } = useAuth();

interface FormState {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
  creatorNotes: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  alternateGreetings: string[];
  tags: string[];
  bookEntries: { name: string; keys: string[]; content: string }[];
}

interface ScalarSnapshot {
  seriesName: string;
  storyName: string;
  characterFilename: string;
  worldInfoName: string;
  worldInfoFilename: string;
}

function emptyForm(): FormState {
  return {
    name: "",
    description: "",
    personality: "",
    scenario: "",
    firstMes: "",
    mesExample: "",
    creatorNotes: "",
    systemPrompt: "",
    postHistoryInstructions: "",
    alternateGreetings: [],
    tags: [],
    bookEntries: [],
  };
}

function deepClone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o));
}

function fromParsed(card: ParsedCharacterCard): FormState {
  return deepClone({
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    firstMes: card.firstMes,
    mesExample: card.mesExample,
    creatorNotes: card.creatorNotes,
    systemPrompt: card.systemPrompt,
    postHistoryInstructions: card.postHistoryInstructions,
    alternateGreetings: [...card.alternateGreetings],
    tags: [...card.tags],
    bookEntries: card.bookEntries.map((e) => ({
      name: e.name,
      keys: [...e.keys],
      content: e.content,
    })),
  });
}

const parsed = ref<ParsedCharacterCard | null>(null);
const form = reactive<FormState>(emptyForm());
let hydrationSnapshot: FormState | null = null;
let scalarSnapshot: ScalarSnapshot | null = null;
const parseError = ref("");

const seriesName = ref("");
const storyName = ref("");
const worldInfoName = ref("");
const characterFilename = ref("");
const worldInfoFilename = ref("world_info.md");
const worldInfoFilenameManuallyEdited = ref(false);

const submitting = ref(false);
const stepStatus = ref("");
const noticeReused = ref(false);
const errors = reactive<Record<string, string>>({});
const tagWarnings = reactive<{ tooLong: string[]; special: string[] }>({
  tooLong: [],
  special: [],
});

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
const lastSuccess = reactive<{ character: string; worldInfo: string }>({
  character: "",
  worldInfo: "",
});

function targetKey(lorePath: string): string {
  return `${seriesName.value}/${lorePath}`;
}

const cardLoaded = computed(() => parsed.value !== null);

function resolveCharacterFilename(): string {
  return ensureMdExtension(characterFilename.value) ||
    deriveLoreFilename(form.name, "character.md");
}
function resolveCharacterLorePath(): string {
  return `character/${encodeURIComponent(resolveCharacterFilename())}`;
}
function resolveWorldInfoFilename(): string {
  return ensureMdExtension(worldInfoFilename.value) || "world_info.md";
}
function resolveWorldInfoLorePath(): string {
  return encodeURIComponent(resolveWorldInfoFilename());
}

const collisionsAcknowledged = computed(() => {
  // Character group is always active once a card is loaded.
  if (cardLoaded.value) {
    const fn = resolveCharacterFilename();
    const a = acknowledgements.character;
    if (a.filename !== "" && (a.filename !== fn || !a.acknowledged)) {
      return false;
    }
  }
  if (form.bookEntries.length > 0) {
    const fn = resolveWorldInfoFilename();
    const a = acknowledgements.worldInfo;
    if (a.filename !== "" && (a.filename !== fn || !a.acknowledged)) {
      return false;
    }
  }
  return true;
});

const submitDisabled = computed(
  () =>
    !cardLoaded.value ||
    submitting.value ||
    !collisionsAcknowledged.value ||
    seriesName.value.trim() === "" ||
    storyName.value.trim() === "",
);

// Invalidate stale acknowledgements / cached successes when the resolved
// filename or series changes — covers user edits to the filename input, the
// underlying name field used for derivation, AND series changes.
watch(
  () => (cardLoaded.value ? targetKey(resolveCharacterLorePath()) : ""),
  (key, prev) => {
    if (key !== prev) {
      const fn = resolveCharacterFilename();
      if (acknowledgements.character.filename !== fn) {
        acknowledgements.character = { filename: "", acknowledged: false };
      }
      if (lastSuccess.character !== key) lastSuccess.character = "";
    }
  },
);
watch(
  () => (form.bookEntries.length > 0 ? targetKey(resolveWorldInfoLorePath()) : ""),
  (key, prev) => {
    if (key !== prev) {
      const fn = resolveWorldInfoFilename();
      if (acknowledgements.worldInfo.filename !== fn) {
        acknowledgements.worldInfo = { filename: "", acknowledged: false };
      }
      if (lastSuccess.worldInfo !== key) lastSuccess.worldInfo = "";
    }
  },
);
// Auto-derive worldInfoFilename from worldInfoName unless manually edited
watch(worldInfoName, (name) => {
  if (!worldInfoFilenameManuallyEdited.value) {
    worldInfoFilename.value = name.trim()
      ? deriveLoreFilename(name, "world_info.md")
      : "world_info.md";
  }
});

function captureScalarSnapshot(): ScalarSnapshot {
  return {
    seriesName: seriesName.value,
    storyName: storyName.value,
    characterFilename: characterFilename.value,
    worldInfoName: worldInfoName.value,
    worldInfoFilename: worldInfoFilename.value,
  };
}

function isFormDirty(): boolean {
  if (!hydrationSnapshot || !scalarSnapshot) return false;
  if (JSON.stringify(form) !== JSON.stringify(hydrationSnapshot)) return true;
  return JSON.stringify(captureScalarSnapshot()) !==
    JSON.stringify(scalarSnapshot);
}

function hydrateFrom(card: ParsedCharacterCard) {
  const next = fromParsed(card);
  Object.assign(form, next);
  hydrationSnapshot = deepClone(next);
  parsed.value = card;
  characterFilename.value = deriveLoreFilename(card.name, "character.md");
  worldInfoName.value = card.bookName;
  worldInfoFilename.value = card.bookName
    ? deriveLoreFilename(card.bookName, "world_info.md")
    : "world_info.md";
  worldInfoFilenameManuallyEdited.value = false;
  scalarSnapshot = captureScalarSnapshot();
  acknowledgements.character = { filename: "", acknowledged: false };
  acknowledgements.worldInfo = { filename: "", acknowledged: false };
  lastSuccess.character = "";
  lastSuccess.worldInfo = "";
  parseError.value = "";
  errors.submit = "";
  tagWarnings.tooLong = [];
  tagWarnings.special = [];
}

async function onFileChosen(file: File | null) {
  if (!file) return;
  if (parsed.value && isFormDirty()) {
    const ok = window.confirm("丟棄目前編輯並載入新檔案？");
    if (!ok) return;
  }
  try {
    const card = await parseCharacterCard(file);
    hydrateFrom(card);
  } catch (err) {
    parseError.value = err instanceof Error ? err.message : String(err);
  }
}

function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0] ?? null;
  void onFileChosen(f);
  input.value = "";
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0] ?? null;
  void onFileChosen(f);
}

function addAlternateGreeting() {
  form.alternateGreetings.push("");
}
function removeAlternateGreeting(i: number) {
  form.alternateGreetings.splice(i, 1);
}
function addBookEntry() {
  form.bookEntries.push({ name: "", keys: [], content: "" });
}
function removeBookEntry(i: number) {
  form.bookEntries.splice(i, 1);
}

function keysAsString(entry: { keys: string[] }): string {
  return entry.keys.join(", ");
}

function setKeysFromString(entry: { keys: string[] }, raw: string) {
  entry.keys = raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

function tagsAsString(): string {
  return form.tags.join(", ");
}
function setTagsFromString(raw: string) {
  form.tags = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
function altsAsString(): string {
  return form.alternateGreetings.join("\n");
}

function clearErrors() {
  for (const k of Object.keys(errors)) delete errors[k];
}

function validate(): {
  ok: boolean;
  charFilename: string;
  charLorePath: string;
  worldFilename: string;
  worldLorePath: string;
} {
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
  const charFn = resolveCharacterFilename();
  const charV = validateLoreFilename(charFn);
  if (!charV.valid) {
    errors.characterFilename = "檔案名稱無效";
    ok = false;
  }
  const worldFn = resolveWorldInfoFilename();
  if (form.bookEntries.length > 0) {
    const wv = validateLoreFilename(worldFn);
    if (!wv.valid) {
      errors.worldInfoFilename = "檔案名稱無效";
      ok = false;
    }
  }
  return {
    ok,
    charFilename: charFn,
    charLorePath: resolveCharacterLorePath(),
    worldFilename: worldFn,
    worldLorePath: resolveWorldInfoLorePath(),
  };
}

async function preflightExists(lorePath: string): Promise<boolean> {
  const url = `/api/lore/series/${encodeURIComponent(seriesName.value)}/${lorePath}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { ...getAuthHeaders() } });
  } catch (err) {
    throw new Error(
      `預檢篇章失敗：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`預檢篇章失敗：${res.status} ${res.statusText}`.trim());
}

function buildCharacterMarkdown(): string {
  const sections: string[] = [];
  const trimmedName = form.name.trim();
  if (trimmedName) sections.push(`# ${trimmedName}`);
  const pushSection = (heading: string, value: string) => {
    if (value.trim() !== "") sections.push(`## ${heading}\n${value}`);
  };
  pushSection("Description", form.description);
  pushSection("Personality", form.personality);
  pushSection("Scenario", form.scenario);
  pushSection("First Message", form.firstMes);
  pushSection("Example Messages", form.mesExample);
  pushSection("System Prompt", form.systemPrompt);
  pushSection("Post-History Instructions", form.postHistoryInstructions);
  const alts = form.alternateGreetings.filter((g) => g.trim() !== "");
  if (alts.length > 0) {
    sections.push(
      `## Alternate Greetings\n${alts.map((g) => `- ${g}`).join("\n")}`,
    );
  }
  pushSection("Creator Notes", form.creatorNotes);
  return sections.join("\n\n");
}

function buildWorldInfoMarkdown(): string {
  const sections: string[] = [];
  const trimmedName = worldInfoName.value.trim();
  if (trimmedName) sections.push(`# ${trimmedName}`);
  for (const entry of form.bookEntries) {
    const name = entry.name.trim() || "(unnamed)";
    const nonEmptyKeys = entry.keys.map((k) => k.trim()).filter(Boolean);
    const keysLine =
      nonEmptyKeys.length > 0 ? `**Keys:** ${nonEmptyKeys.join(", ")}\n\n` : "";
    sections.push(`## ${name}\n${keysLine}${entry.content}`);
  }
  return sections.join("\n\n");
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
  lorePath: string,
  frontmatter: Record<string, unknown>,
  content: string,
  groupLabel: "角色篇章" | "世界篇章",
): Promise<void> {
  const url = `/api/lore/series/${encodeURIComponent(seriesName.value)}/${lorePath}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ frontmatter, content }),
  });
  if (!res.ok) {
    const rb = await res.json().catch(() => ({}));
    throw new Error(
      `建立${groupLabel}失敗：${(rb as { detail?: string }).detail ?? res.statusText}`,
    );
  }
}

async function onImport(e: Event) {
  e.preventDefault();
  if (submitting.value || !cardLoaded.value) return;
  const v = validate();
  if (!v.ok) return;

  // Sanitise tags
  const sanRes = sanitiseTags(form.tags);
  tagWarnings.tooLong = sanRes.droppedTooLong;
  tagWarnings.special = sanRes.droppedSpecial;
  const sanitisedTags = sanRes.kept;

  submitting.value = true;
  try {
    stepStatus.value = "預檢";
    let needAck = false;

    if (lastSuccess.character !== targetKey(v.charLorePath)) {
      if (acknowledgements.character.filename !== v.charFilename) {
        acknowledgements.character = { filename: "", acknowledged: false };
      }
      const exists = await preflightExists(v.charLorePath);
      if (exists) {
        const a = acknowledgements.character;
        if (a.filename === v.charFilename && a.acknowledged) {
          // confirmed
        } else {
          acknowledgements.character = {
            filename: v.charFilename,
            acknowledged: false,
          };
          needAck = true;
        }
      } else {
        acknowledgements.character = { filename: "", acknowledged: false };
      }
    }
    if (form.bookEntries.length > 0 && lastSuccess.worldInfo !== targetKey(v.worldLorePath)) {
      if (acknowledgements.worldInfo.filename !== v.worldFilename) {
        acknowledgements.worldInfo = { filename: "", acknowledged: false };
      }
      const exists = await preflightExists(v.worldLorePath);
      if (exists) {
        const a = acknowledgements.worldInfo;
        if (a.filename === v.worldFilename && a.acknowledged) {
          // confirmed
        } else {
          acknowledgements.worldInfo = {
            filename: v.worldFilename,
            acknowledged: false,
          };
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

    stepStatus.value = "建立故事";
    const initResult = await postInit();
    noticeReused.value = !initResult.created;

    if (lastSuccess.character !== targetKey(v.charLorePath)) {
      stepStatus.value = "寫入角色篇章";
      const charFm: Record<string, unknown> = { enabled: true, priority: 0 };
      if (sanitisedTags.length > 0) charFm.tags = sanitisedTags;
      await putLore(
        v.charLorePath,
        charFm,
        buildCharacterMarkdown(),
        "角色篇章",
      );
      lastSuccess.character = targetKey(v.charLorePath);
    }

    if (form.bookEntries.length > 0 && lastSuccess.worldInfo !== targetKey(v.worldLorePath)) {
      stepStatus.value = "寫入世界篇章";
      await putLore(
        v.worldLorePath,
        { enabled: true, priority: 0 },
        buildWorldInfoMarkdown(),
        "世界篇章",
      );
      lastSuccess.worldInfo = targetKey(v.worldLorePath);
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
  <div class="import-card">
    <h2>SillyTavern 角色卡轉換工具</h2>

    <fieldset class="group">
      <legend>檔案選擇</legend>
      <p v-if="parseError" class="field-error">{{ parseError }}</p>
      <div class="dropzone" @dragover.prevent @drop="onDrop">
        <p>拖放 PNG 角色卡到此處，或</p>
        <label class="file-trigger" for="ic-file-input">選擇檔案</label>
        <input
          id="ic-file-input"
          type="file"
          accept="image/png"
          class="file-input-hidden"
          @change="onFileInput"
        />
      </div>
    </fieldset>

    <template v-if="cardLoaded">
      <fieldset class="group">
        <legend>故事位置</legend>
        <div class="field">
          <label for="ic-series">系列名稱</label>
          <input id="ic-series" v-model="seriesName" type="text" required />
          <p v-if="errors.seriesName" class="field-error">{{ errors.seriesName }}</p>
        </div>
        <div class="field">
          <label for="ic-story">故事名稱</label>
          <input id="ic-story" v-model="storyName" type="text" required />
          <p v-if="errors.storyName" class="field-error">{{ errors.storyName }}</p>
        </div>
      </fieldset>

      <fieldset class="group">
        <legend>角色資料</legend>
        <div class="field">
          <label for="ic-char-fn">角色檔案名稱</label>
          <input id="ic-char-fn" v-model="characterFilename" type="text" />
          <p v-if="errors.characterFilename" class="field-error">
            {{ errors.characterFilename }}
          </p>
          <div v-if="acknowledgements.character.filename" class="collision">
            <p class="warning">已存在同名篇章：{{ acknowledgements.character.filename }}</p>
            <label>
              <input v-model="acknowledgements.character.acknowledged" type="checkbox" />
              覆寫現有篇章
            </label>
          </div>
        </div>
        <div class="field">
          <label>tags（以逗號分隔）</label>
          <input
            type="text"
            :value="tagsAsString()"
            @input="setTagsFromString(($event.target as HTMLInputElement).value)"
          />
          <p
            v-for="t in tagWarnings.tooLong"
            :key="`tl-${t}`"
            class="field-error"
          >
            已忽略過長標籤：{{ t.slice(0, 30) }}…
          </p>
          <p
            v-for="t in tagWarnings.special"
            :key="`sp-${t}`"
            class="field-error"
          >
            已忽略含特殊字元的標籤：{{ t }}
          </p>
        </div>
        <div class="field">
          <label for="ic-name">name</label>
          <textarea id="ic-name" v-model="form.name" rows="1" />
        </div>
        <div class="field">
          <label for="ic-description">description</label>
          <textarea id="ic-description" v-model="form.description" rows="6" />
        </div>
        <div class="field">
          <label for="ic-personality">personality</label>
          <textarea id="ic-personality" v-model="form.personality" rows="3" />
        </div>
        <div class="field">
          <label for="ic-scenario">scenario</label>
          <textarea id="ic-scenario" v-model="form.scenario" rows="3" />
        </div>
        <div class="field">
          <label for="ic-firstmes">first_mes</label>
          <textarea id="ic-firstmes" v-model="form.firstMes" rows="3" />
        </div>
        <div class="field">
          <label for="ic-mesexample">mes_example</label>
          <textarea id="ic-mesexample" v-model="form.mesExample" rows="3" />
        </div>
        <div class="field">
          <label for="ic-creatornotes">creator_notes</label>
          <textarea id="ic-creatornotes" v-model="form.creatorNotes" rows="2" />
        </div>
        <div class="field">
          <label for="ic-system">system_prompt</label>
          <textarea id="ic-system" v-model="form.systemPrompt" rows="3" />
        </div>
        <div class="field">
          <label for="ic-phi">post_history_instructions</label>
          <textarea
            id="ic-phi"
            v-model="form.postHistoryInstructions"
            rows="2"
          />
        </div>

        <h4>alternate_greetings</h4>
        <div
          v-for="(_, i) in form.alternateGreetings"
          :key="`alt-${i}`"
          class="field"
        >
          <label :for="`ic-alt-${i}`">{{ i + 1 }}</label>
          <textarea
            :id="`ic-alt-${i}`"
            v-model="form.alternateGreetings[i]"
            rows="2"
          />
          <button type="button" class="themed-btn" @click="removeAlternateGreeting(i)">
            刪除
          </button>
        </div>
        <button type="button" class="themed-btn" @click="addAlternateGreeting">
          新增 alternate_greeting
        </button>
      </fieldset>

      <fieldset class="group">
        <legend>世界篇章</legend>
        <div class="field">
          <label for="ic-wi-fn">世界篇章檔案名稱</label>
          <input
            id="ic-wi-fn"
            v-model="worldInfoFilename"
            type="text"
            @input="worldInfoFilenameManuallyEdited = true"
          />
          <p v-if="errors.worldInfoFilename" class="field-error">
            {{ errors.worldInfoFilename }}
          </p>
          <div v-if="acknowledgements.worldInfo.filename" class="collision">
            <p class="warning">已存在同名篇章：{{ acknowledgements.worldInfo.filename }}</p>
            <label>
              <input v-model="acknowledgements.worldInfo.acknowledged" type="checkbox" />
              覆寫現有篇章
            </label>
          </div>
        </div>
        <div class="field">
          <label for="ic-wi-name">世界篇章名稱</label>
          <input id="ic-wi-name" v-model="worldInfoName" type="text" />
        </div>

        <h4>character_book entries</h4>
        <details
          v-for="(entry, i) in form.bookEntries"
          :key="`be-${i}`"
          class="book-entry"
        >
          <summary>{{ entry.name || `(entry ${i + 1})` }}</summary>
          <div class="field">
            <label :for="`ic-be-name-${i}`">name</label>
            <input
              :id="`ic-be-name-${i}`"
              v-model="entry.name"
              type="text"
            />
          </div>
          <div class="field">
            <label :for="`ic-be-keys-${i}`">keys（以逗號分隔）</label>
            <input
              :id="`ic-be-keys-${i}`"
              type="text"
              :value="keysAsString(entry)"
              @input="setKeysFromString(entry, ($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="field">
            <label :for="`ic-be-body-${i}`">content</label>
            <textarea
              :id="`ic-be-body-${i}`"
              v-model="entry.content"
              rows="4"
            />
          </div>
          <button type="button" class="themed-btn" @click="removeBookEntry(i)">
            刪除此 entry
          </button>
        </details>
        <button type="button" class="themed-btn" @click="addBookEntry">
          新增 book entry
        </button>
      </fieldset>

      <div class="actions">
        <button
          type="button"
          class="themed-btn"
          :disabled="submitDisabled"
          @click="onImport"
        >
          匯入
        </button>
      </div>

      <div class="status" role="status" aria-live="polite">
        <p v-if="stepStatus">{{ stepStatus }}</p>
        <p v-if="noticeReused" class="notice">已沿用現有故事資料夾</p>
        <p v-if="errors.submit" class="field-error">{{ errors.submit }}</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.import-card {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  box-sizing: border-box;
}
.import-card h2 {
  color: var(--text-title);
  margin-bottom: 1rem;
}
.import-card h4 {
  color: var(--text-title);
  margin-top: 1.5rem;
  margin-bottom: 0.5rem;
  font-size: 1rem;
}
.group {
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  padding: 1rem;
  margin-bottom: 1.5rem;
}
.group legend {
  font-weight: 600;
  padding: 0 0.5rem;
}
.dropzone {
  padding: 1.5rem;
  border: 2px dashed var(--btn-border);
  border-radius: 6px;
  text-align: center;
}
.file-input-hidden {
  opacity: 0;
  position: absolute;
  pointer-events: none;
  width: 0;
  height: 0;
}
.file-trigger {
  display: inline-block;
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  background: var(--btn-bg);
  padding: 8px 16px;
  cursor: pointer;
  font-size: inherit;
  color: inherit;
}
.file-trigger:hover {
  border-color: var(--btn-hover-border);
  background: var(--btn-hover-bg);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.75rem;
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
.book-entry {
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  padding: 0.5rem;
  margin-bottom: 0.5rem;
}
.book-entry summary {
  cursor: pointer;
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
