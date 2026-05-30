import type { NodePlugin } from "@/engine/plugin";
import { JSONStorageInspector } from "@/components/inspectors";
import { DATABASE } from "@/theme/colors";

const JSONStoragePlugin: NodePlugin = {
  type: "jsonStorage",
  meta: {
    label: "JSON Storage",
    icon: "💾",
    description: "Structured JSON file storage for messages and execution logs",
    category: "storage",
    color: DATABASE,
  },
  defaultData: { label: "JSON Storage", records: [] },
  inspector: JSONStorageInspector,
  // No executor — passive storage node
  handles: [
    { type: "target", position: "left", id: "left", style: { backgroundColor: DATABASE } },
    { type: "target", position: "right", id: "right", style: { backgroundColor: DATABASE } },
    { type: "target", position: "top", id: "top", style: { backgroundColor: DATABASE } },
    { type: "target", position: "bottom", id: "bottom", style: { backgroundColor: DATABASE } },
  ],
};

export default JSONStoragePlugin;
