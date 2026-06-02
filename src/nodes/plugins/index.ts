import { pluginRegistry } from "@/engine/pluginRegistry";
import TriggerPlugin from "./TriggerPlugin";
import NotifyPlugin from "./NotifyPlugin";
import LLMPlugin from "./LLMPlugin";
import ChatPlugin from "./ChatPlugin";
import OutputPlugin from "./OutputPlugin";
import JSONStoragePlugin from "./JSONStoragePlugin";
import ToolsPlugin from "./ToolsPlugin";
import AgentPlugin from "./AgentPlugin";

pluginRegistry.register(TriggerPlugin);
pluginRegistry.register(NotifyPlugin);
pluginRegistry.register(LLMPlugin);
pluginRegistry.register(ChatPlugin);
pluginRegistry.register(OutputPlugin);
pluginRegistry.register(JSONStoragePlugin);
pluginRegistry.register(ToolsPlugin);
pluginRegistry.register(AgentPlugin);
