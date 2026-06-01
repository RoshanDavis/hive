import type { NodePlugin } from "@/engine/plugin";
import { TriggerInspector } from "@/components/inspectors";

const TriggerPlugin: NodePlugin = {
  type: "trigger",
  meta: {
    label: "Trigger",
    icon: "⚡",
    description: "Starts the workflow when clicked",
    category: "input",
  },
  defaultData: { label: "Trigger" },
  inspector: TriggerInspector,
  // No executor — passive node, handled by engine default passthrough
  handles: [
    { type: "source", position: "right" },
  ],
};

export default TriggerPlugin;
