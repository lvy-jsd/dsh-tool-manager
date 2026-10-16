# dsh-tool-manager（monorepo）

[English](README.md) | 中文

为 DeepSeek Harness 按需加载工具：所有工具都组织成一个目录
（分类 → 分组 → 工具），只有 Agent 主动加载的部分才会进入模型上下文。
整体是一个小的核心加若干可替换的扩展插件。

## 快速开始

```sh
# 1. 安装核心包和基于规则的分类器（可选，但推荐）
dsh plugin --profile web add @lvy-jsd/dsh-tool-manager @lvy-jsd/dsh-tool-manager-classifier-rules

# 2. 重启 DSH，然后问 Agent："你有哪些工具？"
#    它会用 tools_ls("/") 回答 —— 是一个目录，不是 200 个工具 schema

# 3. 想要界面？装上面板，然后打开 设置 →"工具管理"
dsh plugin --profile web add @lvy-jsd/dsh-tool-manager-panel
```

全新安装后，所有分组都归在 `uncategorized` 下，直到装上分类器 ——
工具本身仍然可以浏览和加载，只是缺了分类。想自己写分类器见
[扩展](#extending)。

| 包 | 作用 |
|---|---|
| [`@lvy-jsd/dsh-tool-manager`](packages/dsh-tool-manager) | 核心：目录、`tools_ls` / `tools_load` / `tools_unload`、按 Agent 的可见白名单、`toolCatalog` 扩展服务。没有扩展时所有分组都在 `uncategorized` 下。 |
| [`@lvy-jsd/dsh-tool-manager-classifier-rules`](packages/dsh-tool-manager-classifier-rules) | 按内置规则和你的配置覆盖，把分组放进分类。 |
| [`@lvy-jsd/dsh-tool-manager-risk-gate`](packages/dsh-tool-manager-risk-gate) | 通过 DSH 的审批通道确认高危工具的加载，并支持按会话的白名单。 |
| [`@lvy-jsd/dsh-tool-manager-persist`](packages/dsh-tool-manager-persist) | DSH 重启后保留已加载的工具，每个会话一个状态文件。 |
| [`@lvy-jsd/dsh-tool-manager-panel`](packages/dsh-tool-manager-panel) | 网页面板：浏览目录树、查看每个活动会话已加载的工具和 token 开销，并在界面上加载 / 卸载。 |
| [`@lvy-jsd/dsh-tool-manager-classifier-llm`](packages/dsh-tool-manager-classifier-llm) | 用小模型给分组分类，每个分组一次请求，按分组及其工具描述的哈希缓存结果。 |
| [`@lvy-jsd/dsh-tool-manager-capability-bridge`](packages/dsh-tool-manager-capability-bridge) | 一次调用加载一组具名工具：`tools_load(["cap:android-debug"])`。 |
| [`@lvy-jsd/dsh-tool-manager-attribution-scan`](packages/dsh-tool-manager-attribution-scan) | 按定义这些工具的源码所属的插件包来分组。 |
| [`@lvy-jsd/dsh-tool-manager-dsbot-entry`](packages/dsh-tool-manager-dsbot-entry) | 在 ds-bot 的设置弹窗里加一行"工具管理"，点开显示面板。 |
| [`@lvy-jsd/create-tool-manager-plugin`](packages/create-tool-manager-plugin) | 生成你自己的扩展：`npm create @lvy-jsd/tool-manager-plugin@latest my-ext -- --type classifier`。 |

设计说明见 [docs/DESIGN.md](docs/DESIGN.md)。

<a id="extending"></a>
## 扩展

核心之外的所有功能都是使用 `toolCatalog` 服务的普通插件，仓库里的
`classifier-rules` 就是完全按第三方的写法写的。有四个扩展点：

| 扩展点 | 用途 |
|---|---|
| `registerClassifier({ name, priority, group?, categorize? })` | 把工具放进分组、把分组放进分类 |
| `annotate(match, { group?, category?, risk?, summary? })` | 运行时元数据；`package.json` 里的 `dsh.toolCatalog` 不用写代码也能达到同样效果 |
| `registerVisibilityFilter({ name, filter(agent, names) })` | 收窄某个 Agent 能看到的范围 —— 只能移除名字 |
| `registerTargetResolver({ name, prefix, resolve })` | 认领一个目标前缀，例如 `cap:<name>` |
| `registerRiskGate` / `registerStateProvider` | 确认高危工具的加载 / 跨重启保留状态 |

钩子就是普通事件：`tool-catalog/before-load`（抛异常即否决）、
`after-load`、`before-unload`、`after-unload`、`before-rebuild`、
`after-rebuild`、`state-changed`。

从一个生成出来的包开始 —— 它自带一个能跑通的测试：

```sh
npm create @lvy-jsd/tool-manager-plugin@latest my-ext -- --type classifier
cd my-ext && npm test
```

[`examples/`](examples) 里有两个完整的例子，完整接口列表在核心包的
README 和 [docs/DESIGN.md](docs/DESIGN.md) 第 11 节。

## 开发与测试

所有包都用 TypeScript 编写（`src/`），编译到 `lib/`（JavaScript 加 `.d.ts` 类型声明）；
`lib/` 是构建产物，不进 git。根目录 `tsconfig.json` 列出所有包（项目引用）；两个浏览器端模块
（`client.ts`）有各自的 `tsconfig.client.json`，因为 DSH 把它们当作经典脚本而不是模块加载。

```sh
npm install                        # 同时把本机 DSH 的宿主包链接进来（scripts/link-host.mjs）
npm run build                      # src/*.ts -> lib/*.js + lib/*.d.ts
npm run typecheck                  # 严格类型检查（tsc -b；项目引用需要声明文件，所以也会写 lib/）
node --test test/unit/*.test.mjs   # 纯 catalog 与注册表测试（需先构建）
node test/e2e.mjs                  # 启动一次性 DSH 实例；绝不碰你的正式 profile
```

宿主包（`@deepseek-ai/*`）是 peer 依赖，永远不从 npm 安装（`.npmrc` 设了
`legacy-peer-deps`）：插件旁边多一份 npm 的副本，会遮蔽你实际运行的 DSH。
`npm install` 会改为从 `$DSH_APP`（默认 `~/.local/share/deepseek-harness/app`）链接。

端到端测试在临时 `DSH_HOME` 里为每个 profile 启动仓库自带的 `headless`
profile（`core`、`rules`、`preset`、`persist`、`attr`、`attr-rules`、
`exempt`、`gate`、`cap`、`llm`），挂上一个测试配套插件和一个写好脚本的、
兼容 OpenAI 的假模型，记录每次模型请求的确切工具列表。面板的服务端半边由单元测试覆盖，在真实的 HTTP socket
上跑它的路由。

## 许可

MIT —— 见 [LICENSE](LICENSE)。
