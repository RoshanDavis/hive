import type { NodePlugin } from "@/engine/plugin";
import { NotifyExecutor } from "@/engine/NotifyExecutor";
import { NotifyInspector } from "@/components/inspectors";
import { NODE_COLORS } from "@/theme/colors";

const NotifyPlugin: NodePlugin = {
  type: "notify",
  meta: {
    label: "Notify",
    icon: "🔔",
    description: "Sends an OS notification",
    category: "output",
    color: NODE_COLORS.notify,
  },
  defaultData: { label: "Notify", message: "{input.value}", output: "{input.value}" },
  inspector: NotifyInspector,
  executor: new NotifyExecutor(),
  // Default handles (target-left, source-right)
};

export default NotifyPlugin;
