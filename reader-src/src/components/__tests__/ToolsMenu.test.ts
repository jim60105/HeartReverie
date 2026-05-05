import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import ToolsMenu from "@/components/ToolsMenu.vue";

vi.mock("@/router", () => ({
  toolsChildren: [
    {
      path: "alpha",
      name: "tools-alpha",
      component: { template: "<div>alpha</div>" },
      meta: { title: "Alpha Tool" },
    },
    {
      path: "beta",
      name: "tools-beta",
      component: { template: "<div>beta</div>" },
      meta: { title: "Beta Tool" },
    },
  ],
}));

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div>home</div>" } },
      {
        path: "/tools/alpha",
        name: "tools-alpha",
        component: { template: "<div>alpha</div>" },
      },
      {
        path: "/tools/beta",
        name: "tools-beta",
        component: { template: "<div>beta</div>" },
      },
    ],
  });
}

async function mountWithRouter() {
  const router = makeRouter();
  await router.push("/");
  await router.isReady();
  const wrapper = mount(ToolsMenu, { global: { plugins: [router] } });
  return { wrapper, router };
}

describe("ToolsMenu", () => {
  const mounted: Array<{ unmount: () => void }> = [];
  const mountWithRouterTracked = async () => {
    const result = await mountWithRouter();
    mounted.push(result.wrapper);
    return result;
  };
  afterEach(() => {
    while (mounted.length) mounted.pop()!.unmount();
    document.body.innerHTML = "";
  });

  it("dropdown is closed by default", async () => {
    const { wrapper } = await mountWithRouterTracked();
    expect(wrapper.find(".tools-menu__panel").exists()).toBe(false);
  });

  it("clicking trigger opens the dropdown and lists tools from registry", async () => {
    const { wrapper } = await mountWithRouterTracked();
    await wrapper.find("button").trigger("click");
    const items = wrapper.findAll(".tools-menu__item");
    expect(items).toHaveLength(2);
    expect(items[0]!.text()).toBe("Alpha Tool");
    expect(items[1]!.text()).toBe("Beta Tool");
  });

  it("clicking the trigger again closes the dropdown", async () => {
    const { wrapper } = await mountWithRouterTracked();
    const btn = wrapper.find("button");
    await btn.trigger("click");
    expect(wrapper.find(".tools-menu__panel").exists()).toBe(true);
    await btn.trigger("click");
    expect(wrapper.find(".tools-menu__panel").exists()).toBe(false);
  });

  it("clicking a tool item navigates and closes the dropdown", async () => {
    const { wrapper, router } = await mountWithRouterTracked();
    await wrapper.find("button").trigger("click");
    const items = wrapper.findAll(".tools-menu__item");
    await items[1]!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("tools-beta");
    expect(wrapper.find(".tools-menu__panel").exists()).toBe(false);
  });

  it("Escape closes the dropdown and refocuses the trigger", async () => {
    const { wrapper } = await mountWithRouterTracked();
    document.body.appendChild(wrapper.element);
    const btn = wrapper.find("button").element as HTMLButtonElement;
    btn.click();
    await nextTick();
    expect(wrapper.find(".tools-menu__panel").exists()).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await nextTick();
    expect(wrapper.find(".tools-menu__panel").exists()).toBe(false);
    expect(document.activeElement).toBe(btn);
  });

  it("outside click closes the dropdown", async () => {
    const { wrapper } = await mountWithRouterTracked();
    document.body.appendChild(wrapper.element);
    await wrapper.find("button").trigger("click");
    expect(wrapper.find(".tools-menu__panel").exists()).toBe(true);
    document.body.click();
    await nextTick();
    expect(wrapper.find(".tools-menu__panel").exists()).toBe(false);
  });

  it("dropdown panel is rendered as a descendant of the component root (no Teleport)", async () => {
    const { wrapper } = await mountWithRouterTracked();
    await wrapper.find("button").trigger("click");
    const panel = wrapper.find(".tools-menu__panel");
    expect(panel.exists()).toBe(true);
    expect(wrapper.element.contains(panel.element)).toBe(true);
  });

  it("navigating away closes the dropdown", async () => {
    const { wrapper, router } = await mountWithRouterTracked();
    await wrapper.find("button").trigger("click");
    expect(wrapper.find(".tools-menu__panel").exists()).toBe(true);
    await router.push({ name: "tools-alpha" });
    await flushPromises();
    expect(wrapper.find(".tools-menu__panel").exists()).toBe(false);
  });

  it("ArrowDown on the trigger opens the menu and focuses the first item", async () => {
    const { wrapper } = await mountWithRouterTracked();
    document.body.appendChild(wrapper.element);
    const btn = wrapper.find("button").element as HTMLButtonElement;
    btn.focus();
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await nextTick();
    await nextTick();
    const items = wrapper.findAll(".tools-menu__item");
    expect(items).toHaveLength(2);
    expect(document.activeElement).toBe(items[0]!.element);
  });

  it("ArrowDown / ArrowUp / Home / End cycle focus among menu items", async () => {
    const { wrapper } = await mountWithRouterTracked();
    document.body.appendChild(wrapper.element);
    const btn = wrapper.find("button").element as HTMLButtonElement;
    btn.focus();
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await nextTick();
    await nextTick();
    const items = wrapper.findAll(".tools-menu__item").map((w) => w.element as HTMLElement);
    expect(document.activeElement).toBe(items[0]);
    items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await nextTick();
    expect(document.activeElement).toBe(items[1]);
    items[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    await nextTick();
    expect(document.activeElement).toBe(items[0]);
    items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await nextTick();
    expect(document.activeElement).toBe(items[1]);
    items[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    await nextTick();
    expect(document.activeElement).toBe(items[0]);
  });
});
