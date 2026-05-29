import { pluginRegistry } from "@/engine/pluginRegistry";
import TriggerPlugin from "./TriggerPlugin";
import NotifyPlugin from "./NotifyPlugin";
import LLMPlugin from "./LLMPlugin";
import ChatPlugin from "./ChatPlugin";
import OutputPlugin from "./OutputPlugin";
import JSONStoragePlugin from "./JSONStoragePlugin";

pluginRegistry.register(TriggerPlugin);
pluginRegistry.register(NotifyPlugin);
pluginRegistry.register(LLMPlugin);
pluginRegistry.register(ChatPlugin);
pluginRegistry.register(OutputPlugin);
pluginRegistry.register(JSONStoragePlugin);
