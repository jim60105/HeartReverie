import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";

const MainLayout = () => import("@/components/MainLayout.vue");
const SettingsLayout = () => import("@/components/SettingsLayout.vue");
const PromptEditorPage = () => import("@/components/PromptEditorPage.vue");

export const settingsChildren: RouteRecordRaw[] = [
  {
    path: "prompt-editor",
    name: "settings-prompt-editor",
    component: PromptEditorPage,
    meta: { title: "編排器" },
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
      path: "/:pathMatch(.*)*",
      redirect: "/",
    },
  ],
});

export default router;
