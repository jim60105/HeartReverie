<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useAuth } from "@/composables/useAuth";
import { frontendHooks } from "@/lib/plugin-hooks";
import {
  detectConflicts,
  mergeFrontendDeclarations,
} from "@/lib/hook-inspector";
import type {
  HandlerInfo,
  HookInspectorReport,
  ManifestDeclarations,
  PipelineFieldRef,
  StripTagDeclaration,
} from "@/types";
import StageBlock from "@/components/hook-inspector/StageBlock.vue";

interface IntrospectionDump {
  backend: Record<string, HandlerInfo[]>;
  manifestDeclarations: ManifestDeclarations[];
  stripTags: StripTagDeclaration[];
  pipelineFields: PipelineFieldRef[];
  generatedAt: string;
}

const { getAuthHeaders } = useAuth();

const loading = ref(false);
const errorMsg = ref<string | null>(null);
const report = ref<HookInspectorReport | null>(null);

async function loadReport(): Promise<void> {
  loading.value = true;
  errorMsg.value = null;
  try {
    const res = await fetch("/api/plugin-introspection/hooks", {
      headers: getAuthHeaders() as Record<string, string>,
    });
    if (res.status === 401) {
      errorMsg.value = "通行碼錯誤或未提供，請先重新驗證通行碼後再試。";
      return;
    }
    if (!res.ok) {
      errorMsg.value = `載入失敗 (HTTP ${res.status})`;
      return;
    }
    const dump = (await res.json()) as IntrospectionDump;
    const frontendIntrospect = frontendHooks.introspect() as unknown as Record<
      string,
      HandlerInfo[]
    >;
    const frontend = mergeFrontendDeclarations(
      frontendIntrospect,
      dump.manifestDeclarations,
    );
    // Backend handlers from manifest can also carry reads/writes — enrich
    // them via the same join so C1/C2 work uniformly.
    const backend = mergeFrontendDeclarations(
      dump.backend as unknown as Record<string, HandlerInfo[]>,
      dump.manifestDeclarations,
    );
    const conflicts = detectConflicts(backend, frontend, dump.pipelineFields);
    const bootMismatches = frontendHooks.getBootMismatches().map((m) => ({
      plugin: m.plugin,
      declaredOnly: m.declaredOnly as readonly string[],
      registeredOnly: m.registeredOnly as readonly string[],
    }));
    const payload: HookInspectorReport = {
      backend,
      frontend,
      manifestDeclarations: dump.manifestDeclarations,
      stripTags: dump.stripTags,
      pipelineFields: dump.pipelineFields,
      conflicts,
      bootMismatches,
      generatedAt: dump.generatedAt,
    };
    report.value = payload;
    // Dispatch the typed event AFTER state is set so listeners can read it.
    frontendHooks.dispatch("hook-inspector:report", payload);
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

const allStages = computed(() => {
  if (!report.value) return [] as string[];
  const stages = new Set<string>([
    ...Object.keys(report.value.backend),
    ...Object.keys(report.value.frontend),
  ]);
  return [...stages].sort();
});

function handlersForStage(stage: string): HandlerInfo[] {
  if (!report.value) return [];
  return [
    ...(report.value.backend[stage] ?? []),
    ...(report.value.frontend[stage] ?? []),
  ];
}

function conflictsForStage(stage: string) {
  if (!report.value) return [];
  return report.value.conflicts.filter((c) => c.stage === stage);
}

onMounted(loadReport);
</script>

<template>
  <section class="hook-inspector">
    <header class="hook-inspector__header">
      <h2>Hook 檢視</h2>
      <button class="themed-btn" :disabled="loading" @click="loadReport">
        {{ loading ? "載入中…" : "重新整理" }}
      </button>
    </header>

    <p v-if="errorMsg" class="hook-inspector__error">{{ errorMsg }}</p>

    <div v-if="report" class="hook-inspector__body">
      <p class="hook-inspector__meta">
        產生時間：{{ new Date(report.generatedAt).toLocaleString() }}
        ・衝突數：{{ report.conflicts.length }}
        ・Boot 不一致：{{ report.bootMismatches.length }}
      </p>

      <details
        v-if="report.bootMismatches.length"
        class="hook-inspector__mismatches"
        open
      >
        <summary>Boot 不一致 ({{ report.bootMismatches.length }})</summary>
        <ul>
          <li v-for="m in report.bootMismatches" :key="m.plugin">
            <strong>{{ m.plugin }}</strong>
            ・declared-only: [{{ m.declaredOnly.join(", ") || "—" }}]
            ・registered-only: [{{ m.registeredOnly.join(", ") || "—" }}]
          </li>
        </ul>
      </details>

      <StageBlock
        v-for="stage in allStages"
        :key="stage"
        :stage="stage"
        :handlers="handlersForStage(stage)"
        :conflicts="conflictsForStage(stage)"
      />
    </div>
  </section>
</template>

<style scoped>
.hook-inspector {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1000px;
}
.hook-inspector__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.hook-inspector__error {
  padding: 12px;
  border: 1px solid var(--accent-solid);
  border-radius: 4px;
  background: rgba(220, 38, 38, 0.1);
  color: var(--accent-solid);
}
.hook-inspector__meta {
  font-size: 0.875rem;
  opacity: 0.8;
}
.hook-inspector__mismatches {
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
}
</style>
