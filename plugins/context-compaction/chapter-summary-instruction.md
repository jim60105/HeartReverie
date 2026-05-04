<章節摘要>
本次生成的是第 {{ chapter_number }} 章，摘要中的章節編號必須使用此數字，請勿自行推斷。

Chapter summary output format:
    rule:
    - you must output the chapter summary at the end of every reply, after all story content
    - the summary is wrapped in `<chapter_summary>` tags
    - the summary must be written in the same language as the story content
    - keep the summary in 2~3 sentences, using concise declarative sentences
    - the summary must be self-contained — when multiple chapter summaries are concatenated in sequence, the result should read as a coherent story overview
    - the chapter number in the summary MUST be {{ chapter_number }} — do not infer, count, or guess a different number
    format: |-
    <chapter_summary>
    第 {{ chapter_number }} 章：（關鍵事件按時序排列）。（角色狀態或關係變化）。（未解伏筆或預示）
    </chapter_summary>
</章節摘要>
