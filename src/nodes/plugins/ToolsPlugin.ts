import type { NodePlugin } from "@/engine/plugin";
import { ToolsInspector } from "@/components/inspectors";

// Tools container: a selection of native tools / MCP servers / skills that an
// Agent's Tools slot can hold. No executor — it's configuration consumed by the
// Agent's tool-calling loop (see docs/agent-node.md). Declares the web_search
// credential schema so the Tools picker can bind a Brave Search API key (the
// schema registry is global, so the Agent inspector's picker sees it too).
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
  // No input/output ports: a Tools node isn't wired into the graph — it's config
  // dragged into an Agent's Tools slot. (Empty array = render no handles.)
  handles: [],
  inspector: ToolsInspector,
  credentialSchemas: [
    {
      type: "webSearch",
      label: "Brave Search API Key",
      provider: "Brave",
      icon: "🔎",
      fields: [
        {
          key: "apiKey",
          label: "API Key",
          type: "password",
          required: true,
          placeholder: "BSA...",
        },
      ],
    },
    {
      // Generic bearer/API-key credential for user-defined HTTP tools. Injected
      // server-side as a header (default `Authorization: Bearer <apiKey>`).
      type: "apiToken",
      label: "API Token / Key",
      provider: "Custom",
      icon: "🔑",
      fields: [
        {
          key: "apiKey",
          label: "Token / API Key",
          type: "password",
          required: true,
          placeholder: "sk-…",
        },
      ],
    },
  ],
};

export default ToolsPlugin;
