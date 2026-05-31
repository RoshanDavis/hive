import { api } from "@/services/api";
import { concurrencyGovernor } from "@/services/concurrency";
import type { ExecutionContext, NodeExecutor, NodeOutputEnvelope } from "./types";
import { getUpstreamNodeEnvelope, getUpstreamNodes } from "./utils";
import { getLastInput, setOutputEnvelope } from "./nodeData";

/**
 * Safely resolves a dot-separated property path on an object.
 * e.g. resolvePath({ input: { value: "hello" } }, "input.value") => "hello"
 */
function resolvePath(obj: any, path: string): any {
  return path.split('.').reduce((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[key];
  }, obj);
}

function evaluateTemplate(template: string, inputEnvelope: NodeOutputEnvelope): string {
  if (!template) return "";
  
  return template.replace(/\{([^{}]+)\}/g, (match, expression) => {
    try {
      const path = expression.trim();
      const context = { input: inputEnvelope };
      const result = resolvePath(context, path);
      
      if (result === undefined || result === null) {
        return "";
      }
      if (typeof result === "object") {
        return JSON.stringify(result);
      }
      return String(result);
    } catch (err) {
      console.warn(`[Template Evaluation Error] Failed to evaluate: ${expression}`, err);
      return match;
    }
  });
}


export class NotifyExecutor implements NodeExecutor {
  async execute(context: ExecutionContext): Promise<void> {
    const { node, nodes, edges, updateNodeData, showToast, visited } = context;
    await concurrencyGovernor.enqueue("general", async () => {
      try {
        // Check if we are retrying and already have a saved lastInputEnvelope.
        let resolvedEnvelope: NodeOutputEnvelope | null =
          getLastInput<NodeOutputEnvelope>(node.data, "lastInputEnvelope") ?? null;

        if (!resolvedEnvelope) {
          const upstreamNodes = getUpstreamNodes(node.id, edges, nodes, { visited });
          for (const upstream of upstreamNodes) {
            const env = getUpstreamNodeEnvelope(upstream);
            if (env) {
              resolvedEnvelope = env;
              break;
            }
          }
          if (!resolvedEnvelope) {
            resolvedEnvelope = { value: "" };
          }

          // Save resolved input envelope so we can reuse it on retry. The run
          // loop wipes `lastInput*` on every fresh trigger / chat send.
          updateNodeData(node.id, {
            ...node.data,
            lastInputEnvelope: resolvedEnvelope,
          });
        }

        // 1. Resolve notification body: message field (defaults to "{input.value}")
        const customMessage = String(node.data?.message !== undefined ? node.data.message : "{input.value}");
        const finalNotificationBody = evaluateTemplate(customMessage, resolvedEnvelope);

        // 2. Resolve output template field (defaults to "{input.value}")
        const outputTemplate = String(node.data?.output !== undefined ? node.data.output : "{input.value}");
        const finalOutputBody = evaluateTemplate(outputTemplate, resolvedEnvelope);

        const label = String(node.data?.label || "Hive");

        // Store standard JSON envelope and evaluated output body in node state
        const envelope: NodeOutputEnvelope = {
          value: finalOutputBody,
          metadata: {
            title: label,
            body: finalNotificationBody,
            timestamp: new Date().toISOString(),
          },
        };
        updateNodeData(node.id, setOutputEnvelope(node.data, envelope));

        await api.sendNotification(label, finalNotificationBody);
      } catch (err) {
        showToast(`Notify error: ${err}`, "error");
        throw err;
      }
    });
  }
}
