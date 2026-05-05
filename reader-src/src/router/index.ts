import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";

const MainLayout = () => import("@/components/MainLayout.vue");
const SettingsLayout = () => import("@/components/SettingsLayout.vue");
const ToolsLayout = () => import("@/components/ToolsLayout.vue");
const PromptEditorPage = () => import("@/components/PromptEditorPage.vue");
const LoreCodexPage = () => import("@/components/lore/LoreCodexPage.vue");
const LlmSettingsPage = () => import("@/components/LlmSettingsPage.vue");
const ThemeSettingsPage = () => import("@/components/ThemeSettingsPage.vue");
const QuickAddPage = () => import("@/components/QuickAddPage.vue");
const ImportCharacterCardPage = () =>
  import("@/components/ImportCharacterCardPage.vue");
const PluginSettingsPage = () =>
  import("@/components/PluginSettingsPage.vue");

export const settingsChildren: RouteRecordRaw[] = [
  {
    path: "prompt-editor",
    name: "settings-prompt-editor",
    component: PromptEditorPage,
    meta: { title: "編排器" },
  },
  {
    path: "lore",
    name: "settings-lore",
    component: LoreCodexPage,
    meta: { title: "典籍" },
  },
  {
    path: "llm",
    name: "settings-llm",
    component: LlmSettingsPage,
    meta: { title: "LLM 設定" },
  },
  {
    path: "theme",
    name: "settings-theme",
    component: ThemeSettingsPage,
    meta: { title: "主題" },
  },
  {
    path: "plugins/:pluginName",
    name: "settings-plugin",
    component: PluginSettingsPage,
    props: true,
  },
];

export const toolsChildren: RouteRecordRaw[] = [
  {
    path: "new-series",
    name: "tools-new-series",
    component: QuickAddPage,
    meta: { title: "快速新增" },
  },
  {
    path: "import-character-card",
    name: "tools-import-character-card",
    component: ImportCharacterCardPage,
    meta: { title: "ST 角色卡轉換工具" },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      component: MainLayout,
    },
    {
      path: "/:series/:story",
      name: "story",
      component: MainLayout,
    },
    {
      path: "/:series/:story/chapter/:chapter([1-9]\\d*)",
      name: "chapter",
      component: MainLayout,
    },
    {
      path: "/settings",
      component: SettingsLayout,
      redirect: { name: "settings-prompt-editor" },
      children: settingsChildren,
    },
    {
      path: "/tools",
      component: ToolsLayout,
      redirect: { name: "tools-new-series" },
      children: toolsChildren,
    },
    {
      path: "/:pathMatch(.*)*",
      redirect: "/",
    },
  ],
});

export default router;
