import { mount, unmount } from "svelte";
import Chat from "./Chat.svelte";
import type { ProviderUiContext } from "./host";

/** PlaneAI mounts this into the provider session's sandboxed frame. */
const entrypoint = {
  mount(root: HTMLElement, context: ProviderUiContext): () => void {
    const app = mount(Chat, { target: root, props: { context } });
    return () => void unmount(app);
  },
};

export default entrypoint;
