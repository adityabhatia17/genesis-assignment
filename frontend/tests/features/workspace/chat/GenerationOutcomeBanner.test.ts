import { createTestingPinia } from "@pinia/testing";
import { mount } from "@vue/test-utils";
import {
  initialGenerationState,
  type GenerationState,
} from "@/features/workspace/stores/generation.reducer";

vi.mock("vue-sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
const { useGenerationStore } =
  await import("@/features/workspace/stores/generation.store");
const { default: Banner } =
  await import("@/features/workspace/chat/GenerationOutcomeBanner.vue");

function render(state: Partial<GenerationState>) {
  const pinia = createTestingPinia({ createSpy: vi.fn });
  const store = useGenerationStore(pinia);
  store.state = { ...initialGenerationState(), ...state };
  return { wrapper: mount(Banner, { global: { plugins: [pinia] } }), store };
}

describe("GenerationOutcomeBanner", () => {
  it("offers Apply / Discard / Retry for an interrupted generation with finished files", async () => {
    const { wrapper, store } = render({
      status: "interrupted",
      prompt: "Build it",
      error: {
        code: "GENERATION_INTERRUPTED",
        message: "The connection was lost during generation.",
        retryable: true,
      },
      partial: { stagedPaths: ["index.html", "styles.css"], applyable: true },
    });
    expect(wrapper.text()).toContain("2 files were completed");
    const button = (label: string) =>
      wrapper.findAll("button").find((b) => b.text().includes(label))!;
    await button("Apply 2 files").trigger("click");
    await button("Discard").trigger("click");
    await button("Retry").trigger("click");
    expect(store.applyPartial).toHaveBeenCalled();
    expect(store.discardPartial).toHaveBeenCalled();
    expect(store.retry).toHaveBeenCalled();
  });

  it("lists rejected files after a completed generation", () => {
    const { wrapper } = render({
      status: "completed",
      result: {
        snapshotId: "s",
        snapshotSeq: 2,
        changedPaths: [],
        deletedPaths: [],
        noChanges: false,
        rejected: [
          {
            path: "app.js",
            issues: [
              {
                code: "JS_SYNTAX",
                message: "Unexpected token",
                severity: "error",
              },
            ],
          },
        ],
      },
    });
    expect(wrapper.get('[data-testid="rejected-banner"]').text()).toContain(
      "app.js — Unexpected token",
    );
  });

  it("renders nothing while idle", () => {
    expect(render({}).wrapper.html()).toBe("<!--v-if-->");
  });
});
