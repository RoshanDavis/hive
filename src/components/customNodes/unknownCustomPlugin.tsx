import type { Node } from "@xyflow/react";
import type { NodePlugin } from "@/engine/plugin";

/** Inspector shown for a custom node whose definition is missing from disk. */
function UnknownCustomInspector({ node }: { node: Node }) {
  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3.5 flex flex-col gap-2 backdrop-blur-md">
      <div className="flex items-start gap-2.5">
        <span className="text-lg leading-none select-none">❓</span>
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <span className="text-xs uppercase tracking-widest text-red-400 font-bold">
            Custom node definition missing
          </span>
          <p className="text-[11px] text-text-secondary leading-relaxed wrap-break-word m-0">
            This node references a custom type that isn't available in this workspace. It may have
            been deleted, or it's a global custom node authored on another machine. The node is kept
            as a placeholder so your workflow isn't lost — re-create or import the definition to
            restore it.
          </p>
          <span className="mt-1 text-[10px] font-mono text-text-muted bg-input border border-border-subtle rounded px-1.5 py-0.5 self-start">
            {String(node.type)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Build a throwaway placeholder plugin for a `custom:<id>` type that has no
 * definition on disk. Renders via GenericNodeShell (❓ icon) and has no executor,
 * so the engine passes the upstream envelope straight through.
 */
export function makeUnknownCustomPlugin(type: string): NodePlugin {
  return {
    type,
    meta: {
      label: "Unknown custom node",
      icon: "❓",
      color: "#ef4444",
      category: "custom",
      description: "Missing custom-node definition",
    },
    defaultData: {},
    inspector: UnknownCustomInspector,
  };
}
