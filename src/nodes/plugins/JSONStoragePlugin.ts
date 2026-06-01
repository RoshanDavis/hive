import type { NodePlugin } from "@/engine/plugin";
import { JSONStorageInspector } from "@/components/inspectors";

// Handles tinted via the theme's --edge-database CSS variable so they track
// theme switches without re-rendering each handle.
const storageHandleStyle = { backgroundColor: "var(--edge-database)" };

const JSONStoragePlugin: NodePlugin = {
  type: "jsonStorage",
  meta: {
    label: "JSON Storage",
    icon: "💾",
    description: "Structured JSON file storage for messages and execution logs",
    category: "storage",
  },
  defaultData: { label: "JSON Storage", records: [] },
  inspector: JSONStorageInspector,
  // No executor — passive storage node
  handles: [
    { type: "target", position: "left", id: "left", style: storageHandleStyle },
    { type: "target", position: "right", id: "right", style: storageHandleStyle },
    { type: "target", position: "top", id: "top", style: storageHandleStyle },
    { type: "target", position: "bottom", id: "bottom", style: storageHandleStyle },
  ],
};

export default JSONStoragePlugin;
