import { createRouter, createWebHistory } from "vue-router";

const MainLayout = () => import("@/components/MainLayout.vue");

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
      path: "/:pathMatch(.*)*",
      redirect: "/",
    },
  ],
});

export default router;
