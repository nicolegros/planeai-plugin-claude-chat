import { mount, unmount } from "svelte";
import type { PreferencesUiContext } from "./host";
import Preferences from "./Preferences.svelte";

/** PlaneAI mounts this into the plugin's section of Preferences → Plugins. */
const entrypoint = {
  mount(root: HTMLElement, context: PreferencesUiContext): () => void {
    const app = mount(Preferences, { target: root, props: { context } });
    return () => void unmount(app);
  },
};

export default entrypoint;
