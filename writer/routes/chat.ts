// Copyright (C) 2025 Jim Chen <Jim@ChenJ.im>, licensed under GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { join } from "@std/path";
import { validateParams } from "../lib/middleware.ts";
import { problemJson } from "../lib/errors.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps, OpenRouterStreamChunk } from "../types.ts";
import type { ContentfulStatusCode } from "@hono/hono/utils/http-status";

export function registerChatRoutes(app: Hono, deps: Pick<AppDeps, "safePath" | "hookDispatcher" | "buildPromptFromStory" | "config">): void {
  const { safePath, hookDispatcher, buildPromptFromStory, config } = deps;

  app.post(
    "/api/stories/:series/:name/chat",
    validateParams,
    async (c) => {
      // Validate API key
      if (!Deno.env.get("OPENROUTER_API_KEY")) {
        return c.json(problemJson("Internal Server Error", 500, "OPENROUTER_API_KEY is not configured"), 500);
      }

      // Validate message body
      const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
      const message: unknown = body.message;
      const template: unknown = body.template;
      if (typeof message !== "string" || message.trim().length === 0) {
        return c.json(problemJson("Bad Request", 400, "Message must be a non-empty string"), 400);
      }

      if (message.length > 100_000) {
        return c.json(problemJson("Bad Request", 400, "Message exceeds maximum length"), 400);
      }

      const series = c.req.param("series")!;
      const name = c.req.param("name")!;
      const storyDir = safePath(series, name);
      if (!storyDir) {
        return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
      }

      try {
        const {
          prompt: systemPrompt,
          ventoError,
          chapterFiles,
          chapters,
        } = await buildPromptFromStory(
          series,
          name,
          storyDir,
          message,
          typeof template === "string" ? template : undefined
        );

        if (ventoError) {
          return c.json({
            type: "vento-error",
            ...ventoError,
          }, 422);
        }

        if (!systemPrompt) {
          return c.json(problemJson("Internal Server Error", 500, "Failed to generate prompt"), 500);
        }

        // Construct messages array
        const messages: Array<{ role: string; content: string }> = [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ];

        // Call OpenRouter via native fetch with streaming
        const apiResponse = await fetch(config.OPENROUTER_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("OPENROUTER_API_KEY")}`,
          },
          body: JSON.stringify({
            model: config.OPENROUTER_MODEL,
            messages,
            stream: true,
            temperature: 0.1,
            frequency_penalty: 0.13,
            presence_penalty: 0.52,
            top_k: 10,
            top_p: 0,
            repetition_penalty: 1.2,
            min_p: 0,
            top_a: 1,
          }),
        });

        if (!apiResponse.ok) {
          const errorBody = await apiResponse.text();
          console.error(
            "OpenRouter API error:",
            apiResponse.status,
            errorBody
          );
          return c.json(problemJson("AI Service Error", apiResponse.status, "AI service request failed"), apiResponse.status as ContentfulStatusCode);
        }

        if (!apiResponse.body) {
          return c.json(problemJson("Bad Gateway", 502, "No response body from AI service"), 502);
        }

        // Determine target chapter: reuse last empty file or create next
        let targetNum: number;
        const lastFile = chapterFiles[chapterFiles.length - 1];
        if (
          lastFile &&
          chapters[chapters.length - 1]?.content.trim() === ""
        ) {
          // Last chapter is empty (e.g., touched by /init) — overwrite it
          targetNum = parseInt(lastFile, 10);
        } else {
          const maxNum =
            chapterFiles.length > 0
              ? Math.max(...chapterFiles.map((f) => parseInt(f, 10)))
              : 0;
          targetNum = maxNum + 1;
        }
        const padded = String(targetNum).padStart(3, "0");

        // Ensure directory exists
        await Deno.mkdir(storyDir, { recursive: true });

        // Open file for incremental writing
        const chapterPath = join(storyDir, `${padded}.md`);
        const file = await Deno.open(chapterPath, { write: true, create: true, truncate: true });
        const encoder = new TextEncoder();
        let aiContent = "";

        // Write user message at the top of the chapter file
        const userBlock = `<user_message>\n${message}\n</user_message>\n\n`;
        await file.write(encoder.encode(userBlock));

        try {
          // Parse SSE stream and write incrementally
          const reader = apiResponse.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            // Keep the last (possibly incomplete) line in the buffer
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data: ")) continue;

              const payload = trimmed.slice(6);
              if (payload === "[DONE]") continue;

              try {
                const raw: unknown = JSON.parse(payload);
                if (typeof raw !== "object" || raw === null) continue;
                const parsed = raw as OpenRouterStreamChunk;
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  aiContent += delta;
                  await file.write(encoder.encode(delta));
                }
              } catch {
                // Skip malformed JSON chunks
              }
            }
          }

          // Process any remaining data in the buffer
          if (buffer.trim()) {
            const trimmed = buffer.trim();
            if (trimmed.startsWith("data: ") && trimmed.slice(6) !== "[DONE]") {
              try {
                const raw: unknown = JSON.parse(trimmed.slice(6));
                if (typeof raw === "object" && raw !== null) {
                  const parsed = raw as OpenRouterStreamChunk;
                  const delta = parsed.choices?.[0]?.delta?.content;
                  if (delta) {
                    aiContent += delta;
                    await file.write(encoder.encode(delta));
                  }
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        } finally {
          file.close();
        }

        if (!aiContent) {
          return c.json(problemJson("Bad Gateway", 502, "No content in AI response"), 502);
        }

        const fullContent = userBlock + aiContent;

        // Run post-response hooks (e.g., apply-patches plugin)
        await hookDispatcher.dispatch("post-response", {
          content: fullContent,
          storyDir,
          series,
          name,
          rootDir: config.ROOT_DIR,
        });

        return c.json({ chapter: targetNum, content: fullContent });
      } catch (err: unknown) {
        console.error("Chat error:", err instanceof Error ? err.message : String(err));
        return c.json(problemJson("Internal Server Error", 500, "Failed to process chat request"), 500);
      }
    }
  );
}
