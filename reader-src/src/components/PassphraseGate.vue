<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuth } from "@/composables/useAuth";

const emit = defineEmits<{ unlocked: [] }>();

const { isAuthenticated, verify } = useAuth();

const inputValue = ref("");
const errorText = ref("");
const submitting = ref(false);

onMounted(async () => {
  const valid = await verify();
  if (valid) {
    emit("unlocked");
  }
});

async function handleSubmit() {
  const value = inputValue.value.trim();
  if (!value) {
    errorText.value = "請輸入通行密語";
    return;
  }

  submitting.value = true;
  errorText.value = "";

  const valid = await verify(value);
  if (valid) {
    emit("unlocked");
  } else {
    errorText.value = "通行密語錯誤";
  }
  submitting.value = false;
}
</script>

<template>
  <div v-if="isAuthenticated">
    <slot />
  </div>
  <div v-else class="gate-overlay">
    <div class="gate-card">
      <h2 class="gate-title">🔒 通行密語</h2>
      <form @submit.prevent="handleSubmit">
        <input type="text" autocomplete="username" value="reader" hidden aria-hidden="true">
        <input
          v-model="inputValue"
          type="password"
          autocomplete="current-password"
          placeholder="輸入通行密語…"
          class="gate-input"
          :disabled="submitting"
        >
        <div class="gate-actions">
          <span v-if="errorText" class="gate-error">{{ errorText }}</span>
          <button
            type="submit"
            class="themed-btn gate-submit"
            :disabled="submitting"
          >
            {{ submitting ? '驗證中…' : '進入' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.gate-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.gate-card {
  background: var(--panel-bg);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 2rem;
  max-width: 400px;
  width: 90%;
  text-align: center;
}

.gate-title {
  color: var(--text-title);
  margin-bottom: 1rem;
  font-family: var(--font-system-ui);
}

.gate-input {
  width: 100%;
  padding: 10px;
  background: var(--item-bg);
  border: 1px solid var(--item-border);
  border-radius: 8px;
  color: var(--text-main);
  font-size: var(--font-base);
  font-family: var(--font-system-ui);
  box-sizing: border-box;
  margin-bottom: 12px;
}

.gate-input:focus {
  outline: none;
  border-color: var(--text-title);
}

.gate-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  align-items: center;
}

.gate-error {
  color: #ff6b6b;
  font-size: 0.875rem;
}

.gate-submit {
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  color: var(--text-name);
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
}

.gate-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
