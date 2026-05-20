// Narrow-viewport label-collapse guardrails for AppHeader (Issue 4).
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AppHeader from "@/components/AppHeader.vue";

const mockRouter = { push: vi.fn() };
const currentIndexRef = ref(1);
const totalChaptersRef = ref(3);
const chaptersRef = ref([
  { number: 1, content: "" },
  { number: 2, content: "" },
  { number: 3, content: "" },
]);
const isFirstRef = ref(false);
const isLastRef = ref(false);
const folderNameRef = ref("f");

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  useRoute: () => ({ fullPath: "/", path: "/" }),
}));

vi.mock("@/router", () => ({ toolsChildren: [], default: {} }));

vi.mock("@/composables/useChapterNav", () => ({
  useChapterNav: () => ({
    currentIndex: currentIndexRef,
    chapters: chaptersRef,
    totalChapters: totalChaptersRef,
    isFirst: isFirstRef,
    isLast: isLastRef,
    folderName: folderNameRef,
    next: vi.fn(),
    previous: vi.fn(),
    goToFirst: vi.fn(),
    goToLast: vi.fn(),
    reloadToLast: vi.fn().mockResolvedValue(undefined),
    getBackendContext: () => ({ series: null, story: null, isBackendMode: false }),
  }),
}));

vi.mock("@/components/StorySelector.vue", () => ({
  default: { template: "<div />" },
}));

describe("AppHeader nav-label collapse (Issue 4)", () => {
  it("wraps both prev and next button text in <span class=nav-label>", () => {
    const wrapper = mount(AppHeader);
    const labels = wrapper.findAll(".nav-label");
    expect(labels.length).toBe(2);
    const texts = labels.map((l) => l.text());
    expect(texts.some((t) => t.includes("上一章"))).toBe(true);
    expect(texts.some((t) => t.includes("下一章"))).toBe(true);
  });

  it("prev/next buttons carry explicit aria-labels", () => {
    const wrapper = mount(AppHeader);
    const prev = wrapper.findAll("button").find((b) => b.text().includes("上一章"));
    const next = wrapper.findAll("button").find((b) => b.text().includes("下一章"));
    expect(prev!.attributes("aria-label")).toBe("上一章");
    expect(next!.attributes("aria-label")).toBe("下一章");
  });

  it("preserves arrow glyph outside the .nav-label span (so it stays visible at narrow widths)", () => {
    const wrapper = mount(AppHeader);
    const prev = wrapper.findAll("button").find((b) => b.text().includes("上一章"))!;
    const next = wrapper.findAll("button").find((b) => b.text().includes("下一章"))!;
    // Arrow text is not inside .nav-label
    const prevLabel = prev.find(".nav-label").text();
    const nextLabel = next.find(".nav-label").text();
    expect(prevLabel).not.toContain("←");
    expect(nextLabel).not.toContain("→");
    expect(prev.text()).toContain("←");
    expect(next.text()).toContain("→");
  });

  it("declares the @media (max-width: 409px) { .nav-label { display: none } } rule", () => {
    const testFilePath = (import.meta as { filename?: string }).filename
      ?? fileURLToPath(import.meta.url);
    const sfcPath = resolve(dirname(testFilePath), "..", "AppHeader.vue");
    const source = readFileSync(sfcPath, "utf8");
    const m = source.match(/@media\s*\(\s*max-width:\s*409px\s*\)\s*\{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    expect(m![1]!).toMatch(/\.nav-label\s*\{[^}]*display:\s*none/);
  });

  it("constrains .chapter-progress with overflow / ellipsis / min-width / flex-shrink", () => {
    const testFilePath = (import.meta as { filename?: string }).filename
      ?? fileURLToPath(import.meta.url);
    const sfcPath = resolve(dirname(testFilePath), "..", "AppHeader.vue");
    const source = readFileSync(sfcPath, "utf8");
    const m = source.match(/\n\.chapter-progress\s*\{([^}]*)\}/);
    expect(m).not.toBeNull();
    const body = m![1]!;
    expect(body).toMatch(/flex-shrink:\s*1/);
    expect(body).toMatch(/min-width:\s*0/);
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/text-overflow:\s*ellipsis/);
    expect(body).toMatch(/white-space:\s*nowrap/);
  });
});
