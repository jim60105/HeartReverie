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

// Load .env from project root (Node 20.12+); silently skip if missing
try {
  const envPath = new URL("../.env", import.meta.url).pathname;
  process.loadEnvFile(envPath);
} catch {
  // No .env file — rely on environment variables
}

import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import https from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import express from "express";
import vento from "ventojs";

const execFileAsync = promisify(execFile);

// ── Resolve project directories ─────────────────────────────────
const ROOT_DIR = path.resolve(import.meta.dirname, "..");
const PLAYGROUND_DIR =
  process.env.PLAYGROUND_DIR || path.join(ROOT_DIR, "playground");
const READER_DIR = process.env.READER_DIR || path.join(ROOT_DIR, "reader");
const APPLY_PATCHES_BIN = path.join(
  ROOT_DIR,
  "apply-patches",
  "target",
  "release",
  "apply-patches"
);

// ── TLS configuration ───────────────────────────────────────────
const CERT_FILE = process.env.CERT_FILE;
const KEY_FILE = process.env.KEY_FILE;
const PORT = parseInt(process.env.PORT || "8443", 10);

if (!CERT_FILE || !KEY_FILE) {
  console.error("❌ CERT_FILE and KEY_FILE environment variables are required");
  process.exit(1);
}

// ── OpenRouter configuration ────────────────────────────────────
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v3.2";

if (!process.env.OPENROUTER_API_KEY) {
  console.warn("⚠️  OPENROUTER_API_KEY is not set — chat functionality will not work");
}

// ── Vento template engine ───────────────────────────────────────
const ventoEnv = vento();

// ── Hardcoded start hints ───────────────────────────────────────
const START_HINTS = `請參考這段指示創作出一個好的起始章節:
1. 在第一句話就拋出引人入勝的懸念，激發讀者的好奇心。
2. 迅速介紹故事的背景和世界觀，但要通過自然的方式，避免生硬的直接說明。
3. 及早讓主角或重要人物登場，並用簡短的情節展現其特質。
4. 明確表達主角的目標或面臨的挑戰，確立故事的主線。
5. 暗示未來會發生的重大事件，製造期待感。
6. 力求開場"石破天驚"，用獨特的情節、語言或視角立即抓住讀者。
7. 通過文字風格展現故事的類型和基調，讓讀者了解這是什麼樣的故事。

起始章節完成以上任務，吸引讀者繼續閱讀。`;

// ── Path traversal prevention ───────────────────────────────────

function isValidParam(value) {
  return !/\.\.|\x00|[/\\]/.test(value);
}

function validateParams(req, res, next) {
  for (const key of ["series", "name", "number"]) {
    const val = req.params[key];
    if (val !== undefined && !isValidParam(val)) {
      return res.status(400).json({
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        detail: `Invalid parameter: ${key}`,
      });
    }
  }
  next();
}

// Verify resolved path stays within playground directory
function safePath(...segments) {
  const resolved = path.resolve(PLAYGROUND_DIR, ...segments);
  if (!resolved.startsWith(path.resolve(PLAYGROUND_DIR))) {
    return null;
  }
  return resolved;
}

// ── Express app ─────────────────────────────────────────────────
const app = express();

// JSON body parser for API routes
app.use("/api", express.json({ limit: "1mb" }));

// Path param validation for all API story routes
app.param("series", (req, _res, next) => {
  next();
});
app.param("name", (req, _res, next) => {
  next();
});
app.param("number", (req, _res, next) => {
  next();
});

// ── API Routes ──────────────────────────────────────────────────

// GET /api/stories — list series
app.get("/api/stories", async (_req, res) => {
  try {
    const entries = await fs.readdir(PLAYGROUND_DIR, { withFileTypes: true });
    const dirs = entries
      .filter(
        (e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "prompts"
      )
      .map((e) => e.name);
    res.json(dirs);
  } catch (err) {
    res.status(500).json({
      type: "about:blank",
      title: "Internal Server Error",
      status: 500,
      detail: "Failed to list stories",
    });
  }
});

// GET /api/stories/:series — list stories in a series
app.get("/api/stories/:series", validateParams, async (req, res) => {
  const dirPath = safePath(req.params.series);
  if (!dirPath) {
    return res.status(400).json({
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      detail: "Invalid path",
    });
  }

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
    res.json(dirs);
  } catch (err) {
    if (err.code === "ENOENT") {
      return res.status(404).json({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: "Series not found",
      });
    }
    res.status(500).json({
      type: "about:blank",
      title: "Internal Server Error",
      status: 500,
      detail: "Failed to list series",
    });
  }
});

// GET /api/stories/:series/:name/chapters — list chapters
app.get(
  "/api/stories/:series/:name/chapters",
  validateParams,
  async (req, res) => {
    const dirPath = safePath(req.params.series, req.params.name);
    if (!dirPath) {
      return res.status(400).json({
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        detail: "Invalid path",
      });
    }

    try {
      const entries = await fs.readdir(dirPath);
      const chapters = entries
        .filter((f) => /^\d+\.md$/.test(f))
        .map((f) => parseInt(f, 10))
        .sort((a, b) => a - b);
      res.json(chapters);
    } catch (err) {
      if (err.code === "ENOENT") {
        return res.status(404).json({
          type: "about:blank",
          title: "Not Found",
          status: 404,
          detail: "Story not found",
        });
      }
      res.status(500).json({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: "Failed to list chapters",
      });
    }
  }
);

// GET /api/stories/:series/:name/chapters/:number — read chapter
app.get(
  "/api/stories/:series/:name/chapters/:number",
  validateParams,
  async (req, res) => {
    const num = parseInt(req.params.number, 10);
    if (isNaN(num) || num < 0) {
      return res.status(400).json({
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        detail: "Invalid chapter number",
      });
    }

    const padded = String(num).padStart(3, "0");
    const filePath = safePath(req.params.series, req.params.name, `${padded}.md`);
    if (!filePath) {
      return res.status(400).json({
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        detail: "Invalid path",
      });
    }

    try {
      const content = await fs.readFile(filePath, "utf-8");
      res.json({ number: num, content });
    } catch (err) {
      if (err.code === "ENOENT") {
        return res.status(404).json({
          type: "about:blank",
          title: "Not Found",
          status: 404,
          detail: "Chapter not found",
        });
      }
      res.status(500).json({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: "Failed to read chapter",
      });
    }
  }
);

// GET /api/stories/:series/:name/status — read status YAML
app.get(
  "/api/stories/:series/:name/status",
  validateParams,
  async (req, res) => {
    const currentPath = safePath(
      req.params.series,
      req.params.name,
      "current-status.yml"
    );
    const initPath = safePath(req.params.series, "init-status.yml");

    if (!currentPath || !initPath) {
      return res.status(400).json({
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        detail: "Invalid path",
      });
    }

    try {
      const content = await fs.readFile(currentPath, "utf-8");
      res.type("text/yaml").send(content);
    } catch {
      try {
        const content = await fs.readFile(initPath, "utf-8");
        res.type("text/yaml").send(content);
      } catch {
        return res.status(404).json({
          type: "about:blank",
          title: "Not Found",
          status: 404,
          detail: "Status file not found",
        });
      }
    }
  }
);

// POST /api/stories/:series/:name/init — initialize story
app.post(
  "/api/stories/:series/:name/init",
  validateParams,
  async (req, res) => {
    const dirPath = safePath(req.params.series, req.params.name);
    if (!dirPath) {
      return res.status(400).json({
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        detail: "Invalid path",
      });
    }

    const filePath = path.join(dirPath, "001.md");

    try {
      await fs.mkdir(dirPath, { recursive: true });
      try {
        await fs.access(filePath);
        return res.status(200).json({ message: "Story already exists" });
      } catch {
        await fs.writeFile(filePath, "", "utf-8");
        return res.status(201).json({ message: "Story initialized" });
      }
    } catch (err) {
      res.status(500).json({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: "Failed to initialize story",
      });
    }
  }
);

// POST /api/stories/:series/:name/chat — chat and write chapter
app.post(
  "/api/stories/:series/:name/chat",
  validateParams,
  async (req, res) => {
    // Validate API key
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: "OPENROUTER_API_KEY is not configured",
      });
    }

    // Validate message body
    const { message } = req.body || {};
    if (typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        detail: "Message must be a non-empty string",
      });
    }

    if (message.length > 100_000) {
      return res.status(400).json({
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        detail: "Message exceeds maximum length",
      });
    }

    const { series, name } = req.params;
    const storyDir = safePath(series, name);
    if (!storyDir) {
      return res.status(400).json({
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        detail: "Invalid path",
      });
    }

    try {
      // Read existing chapters
      let chapterFiles = [];
      try {
        const entries = await fs.readdir(storyDir);
        chapterFiles = entries
          .filter((f) => /^\d+\.md$/.test(f))
          .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
      } catch {
        // Directory may not exist yet
      }

      const chapters = [];
      for (const f of chapterFiles) {
        const content = await fs.readFile(path.join(storyDir, f), "utf-8");
        chapters.push({ number: parseInt(f, 10), content });
      }

      // First-round detection: no chapters with non-empty content
      const isFirstRound = chapters.every((ch) => ch.content.trim() === "");

      // Build system prompt via Vento
      const systemPrompt = await renderSystemPrompt(series);

      // Load status
      const statusContent = await loadStatus(series, name);

      // Load after-user-message prompt
      const afterUserMessagePath = path.join(
        PLAYGROUND_DIR,
        "prompts",
        "after_user_message.md"
      );
      let afterUserMessageContent = "";
      try {
        afterUserMessageContent = await fs.readFile(
          afterUserMessagePath,
          "utf-8"
        );
      } catch {
        // File may not exist
      }

      // Build user content
      const userContent = isFirstRound
        ? `<start_hints>${START_HINTS}</start_hints>\n<inputs>${message}</inputs>`
        : `<inputs>${message}</inputs>`;

      // Construct messages array
      const messages = [
        { role: "system", content: systemPrompt },
        ...chapters.map((ch) => ({
          role: "assistant",
          content: `<previous_context>${ch.content}</previous_context>`,
        })),
        { role: "user", content: userContent },
        {
          role: "system",
          content: `<status_current_variable>${statusContent}</status_current_variable>`,
        },
        { role: "system", content: afterUserMessageContent },
      ];

      // Call OpenRouter via native fetch with streaming
      const apiResponse = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
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
        return res.status(apiResponse.status).json({
          type: "about:blank",
          title: "AI Service Error",
          status: apiResponse.status,
          detail: errorBody || "OpenRouter API error",
        });
      }

      // Determine target chapter: reuse last empty file or create next
      let targetNum;
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
      await fs.mkdir(storyDir, { recursive: true });

      // Open file handle for incremental writing
      const chapterPath = path.join(storyDir, `${padded}.md`);
      const fileHandle = await fs.open(chapterPath, "w");
      let fullContent = "";

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
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;

            const payload = trimmed.slice(6);
            if (payload === "[DONE]") continue;

            try {
              const parsed = JSON.parse(payload);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                await fileHandle.write(delta);
              }
            } catch {
              // Skip malformed JSON chunks
            }
          }
        }
      } finally {
        await fileHandle.close();
      }

      if (!fullContent) {
        return res.status(502).json({
          type: "about:blank",
          title: "Bad Gateway",
          status: 502,
          detail: "No content in AI response",
        });
      }

      // Run apply-patches to update current-status.yml
      try {
        await execFileAsync(APPLY_PATCHES_BIN, ["playground"], {
          cwd: ROOT_DIR,
        });
      } catch (err) {
        if (err.code === "ENOENT") {
          console.warn("⚠️  apply-patches binary not found at", APPLY_PATCHES_BIN);
        } else {
          console.warn(
            "⚠️  apply-patches exited with code",
            err.code,
            err.stderr || ""
          );
        }
      }

      res.json({ chapter: targetNum, content: fullContent });
    } catch (err) {
      console.error("Chat error:", err.message);
      res.status(500).json({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: "Failed to process chat request",
      });
    }
  }
);

// ── Helper functions ────────────────────────────────────────────

async function renderSystemPrompt(series) {
  const systemTemplatePath = path.join(
    PLAYGROUND_DIR,
    "prompts",
    "system.md"
  );
  const scenarioPath = safePath(series, "scenario.md");

  const systemTemplate = await fs.readFile(systemTemplatePath, "utf-8");
  let scenarioContent = "";
  if (scenarioPath) {
    try {
      scenarioContent = await fs.readFile(scenarioPath, "utf-8");
    } catch {
      // Scenario file may not exist
    }
  }

  const result = await ventoEnv.runString(systemTemplate, {
    scenario: scenarioContent,
  });
  return result.content;
}

async function loadStatus(series, name) {
  const currentPath = safePath(series, name, "current-status.yml");
  const initPath = safePath(series, "init-status.yml");

  if (currentPath) {
    try {
      return await fs.readFile(currentPath, "utf-8");
    } catch {
      // Fall through to init
    }
  }

  if (initPath) {
    try {
      return await fs.readFile(initPath, "utf-8");
    } catch {
      // Neither exists
    }
  }

  return "";
}

// ── Serve reader frontend ───────────────────────────────────────
app.use("/", express.static(READER_DIR));

// ── Start HTTPS server ──────────────────────────────────────────
const server = https.createServer(
  {
    cert: readFileSync(CERT_FILE),
    key: readFileSync(KEY_FILE),
  },
  app
);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ HTTPS server listening on https://localhost:${PORT}`);
  console.log(`   Reader: ${READER_DIR}`);
  console.log(`   Playground: ${PLAYGROUND_DIR}`);
});
