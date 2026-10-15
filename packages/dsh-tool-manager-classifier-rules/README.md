# dsh-tool-manager-classifier-rules

Rule-based classifier for [`dsh-tool-manager`](../dsh-tool-manager).

It registers up to two classifiers on the `toolCatalog` service:

| Classifier | Priority | Source |
|---|---|---|
| `rules:user` | 1000 (override) | your `groupRules` and `categories` config; beats plugin declarations |
| `rules:defaults` | 100 | built-in rules for tools common on DSH hosts (adb, phone, desktop, gork, github, nix, amap, bilibili, browser, engram, bots, groups, team, automation, schedule, MCP connector, secrets, x search…); plugin declarations beat it |

## Configuration

```yaml
- id: tool-manager-classifier-rules
  name: dsh-tool-manager-classifier-rules
  config:
    defaults: true            # set false to use only your own rules
    groupRules:               # regex over tool names -> group, first match wins
      - { match: '^lingshu_', group: lingshu }
    categories:               # place groups; add categories with a description
      system: { groups: [lingshu] }
      games:  { description: Game servers and bots, groups: [minecraft] }
```

The rule tables (`DEFAULT_GROUP_RULES`, `DEFAULT_GROUP_CATEGORIES`) and the
`rulesClassifier()` helper are exported, so a fork or another plugin can reuse
them with different data.

## License

MIT
