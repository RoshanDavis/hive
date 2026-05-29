import type { NodePlugin } from "@/engine/plugin";
import { TriggerInspector } from "@/components/inspectors";
import { NODE_COLORS } from "@/theme/colors";

const TriggerPlugin: NodePlugin = {
  type: "trigger",
  meta: {
    label: "Trigger",
    icon: "⚡",
    description: "Starts the workflow when clicked",
    category: "input",
    color: NODE_COLORS.trigger,
  },
  defaultData: { label: "Trigger" },
  inspector: TriggerInspector,
  // No executor — passive node, handled by engine default passthrough
  handles: [
    { type: "source", position: "right" },
  ],
};

export default TriggerPlugin;
