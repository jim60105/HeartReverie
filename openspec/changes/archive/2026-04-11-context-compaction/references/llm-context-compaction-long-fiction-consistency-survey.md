# 當脈絡學會「壓縮自己」：LLM 對話歷史壓實方案、長篇小說一致性管理、與角色扮演寫作系統的架構選擇

> 研究日期：2026-04-08
> 動機：為自製 SillyTavern 替代品（角色扮演故事寫作系統）尋找脈絡壓實方案——故事越寫越長，全量載入章節歷史的 token 成本爆炸
> 語言脈絡：故事以正體中文撰寫，中文 token 密度與英文顯著不同
> 關鍵字：context compaction, prompt compression, KV cache compression, long-form fiction, story consistency, AAAK, LLMLingua, DOME, temporal knowledge graph, chapter summarization

## 問題定義

一個角色扮演故事寫作系統面臨的核心矛盾：**維持跨章節一致性需要歷史脈絡，但歷史脈絡隨章節數線性膨脹**。

具體場景是這樣的。系統目前把所有已完成章節的歷史載入 context window，讓 LLM 在續寫時能參照先前的角色設定、情節發展、伏筆。這在前幾章運作良好。到了第十章、第二十章，token 用量開始爆炸。200K context window 裝不下全部歷史時，要麼截斷（丟失早期脈絡），要麼付出巨額推論成本。

幾個約束條件限制了解方案的選擇：

1. **故事彼此獨立**——不同故事之間不需要跨故事記憶召回，方案不需要處理跨 session 的通用記憶問題
2. **核心需求是壓實（compaction）**——不是通用 agent 記憶管理，而是把已有歷史壓到更少 token 同時保留故事一致性所需的資訊
3. **正體中文**——壓縮率在中文和英文之間有結構性差異

這篇筆記梳理兩條研究線索：(1) LLM 脈絡壓實的技術方案景觀，(2) 長篇小說生成中的一致性管理策略。最終目標是為上述系統找到可行的架構方向。

## 脈絡壓實方案景觀

研究文獻中的壓實方案分為兩個層次：**提示詞層壓縮**（prompt-level compression）和**推論層壓縮**（inference-level KV cache compression）。對於控制 prompt 建構流程的應用系統，提示詞層方案更具可操作性。

### 提示詞層壓縮：LLMLingua 家族

LLMLingua（Jiang et al., EMNLP 2023, arXiv:2310.05736）是這個領域的開創性工作。它用一個小型語言模型（GPT-2 或 LLaMA-7B）對 prompt 做粗到細的壓縮：先在段落和句子層級評估重要性，再在 token 層級做選擇性刪除。壓縮比可達 20 倍，且在下游任務上的效能損失很小。

LLMLingua-2（Pan et al., ACL Findings 2024, arXiv:2403.12968）改用資料蒸餾方法，把壓縮問題轉化為 token 分類問題。每個 token 被標記為「保留」或「刪除」，用 BERT 級別的小模型做分類。速度比 LLMLingua 快 3-6 倍，壓縮比 2-5 倍，且因為是分類而非自回歸生成，延遲更可預測。

2026 年的兩篇新工作進一步推進了這條路線：

**Prompt Compression in the Wild**（Kummer et al., ECIR 2026, arXiv:2604.02985）是第一篇在真實生產環境中系統評估 LLMLingua 的大規模研究。結論是在合適的壓縮比下，端到端推論加速可達 18%，但壓縮比過高時品質下降不均勻——某些任務類型（例如事實回答）比其他類型（例如創意生成）更能容忍壓縮。這對故事寫作場景是一個警訊：創意文本的壓縮容忍度可能低於事實性文本。

**EFPC**（Cao et al., arXiv:2503.07956, Efficient and Flexible Prompt Compression）在 4 倍壓縮比下比 LLMLingua-2 提升 4.8%。它的彈性在於可以對 prompt 的不同部分施加不同壓縮比——例如角色設定部分低壓縮、早期章節摘要高壓縮。這種差異化壓縮對故事寫作系統很有吸引力。

### 結構化蒸餾：Agent 記憶的 11 倍壓縮

Structured Distillation（Lewis, arXiv:2603.13017）處理的問題和故事寫作高度相關：如何把 agent 的對話歷史壓縮成結構化格式，同時保留可檢索性。它用 LLM 把自由格式的對話蒸餾成結構化的 JSON 記錄（包含主題、實體、時間戳、關鍵事實），在 11 倍壓縮下保留了 96% 的逐字檢索 MRR（Mean Reciprocal Rank）。

開源實現在 GitHub（searchat），架構是 LLM-as-distiller + 向量索引。這個方案的優勢在於壓縮後的結構化格式既節省 token 又支援精確檢索。對故事系統而言，可以把完成的章節蒸餾成結構化的章節記錄（角色狀態、情節事件、未解伏筆），用於後續章節的脈絡參照。

### Z-tokens：自表達自編碼的 18 倍壓縮

Z-tokens（Li et al., arXiv:2603.25340, LLM as Token Compressor）是一種更激進的方法。它讓 LLM 學會把一段文本編碼成可變長度的潛在碼（latent codes），稱為 Z-tokens。這些 Z-tokens 不是自然語言，而是 LLM 詞彙表中的 token 序列，經過訓練後 LLM 可以從 Z-tokens 還原原始語意。壓縮比可達 18 倍，且是內容自適應的——資訊密度高的段落用更多 Z-tokens，冗餘段落用更少。

這個方法的侷限在於需要微調 LLM 來支援 Z-token 編解碼，不是即插即用的。但概念上它指出了一個方向：壓縮不必在 prompt 建構階段用外部工具完成，LLM 本身可以學會壓縮和解壓。

### AAAK 壓縮方言：30 倍壓縮的特殊路線

MemPalace 的 AAAK 方言（dialect.py，1050 行 Python）走了一條獨特的路線：設計一種 AI 原生可讀的速記語言，把自然語言的冗餘全部去除。30 倍壓縮率，零資訊損失，任何文字處理 LLM 都能解碼（根據其先前筆記的分析）。

AAAK 對故事寫作系統的適用性有一個關鍵問題：**它是為英文設計的**。中文的 token 結構和英文根本不同。英文的冗餘很大程度來自虛詞（冠詞、介系詞、連接詞）和形態變化（時態、複數），這些是 AAAK 壓縮的主要目標。中文沒有冠詞、沒有形態變化，一個漢字攜帶的語意密度本來就高於一個英文單字。

粗略估算：中文 1 字 ≈ 1-3 token（取決於 tokenizer），英文 1 詞 ≈ 0.75-1.5 token。中文文本的「天然壓縮率」已經比英文高，AAAK 在中文上能達到的額外壓縮空間可能只有英文的 1/3 到 1/2。30 倍壓縮率在中文上可能降到 10-15 倍。這仍然有價值，但效益打了折扣。

另一個考量是 AAAK 的可維護性。1050 行的自訂壓縮方言是一個需要持續維護的元件。在故事寫作這個場景中，壓縮方言需要能處理中文特有的表達結構（成語、四字格、對仗），AAAK 目前不具備這些能力。

### SeCom：段落級記憶建構

SeCom（Pan et al., arXiv:2502.05589, Segment-level Memory Construction）把長對話切成語意連貫的段落，對每個段落用 LLMLingua-2 做去噪（denoising），然後建構段落級的記憶單元。這種方法特別適合對話型內容，因為對話自然地分成回合，每個回合可以獨立壓縮。

對故事系統而言，章節就是天然的段落邊界。SeCom 的設計可以直接映射：每完成一章，對該章做段落級壓縮，建構章節記憶單元，供後續章節檢索。

### 隱私與成本：額外考量

Privacy Guard / Token Parsimony（Langiu, arXiv:2603.28972）從成本和隱私角度研究脈絡壓實，報告 45% 的營運成本減少。對自託管的故事寫作系統，成本減少直接對應推論時間和 API 費用的降低。

### 推論層壓縮：KV Cache 方案

推論層方案壓縮的不是 prompt 文字，而是 Transformer 推論過程中的 KV cache。這些方案對應用層透明，但需要模型層級的支援。

**KVTC**（Staniszewski & Łańcucki, ICLR 2026, arXiv:2511.01815）用轉換編碼（transform coding）壓縮 KV cache，最高 20 倍壓縮。

**SONIC**（Chen et al., arXiv:2601.21927）設計了 nexus tokens 來壓縮多輪對話的 KV cache，80% 壓縮率，50.1% 推論加速。它的多輪對話焦點和故事寫作的多章節續寫場景高度契合。

**MSA**（Chen et al., arXiv:2603.23516, Memory Sparse Attention）可擴展到 100M token，代表了長脈絡推論的工程前沿。

**Accordion-Thinking**（Yang et al., arXiv:2602.03249）讓模型學會在推理過程中自動生成步驟摘要，實現 3 倍吞吐量提升。這是一種「自壓縮」方法——模型在生成過程中同時壓縮自己的中間推理。

這些 KV cache 方案對使用商業 API（如 Claude API、OpenAI API）的系統不可控，因為壓縮發生在推論引擎內部。但如果系統使用自託管模型（如 vLLM + 開源模型），這些方案可以和提示詞層壓縮堆疊使用。

### 生物啟發：遺忘作為壓縮

**SleepGate**（Xie, arXiv:2603.14517）從生物學的睡眠記憶鞏固借鏡，提出在「休息」階段對記憶做選擇性強化和遺忘。它把主動干擾（proactive interference）的影響範圍從 O(n) 降到 O(log n)。

**Clustering-driven Memory Compression**（Bohdal et al., ICASSP 2026, arXiv:2601.17443）用聚類方法壓縮 agent 記憶。

這些生物啟發方案的概念對故事系統有間接價值：隨著故事推進，早期章節的某些細節（場景描寫、過渡情節）可以被「遺忘」，只保留對故事一致性有關鍵影響的資訊（角色設定變化、重要事件、未解伏筆）。

## 長篇小說一致性管理

壓實只解決了 token 成本問題。另一半問題是：壓縮後的脈絡是否足以維持故事一致性？

### DOME：動態分層大綱與記憶增強

DOME（Wang et al., arXiv:2412.13575, Dynamic Hierarchical Outlining with Memory-Enhancement）是目前針對長篇故事生成最完整的架構。它的核心有兩個元件：

**動態分層大綱**（Dynamic Hierarchical Outline）：故事結構被組織成多層大綱（全書主題 → 卷 → 章 → 場景）。每完成一個場景或章節，大綱會動態更新，反映已發生的情節變化。大綱本身就是一種壓縮——它用結構化的短描述取代了完整文本，同時保留了情節的骨架。

**時序知識圖譜**（Temporal Knowledge Graph, TKG）：和 MemPalace 的知識圖譜類似，DOME 用帶時間戳的實體關係三元組來追蹤角色狀態和世界設定。關鍵差異是 DOME 的知識圖譜專門針對敘事元素設計，包含：

- 角色屬性（位置、情緒、持有物品、人際關係）
- 世界狀態（時間、天氣、地點描述）
- 因果鏈（事件 A 導致結果 B，B 限制了未來可能的事件 C）
- 矛盾偵測（新生成的內容是否和既有知識圖譜衝突）

DOME 的矛盾偵測機制對角色扮演寫作格外重要。當 LLM 生成了一段和先前章節矛盾的內容（例如角色在第五章失去了左手，但在第十二章又用左手拿東西），知識圖譜可以在生成後立即標記矛盾。

DOME 論文長達 39 頁，包含了和人類評審的對比實驗。在長篇故事的連貫性、角色一致性、情節邏輯三個維度上，DOME 都顯著優於基線方法（單純的滑動窗口或摘要法）。

### BooookScore：書籍長度的品質評估

BooookScore（Chang et al., ICLR 2024, arXiv:2310.00785）研究的是書籍長度內容的摘要，但它提出的兩種工作流程對長篇生成也有啟發：

**階層式合併**（Hierarchical Merging）：把長文本分成 chunk，每個 chunk 獨立摘要，然後逐層合併摘要。這是一種 bottom-up 的壓縮策略。

**漸增式更新**（Incremental Updating）：維護一個持續更新的摘要，每讀入一個新 chunk，就把新資訊整合進既有摘要。這是一種 streaming 式的壓縮策略。

實驗結果顯示，階層式合併在保留細節上更好，漸增式更新在維持全局連貫性上更好。對故事系統，漸增式更新更自然——每完成一章，把該章的關鍵資訊整合進故事的全局狀態摘要。

### SoftPromptComp：摘要與軟提示的結合

SoftPromptComp（Wang et al., IPCA 2024, arXiv:2404.04997）把摘要和軟提示（soft prompt）結合。它先用 LLM 生成文本摘要，再把摘要編碼成軟提示向量注入模型。軟提示不佔用 token 額度，等於把壓縮後的資訊「藏」進模型的啟動狀態中。

這種方法的限制在於需要對模型做微調來支援軟提示注入，不適用於商業 API。但概念上它指出了一個方向：壓縮後的歷史脈絡不必以文字形式存在於 prompt 中。

## 正體中文的特殊考量

多數壓縮方案的評估都在英文上進行。中文有幾個影響壓縮效率的結構性差異：

**Token 密度更高**。在 Claude 使用的 tokenizer 中，一個常用漢字通常是 1-2 個 token，一個中文句子的 token 數通常少於等長英文句子。這意味著中文文本的「每 token 資訊量」本來就比英文高，進一步壓縮的空間更小。

**無形態冗餘**。英文的 "she was walking to the beautiful garden where they had been meeting regularly" 中有大量的形態標記（was/-ing/the/where/had/been/-ly），這些是 LLMLingua 系列壓縮的主要目標。中文的「她走向他們經常碰面的那座美麗花園」幾乎沒有可刪除的形態標記，每個字都攜帶實質語意。

**四字格和成語**。中文的四字成語是高度壓縮的語意單元（例如「胸有成竹」= 心裡已有完整規劃）。壓縮系統需要識別這些單元不能被拆散。

**量詞和語氣詞**。中文的量詞（一「隻」貓）和語氣詞（嗎、呢、啊）在語意上的貢獻有時是微妙的。語氣詞在對話體小說中尤其重要——它們傳達角色的語氣和態度，刪除它們會改變敘事的風味。

粗略估計，LLMLingua 系列在中文上的有效壓縮比可能是英文的 40-60%。如果英文可以做到 5 倍壓縮而不明顯降質，中文可能只能做到 2-3 倍。AAAK 的 30 倍壓縮在中文上可能降到 10-15 倍，但這仍然有意義。

沒有找到專門評估中文 prompt 壓縮的研究論文。這是一個值得實驗的開放問題。

## 為角色扮演故事系統設計壓實架構

綜合以上分析，一個可行的架構方向是**混合分層壓實 + 結構化故事狀態**。

### 架構構想

```
┌─────────────────────────────────────────────────┐
│ Context Window                                   │
│                                                   │
│  [L0] 角色設定 & 世界觀（固定，~200-500 token）      │
│  [L1] 故事全局狀態摘要（漸增式更新，~300-800 token）  │
│  [L2] 近期章節（最近 1-2 章原文，~2K-8K token）      │
│  [L3] 相關歷史片段（按需檢索，~1K-4K token）         │
│  [L4] 當前寫作 prompt（~500-2K token）               │
│                                                   │
│  合計：~4K-15K token（vs 全量載入的 50K-200K+）      │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ 外部儲存                                          │
│                                                   │
│  [章節原文庫] 所有已完成章節的逐字保存               │
│  [故事知識圖譜] 時序化的角色/事件/世界狀態三元組     │
│  [章節摘要索引] 每章的結構化摘要（向量索引）         │
│                                                   │
└─────────────────────────────────────────────────┘
```

### L0：角色設定與世界觀

固定不變的基礎資訊。包含主要角色的核心設定（姓名、外貌、性格、說話方式）、世界觀規則、故事的整體基調。這一層不壓縮，因為它是所有生成的基礎錨點。

### L1：故事全局狀態摘要

採用 BooookScore 的漸增式更新策略。每完成一章，用 LLM 把該章的關鍵資訊整合進全局狀態摘要。摘要包含：

- 各角色的當前狀態（位置、情緒、人際關係變化）
- 已發生的重要事件（時間順序）
- 未解決的伏筆和懸念
- 世界設定的變化

這是壓縮比最高的層級。20 章的歷史可能有 10 萬 token，但全局狀態摘要保持在 300-800 token。壓縮比可達 100 倍以上，代價是細節損失。

### L2：近期章節原文

最近 1-2 章保持原文不壓縮。這確保了生成的文字在風格和節奏上和前面的章節銜接。近期章節提供的是「局部連貫性」——段落之間的過渡、角色對話的語氣延續、場景描寫的風格一致。

### L3：相關歷史片段

當前章節的寫作可能需要參照早期的特定片段（例如第三章描述的某個場景在第十五章被重訪）。用向量檢索從章節摘要索引中找到相關章節，再從原文庫中提取關鍵段落。

這一層的關鍵是檢索的品質。MemPalace 的結構化過濾（+34% 檢索提升）提供了一個值得借鏡的設計：先按章節類型或角色標籤縮小範圍，再做向量搜尋。

### 故事知識圖譜

DOME 的時序知識圖譜概念，實現可以簡化。用 SQLite 儲存：

- 角色狀態三元組：（角色, 屬性, 值, 章節號, 是否仍有效）
- 事件記錄：（事件描述, 涉及角色, 章節號, 因果關係）
- 伏筆追蹤：（伏筆描述, 設置章節, 解決章節/未解決）

知識圖譜的主要用途不是直接注入 prompt，而是做矛盾偵測。生成完一段文字後，用知識圖譜檢查是否和既有事實矛盾。

### 壓縮方案選擇

對中文故事文本，推薦的壓縮策略排序：

1. **LLM 摘要**（L1 層使用）：效果最可靠，壓縮比最高，但需要額外 LLM 呼叫
2. **Structured Distillation**（章節存檔使用）：結構化格式兼顧壓縮和可檢索性
3. **LLMLingua-2**（L3 層的歷史片段使用）：對提取出的歷史片段做進一步壓縮，保留關鍵 token
4. **AAAK 方言**（可選，需要為中文做適配）：如果願意投入開發中文版 AAAK，可用於 L1 層進一步壓縮

不推薦在 L2（近期章節原文）上做任何壓縮。近期章節的風格細節對生成品質的影響太大。

## 方案景觀的分類整理

### 提示詞層壓縮（Prompt-Level）

| 方案 | 來源 | 壓縮比 | 特點 | 中文適用性 |
|------|------|--------|------|------------|
| LLMLingua | Jiang et al., EMNLP 2023 | ≤20x | 粗到細 token 選擇，開創性工作 | 中等（中文形態冗餘少） |
| LLMLingua-2 | Pan et al., ACL 2024 | 2-5x | Token 分類，速度快 3-6x | 中等 |
| EFPC | Cao et al., 2025 | ~4x | 差異化分段壓縮 | 中等，分段壓縮理念適用 |
| Z-tokens | Li et al., 2026 | ≤18x | LLM 自編碼，內容自適應 | 未知，需微調 |
| AAAK | MemPalace v3 | ~30x (英文) | AI 原生速記方言 | 低（為英文設計） |
| Structured Distillation | Lewis, 2026 | ~11x | 結構化 JSON 蒸餾 | 高（語言無關的結構） |
| SeCom | Pan et al., 2025 | 中等 | 段落級去噪 + 記憶建構 | 中等 |
| SoftPromptComp | Wang et al., 2024 | 高 | 摘要→軟提示注入 | 需微調，不適用 API |

### 推論層壓縮（KV Cache Level）

| 方案 | 來源 | 壓縮比 | 特點 | 適用條件 |
|------|------|--------|------|----------|
| KVTC | Staniszewski & Łańcucki, ICLR 2026 | ≤20x | 轉換編碼 | 需自託管模型 |
| SONIC | Chen et al., 2026 | 80% | Nexus tokens，多輪對話 | 需自託管模型 |
| MSA | Chen et al., 2026 | 高 | 100M token 擴展 | 需自託管模型 |
| Accordion-Thinking | Yang et al., 2026 | ~3x 吞吐量 | 自壓縮推理步驟 | 需訓練支援 |

### 故事一致性管理

| 方案 | 來源 | 核心機制 | 適用場景 |
|------|------|----------|----------|
| DOME | Wang et al., 2024 | 動態分層大綱 + 時序知識圖譜 | 長篇小說生成 |
| BooookScore 工作流程 | Chang et al., ICLR 2024 | 階層式合併 / 漸增式更新 | 書籍長度摘要 |
| SleepGate | Xie, 2026 | 生物啟發記憶鞏固 | 長期互動，選擇性遺忘 |

## 和既有記憶系統筆記的交叉分析

### 與 MemPalace 筆記的連接

MemPalace 的四層記憶堆疊（L0 身份 50 token + L1 關鍵 120 AAAK token + L2 按需召回 + L3 深度搜尋）和本筆記提出的故事系統架構（L0-L4）有明確的結構對應。差異在於 MemPalace 是為通用 agent 記憶設計的，故事系統的架構需要加入敘事特有的元素（大綱、伏筆追蹤、矛盾偵測）。

MemPalace 的宮殿隱喻（Wing/Hall/Room）在故事系統中可以映射為「故事/卷/章」的自然結構。+34% 的結構化過濾效果在故事檢索中可能更顯著，因為故事的結構比一般對話更清晰。

### 與 Oblivion 筆記的連接

Oblivion 的 Ebbinghaus 衰減曲線（R_t = exp(-n/S)）概念在故事系統中有一個自然的變體：章節的「重要性衰減」不是按時間，而是按敘事距離。第一章的角色初登場永遠重要（衰減為零），但第三章的一段過渡描寫在第十五章時可能完全不需要（高度衰減）。可以設計一種敘事感知的衰減函式，根據內容類型（角色設定/重要事件/過渡描寫/環境描述）賦予不同的衰減速率。

### 與 MLMF 筆記的連接

MLMF 的三層認知架構（working memory 滑動視窗 / episodic memory 遞迴摘要 / semantic memory 實體圖）和故事系統的 L2-L1-知識圖譜 三層結構幾乎一一對應。MLMF 的 retention regularization（L_ret = Σ||G_t - G_{t-1}||²）懲罰語意漂移的概念，在故事系統中可以轉化為「角色一致性正則化」——如果全局狀態摘要中某個角色的性格描述在連續章節間突然大幅改變，應該觸發警告。

### 與 MemMA 筆記的連接

MemMA 的 Strategic Blindness 診斷（Myopic Construction + Aimless Retrieval）在故事系統中也適用。Myopic Construction 的故事版本是「只看最近章節就續寫，忽略早期的伏筆」。Aimless Retrieval 的故事版本是「檢索了大量歷史片段但沒有針對當前情節需求」。DOME 的動態大綱機制正好是對這兩種病理的結構性回應。

## 開放問題

1. **中文 prompt 壓縮的實際效果**。所有主要壓縮方案（LLMLingua 系列、EFPC）都缺乏中文的系統評估。需要實驗數據來確認中文的有效壓縮比和品質損失。

2. **摘要品質 vs 壓縮比的權衡曲線**。在什麼壓縮比下，故事一致性開始明顯受損？這可能因故事類型而異（日常向角色扮演 vs 複雜懸疑推理）。

3. **知識圖譜的自動建構品質**。DOME 的時序知識圖譜假設 LLM 能準確提取敘事元素。在角色扮演的非結構化對話體文本中，提取準確率可能低於正式的小說文本。

4. **AAAK 中文版的可行性**。是否值得投入開發中文版 AAAK？需要評估開發成本 vs 壓縮收益。鑑於中文的天然高密度，收益可能不足以證明開發成本。

5. **多模型壓縮管線的延遲**。混合架構需要多個 LLM 呼叫（摘要生成、向量檢索、矛盾偵測），加總延遲是否影響寫作體驗？

## 個人反思

這次調查讓我清楚了一件事：脈絡壓實不是一個單一技術問題，而是一個**架構設計問題**。沒有一種壓縮方法可以單獨解決所有需求。故事寫作系統需要的是一個分層架構，讓不同層級的歷史脈絡接受不同程度的壓縮，同時用結構化的故事狀態（知識圖譜、大綱）來彌補壓縮造成的細節損失。

在研究過程中，DOME 的時序知識圖譜和 MemPalace 的結構化過濾這兩個設計讓我印象最深。它們代表了兩種互補的思路：DOME 說「理解故事的結構，就能知道什麼重要」，MemPalace 說「組織好記憶的結構，就能快速找到需要的東西」。對角色扮演故事系統，兩者都需要。

關於 AAAK 在中文場景的適用性，我的判斷是：**概念有價值，直接移植不可行**。中文的語意密度結構和英文差異太大，與其嘗試把 AAAK 翻譯成中文版，不如用 LLM 摘要（L1 層）和 Structured Distillation（章節存檔）來達成類似的壓縮效果。這兩種方法天然支援任何語言，不需要語言特定的工程。

最終推薦的技術路線是：**漸增式 LLM 摘要（L1）+ 近期章節原文保留（L2）+ 向量檢索歷史片段（L3）+ SQLite 時序知識圖譜（矛盾偵測）**。這個組合在工程複雜度和效果之間找到了平衡點。全量載入歷史的 token 成本從 O(n) 降到 O(1)（L0+L1 固定大小）+ O(k)（L2+L3 固定視窗），故事可以無限續寫而不會撞上 context window 上限。

## 參考文獻

- [LLMLingua: Compressing Prompts for Accelerated Inference of Large Language Models][llmlingua] — Jiang et al., EMNLP 2023, arXiv:2310.05736
- [LLMLingua-2: Data Distillation for Efficient and Faithful Task-Agnostic Prompt Compression][llmlingua2] — Pan et al., ACL Findings 2024, arXiv:2403.12968
- [Prompt Compression in the Wild][prompt-wild] — Kummer et al., ECIR 2026, arXiv:2604.02985
- [EFPC: Efficient and Flexible Prompt Compression][efpc] — Cao et al., arXiv:2503.07956
- [LLM as Token Compressor (Z-tokens)][ztokens] — Li et al., arXiv:2603.25340
- [Structured Distillation][structured-distill] — Lewis, arXiv:2603.13017
- [SeCom: Segment-level Memory Construction][secom] — Pan et al., arXiv:2502.05589
- [SoftPromptComp][softpromptcomp] — Wang et al., IPCA 2024, arXiv:2404.04997
- [Privacy Guard / Token Parsimony][privacy-guard] — Langiu, arXiv:2603.28972
- [KVTC: KV Cache Transform Coding][kvtc] — Staniszewski & Łańcucki, ICLR 2026, arXiv:2511.01815
- [SONIC: Nexus Tokens for Multi-Turn Dialogue KV Compression][sonic] — Chen et al., arXiv:2601.21927
- [MSA: Memory Sparse Attention][msa] — Chen et al., arXiv:2603.23516
- [Accordion-Thinking][accordion] — Yang et al., arXiv:2602.03249
- [SleepGate: Bio-Inspired Memory Consolidation][sleepgate] — Xie, arXiv:2603.14517
- [Clustering-driven Memory Compression][clustering-mem] — Bohdal et al., ICASSP 2026, arXiv:2601.17443
- [DOME: Dynamic Hierarchical Outlining with Memory-Enhancement][dome] — Wang et al., arXiv:2412.13575
- [BooookScore: Book-Length Summarization Evaluation][booookscore] — Chang et al., ICLR 2024, arXiv:2310.00785
- [MemPalace v3.0.0][mempalace] — milla-jovovich/mempalace, MIT License, 2026-04-06

[llmlingua]: https://arxiv.org/abs/2310.05736
[llmlingua2]: https://arxiv.org/abs/2403.12968
[prompt-wild]: https://arxiv.org/abs/2604.02985
[efpc]: https://arxiv.org/abs/2503.07956
[ztokens]: https://arxiv.org/abs/2603.25340
[structured-distill]: https://arxiv.org/abs/2603.13017
[secom]: https://arxiv.org/abs/2502.05589
[softpromptcomp]: https://arxiv.org/abs/2404.04997
[privacy-guard]: https://arxiv.org/abs/2603.28972
[kvtc]: https://arxiv.org/abs/2511.01815
[sonic]: https://arxiv.org/abs/2601.21927
[msa]: https://arxiv.org/abs/2603.23516
[accordion]: https://arxiv.org/abs/2602.03249
[sleepgate]: https://arxiv.org/abs/2603.14517
[clustering-mem]: https://arxiv.org/abs/2601.17443
[dome]: https://arxiv.org/abs/2412.13575
[booookscore]: https://arxiv.org/abs/2310.00785
[mempalace]: https://github.com/milla-jovovich/mempalace
