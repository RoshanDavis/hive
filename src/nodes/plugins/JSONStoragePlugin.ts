import type { NodePlugin } from "@/engine/plugin";
import { JSONStorageInspector } from "@/components/inspectors";

const JSONStoragePlugin: NodePlugin = {
  type: "jsonStorage",
  meta: {
    label: "JSON Storage",
    icon: "💾",
    description: "Structured JSON file storage for messages and execution logs",
    category: "storage",
    color: "#38bdf8",
  },
  defaultData: { label: "JSON Storage", records: [] },
  inspector: JSONStorageInspector,
  // No executor — passive storage node
  handles: [
    { type: "target", position: "left", id: "left", style: { backgroundColor: "#38bdf8" } },
    { type: "target", position: "right", id: "right", style: { backgroundColor: "#38bdf8" } },
    { type: "target", position: "top", id: "top", style: { backgroundColor: "#38bdf8" } },
    { type: "target", position: "bottom", id: "bottom", style: { backgroundColor: "#38bdf8" } },
  ],
};

export default JSONStoragePlugin;
