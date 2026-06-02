import type { NodePlugin } from "@/engine/plugin";
import { ToolsInspector } from "@/components/inspectors";

// Tools container: a selection of native tools / MCP servers / skills that an
// Agent's Tools slot can hold. No executor — it's configuration consumed by the
// Agent. Runtime tool invocation is deferred (see docs/agent-node.md).
const ToolsPlugin: NodePlugin = {
  type: "toolsContainer",
  meta: {
    label: "Tools",
    icon: "🛠️",
    description: "Native tools, MCP servers, and skills for an Agent",
    category: "processing",
  },
  defaultData: {
    label: "Tools",
    native: [],
    mcp: [],
    skills: [],
  },
  inspector: ToolsInspector,
};

export default ToolsPlugin;
