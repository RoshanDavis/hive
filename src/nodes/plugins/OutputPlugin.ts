import type { NodePlugin } from "@/engine/plugin";
import { OutputExecutor } from "@/engine/OutputExecutor";
import { OutputInspector } from "@/components/inspectors";

const OutputPlugin: NodePlugin = {
  type: "outputNode",
  meta: {
    label: "Output",
    icon: "📤",
    description: "Displays the output",
    category: "output",
    color: "#fb923c",
  },
  defaultData: { label: "Output" },
  inspector: OutputInspector,
  executor: new OutputExecutor(),
  aliases: ["output"],
  // Default handles (target-left, source-right)
};

export default OutputPlugin;
