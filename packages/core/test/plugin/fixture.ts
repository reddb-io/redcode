import { AgentV2 } from "@reddb-io/redcode-core/agent"
import { AISDK } from "@reddb-io/redcode-core/aisdk"
import { CapabilityRegistry } from "@reddb-io/redcode-core/capability"
import { Catalog } from "@reddb-io/redcode-core/catalog"
import { CommandV2 } from "@reddb-io/redcode-core/command"
import { Credential } from "@reddb-io/redcode-core/credential"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNodePlatform } from "@reddb-io/redcode-core/effect/app-node-platform"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { FileSystem } from "@reddb-io/redcode-core/filesystem"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { Integration } from "@reddb-io/redcode-core/integration"
import { Location } from "@reddb-io/redcode-core/location"
import { Npm } from "@reddb-io/redcode-core/npm"
import { OperationHook } from "@reddb-io/redcode-core/operation-hook"
import { PluginV2 } from "@reddb-io/redcode-core/plugin"
import { Reference } from "@reddb-io/redcode-core/reference"
import { SkillV2 } from "@reddb-io/redcode-core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

const capabilityLayer = CapabilityRegistry.defaultLayer

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    OperationHook.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    CapabilityRegistry.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
    [CapabilityRegistry.node, capabilityLayer],
  ],
)
