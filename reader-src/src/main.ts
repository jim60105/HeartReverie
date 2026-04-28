import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { useLastReadingRoute } from "@/composables/useLastReadingRoute";

const app = createApp(App);
// Register the navigation guard BEFORE `app.use(router)` so the very first
// (router-induced) navigation is captured — otherwise direct entry to a
// reading URL like `/storyA/storyB/chapter/3` could be missed by the guard.
const { recordReadingRoute } = useLastReadingRoute();
router.afterEach((to) => {
  recordReadingRoute(to);
});
app.use(router);
app.mount("#app");
