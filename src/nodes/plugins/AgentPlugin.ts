import type { NodePlugin } from "@/engine/plugin";
import AgentNode from "@/nodes/AgentNode";
import { AgentInspector } from "@/components/inspectors";
import { AgentExecutor } from "@/engine/AgentExecutor";
import LLMPlugin from "./LLMPlugin";

// Composite "Agent" node: an LLM + memory (storage) + tools bundled as one node
// with a single input and output port. The inner parts are slots in node.data
// (not nested React-Flow nodes). See docs/agent-node.md.
const AgentPlugin: NodePlugin = {
  type: "agent",
  meta: {
    label: "Agent",
    icon: "🤖",
    description: "Autonomous agent: an LLM with memory (storage) and tools",
    category: "processing",
  },
  defaultData: {
    label: "Agent",
    llm: null,
    storage: null,
    tools: null,
  },
  component: AgentNode,
  inspector: AgentInspector,
  executor: new AgentExecutor(),
  // The LLM slot consumes the same credential shapes the LLM node does, so the
  // inline "Add credential" form works from inside the Agent inspector.
  credentialSchemas: LLMPlugin.credentialSchemas,
  // Informational; AgentExecutor resolves local-vs-cloud per call via callLlm.
  concurrencyPool: "cloud",
};

export default AgentPlugin;
