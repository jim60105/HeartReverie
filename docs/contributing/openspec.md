# OpenSpec workflow

[HeartReverie 浮心夜夢][project] 採用 OpenSpec 管理規格演進。任何跨檔案的破壞性變更、或涉及外掛系統契約／API 契約／文件結構的改動，SHALL 先以 OpenSpec 提案（change proposal）描述「為何要改」「改什麼」「規格差異」，再進入實作階段。

## 目錄結構

```
openspec/
├── AGENTS.md                # workflow 與工具用法
├── specs/                   # 已採納的主規格
└── changes/
    ├── <change-name>/       # 進行中的提案
    │   ├── proposal.md
    │   ├── design.md
    │   ├── tasks.md
    │   └── specs/<capability>/spec.md  # 規格差異
    └── archive/             # 已歸檔的變更
```

## 常用指令

```bash
# 驗證提案結構
openspec validate <change-name> --strict

# 看待辦
openspec status --change <change-name> --json

# 列出可用提案
openspec list --json
```

## 工作流程

1. **提案**：在 `openspec/changes/<name>/` 建立 `proposal.md`、`design.md`（如需）、`tasks.md`、`specs/`。`openspec-propose` 技能可一鍵生成骨架。
2. **驗證**：執行 `openspec validate <name> --strict`。
3. **實作**：以 `openspec-apply-change` 技能依 `tasks.md` 逐項落地，並打勾完成項。
4. **歸檔**：實作完成、specs 同步後，以 `openspec-archive-change` 技能將提案移入 `archive/`。

詳細慣例與工具列表請見儲存庫根 [`openspec/AGENTS.md`][openspec-agents]。

[project]: https://github.com/jim60105/HeartReverie
[openspec-agents]: https://github.com/jim60105/HeartReverie/blob/master/openspec/AGENTS.md
