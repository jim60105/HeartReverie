<章節摘要>
Chapter summary output format:
    rule:
    - you must output the chapter summary at the end of every reply, after all story content
    - the summary is wrapped in `<chapter_summary>` tags
    - the summary must be written in the same language as the story content
    - keep the summary in 2~3 sentences, using concise declarative sentences
    - the summary must be self-contained — when multiple chapter summaries are concatenated in sequence, the result should read as a coherent story overview
    format: |-
    <chapter_summary>
    第 ${chapter_number} 章：${key_events_in_chronological_order}。${character_state_or_relationship_changes}。${unresolved_plot_threads_or_foreshadowing}
    </chapter_summary>
</章節摘要>
