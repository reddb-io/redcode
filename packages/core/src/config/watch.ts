export * as ConfigWatch from "./watch.js"

import path from "path"
import { FSUtil } from "@opencode/util/fs-util"
import type { Watcher } from "../filesystem/watcher.js"
import type { ConfigDiscovery } from "./discovery.js"
import { SkillScan } from "./plugin/skill-scan.js"

export function plan(sources: ConfigDiscovery.Sources, runtimeDirectories: readonly string[] = []) {
  // Redcode's old global config shares a home with its live databases and caches.
  const legacyState = ["data", "cache", "state", "evaluations"]
  const directories = [
    ...(sources.legacyGlobal ? [sources.legacyGlobal] : []),
    ...(sources.global ? [sources.global] : []),
    ...sources.project.filter((root) => root.present).map((root) => root.path),
  ]
  const files = [
    ...sources.direct,
    ...sources.project.map((root) => root.path),
    ...sources.claude,
    ...sources.agents,
    ...(sources.explicit ? [sources.explicit] : []),
  ]
  // Keep a parent watch for each root so deletion/recreation is observable.
  const parents = Map.groupBy(
    files.filter((file) => !directories.some((directory) => file !== directory && FSUtil.contains(directory, file))),
    (file) => path.dirname(file),
  )
  return new Map(
    [
      ...directories.map((directory) => ({
        path: directory,
        type: "directory" as const,
        ignore: [
          ...SkillScan.ignoredDirectories,
          `**/{${SkillScan.ignoredDirectories.join(",")}}/**`,
          ...(directory === sources.legacyGlobal ? legacyState : []),
          // The shipped Redcode layout shares config with live service state.
          // Exclude the actual runtime paths, including non-default nested paths.
          ...runtimeDirectories
            .filter((runtime) => runtime !== directory && FSUtil.contains(directory, runtime))
            .map((runtime) => path.relative(directory, runtime)),
        ],
      })),
      ...Array.from(parents, ([parent, files]) => ({
        path: parent,
        type: "entries" as const,
        names: [...new Set(files.map((file) => path.basename(file)))].toSorted(),
      })),
    ].map((target) => [JSON.stringify(target), target satisfies Watcher.WatchInput]),
  )
}
