export type FlowDirection = "one-way" | "bi-directional" | "read-only" | "write-only" | "read-write";
export type AllowedFlowOption =
  | "one-way"
  | "bi-directional"
  | "both"
  | "database"
  | "database-read"
  | "database-write";

export interface NodeConnectionRule {
  sourceType: string;
  targetType: string;
  allowedOption: AllowedFlowOption;
  defaultFlow: FlowDirection;
}

// Declarative registry of allowed edge behaviors based on connected node types.
const CONNECTION_RULES: NodeConnectionRule[] = [
  {
    sourceType: "chat",
    targetType: "ollama",
    allowedOption: "both", // User can toggle between one-way and bi-directional flow
    defaultFlow: "bi-directional",
  },
  // Add future multi-way conversational/processing nodes here
];

/**
 * Resolves the rules and allowed configurations for a connection between two node types.
 */
export function getConnectionBehavior(
  sourceType: string | undefined,
  targetType: string | undefined,
  sourceHandle?: string | null | undefined,
  _targetHandle?: string | null | undefined
): { allowedOption: AllowedFlowOption; defaultFlow: FlowDirection } {
  if (!sourceType || !targetType) {
    return {
      allowedOption: "one-way",
      defaultFlow: "one-way",
    };
  }

  // Detect database connections (either source or target is a jsonStorage node)
  if (sourceType === "jsonStorage" || targetType === "jsonStorage") {
    if (sourceType === "chat" && targetType === "jsonStorage") {
      if (sourceHandle === "storage") {
        // Chat bottom handle connection: two-way chat sync that can be toggled
        return {
          allowedOption: "database",
          defaultFlow: "read-write",
        };
      } else {
        // Standard Chat logic output connected to storage: locked to write-only
        return {
          allowedOption: "database-write",
          defaultFlow: "write-only",
        };
      }
    } else if (sourceType === "jsonStorage" && targetType === "chat") {
      // Storage connected to Chat: locked to read-only
      return {
        allowedOption: "database-read",
        defaultFlow: "read-only",
      };
    } else if (targetType === "jsonStorage") {
      // Logic node connected to storage: locked to write-only
      return {
        allowedOption: "database-write",
        defaultFlow: "write-only",
      };
    } else {
      // Storage connected to logic node: locked to read-only
      return {
        allowedOption: "database-read",
        defaultFlow: "read-only",
      };
    }
  }

  const rule = CONNECTION_RULES.find(
    (r) => r.sourceType === sourceType && r.targetType === targetType
  );

  if (rule) {
    return {
      allowedOption: rule.allowedOption,
      defaultFlow: rule.defaultFlow,
    };
  }

  // Default fallback for any unregistered node pairs: strictly unidirectional (one-way only)
  return {
    allowedOption: "one-way",
    defaultFlow: "one-way",
  };
}
