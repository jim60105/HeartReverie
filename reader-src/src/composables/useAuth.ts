import { ref, readonly } from "vue";
import type { UseAuthReturn, AuthHeaders } from "@/types";
import { renderDebug } from "@/lib/render-debug";

const STORAGE_KEY = "passphrase";

const passphrase = ref("");
const isAuthenticated = ref(false);

// Restore from sessionStorage on module load
const stored = sessionStorage.getItem(STORAGE_KEY);
if (stored) {
  passphrase.value = stored;
}

async function verify(value?: string): Promise<boolean> {
  const toVerify = value ?? passphrase.value;
  if (!toVerify) return false;

  try {
    const res = await fetch("/api/auth/verify", {
      headers: { "X-Passphrase": toVerify },
    });
    if (res.ok) {
      passphrase.value = toVerify;
      isAuthenticated.value = true;
      sessionStorage.setItem(STORAGE_KEY, toVerify);
      renderDebug("auth-verified");
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function getAuthHeaders(): AuthHeaders {
  return passphrase.value ? { "X-Passphrase": passphrase.value } : {};
}

export function useAuth(): UseAuthReturn {
  return {
    passphrase: readonly(passphrase),
    isAuthenticated,
    verify,
    getAuthHeaders,
  };
}
