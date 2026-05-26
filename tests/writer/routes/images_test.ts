// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Hono } from "@hono/hono";
import { registerImageRoutes } from "../../../writer/routes/images.ts";
import { createSafePath } from "../../../writer/lib/middleware.ts";

async function setupTmpStory(): Promise<
  { root: string; series: string; story: string; storyDir: string; cleanup: () => Promise<void> }
> {
  const root = await Deno.makeTempDir();
  const series = "series-A";
  const story = "story-1";
  const storyDir = join(root, series, story);
  await Deno.mkdir(join(storyDir, "_images"), { recursive: true });
  return {
    root,
    series,
    story,
    storyDir,
    cleanup: () => Deno.remove(root, { recursive: true }),
  };
}

function createApp(root: string): Hono {
  const app = new Hono();
  registerImageRoutes(app, { safePath: createSafePath(root) });
  return app;
}

Deno.test("images: GET image returns webp content with correct headers", async () => {
  const { root, series, story, storyDir, cleanup } = await setupTmpStory();
  try {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // "RIFF" header
    await Deno.writeFile(join(storyDir, "_images", "abc.webp"), bytes);
    const app = createApp(root);
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${series}/${story}/images/abc.webp`),
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "image/webp");
    assertEquals(res.headers.get("Cache-Control"), "public, immutable");
    const body = new Uint8Array(await res.arrayBuffer());
    assertEquals(body, bytes);
  } finally {
    await cleanup();
  }
});

Deno.test("images: GET image resolves correct content-type for known extensions", async () => {
  const { root, series, story, storyDir, cleanup } = await setupTmpStory();
  try {
    const cases: Array<[string, string]> = [
      ["a.png", "image/png"],
      ["b.jpg", "image/jpeg"],
      ["c.jpeg", "image/jpeg"],
      ["d.gif", "image/gif"],
      ["e.svg", "image/svg+xml"],
      ["f.avif", "image/avif"],
    ];
    for (const [name] of cases) {
      await Deno.writeFile(join(storyDir, "_images", name), new Uint8Array([1, 2, 3]));
    }
    const app = createApp(root);
    for (const [name, ct] of cases) {
      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${series}/${story}/images/${name}`),
      );
      assertEquals(res.status, 200, `${name} status`);
      assertEquals(res.headers.get("Content-Type"), ct, `${name} content-type`);
    }
  } finally {
    await cleanup();
  }
});

Deno.test("images: GET image with unknown extension uses application/octet-stream", async () => {
  const { root, series, story, storyDir, cleanup } = await setupTmpStory();
  try {
    await Deno.writeFile(join(storyDir, "_images", "weird.xyz"), new Uint8Array([0]));
    const app = createApp(root);
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${series}/${story}/images/weird.xyz`),
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/octet-stream");
  } finally {
    await cleanup();
  }
});

Deno.test("images: GET image with no extension uses application/octet-stream", async () => {
  const { root, series, story, storyDir, cleanup } = await setupTmpStory();
  try {
    await Deno.writeFile(join(storyDir, "_images", "noext"), new Uint8Array([0]));
    const app = createApp(root);
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${series}/${story}/images/noext`),
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/octet-stream");
  } finally {
    await cleanup();
  }
});

Deno.test("images: GET image with invalid filename returns 400", async () => {
  const { root, series, story, cleanup } = await setupTmpStory();
  try {
    const app = createApp(root);
    // Filename with space — fails FILENAME_RE
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${series}/${story}/images/bad%20name.png`),
    );
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.title, "Bad Request");
    assertEquals(body.detail, "Invalid filename");
  } finally {
    await cleanup();
  }
});

Deno.test("images: GET image with traversal attempt is rejected", async () => {
  const { root, series, story, cleanup } = await setupTmpStory();
  try {
    const app = createApp(root);
    // ..%2Fpasswd path component — encoded `..` → URL decoded to `..` filename
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${series}/${story}/images/..%2Fevil.png`),
    );
    // The %2F is decoded by the router; the filename param should fail validation
    assertEquals(res.status, 400);
  } finally {
    await cleanup();
  }
});

Deno.test("images: GET image returns 404 when file missing", async () => {
  const { root, series, story, cleanup } = await setupTmpStory();
  try {
    const app = createApp(root);
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${series}/${story}/images/missing.png`),
    );
    assertEquals(res.status, 404);
    const body = await res.json();
    assertEquals(body.title, "Not Found");
    assertEquals(body.detail, "Image not found");
  } finally {
    await cleanup();
  }
});

Deno.test("images: GET image returns 400 when safePath rejects", async () => {
  const { root, cleanup } = await setupTmpStory();
  try {
    const app = createApp(root);
    // ".." in series triggers safePath rejection
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/..%2Fbad/story/images/abc.png`),
    );
    assertEquals(res.status, 400);
  } finally {
    await cleanup();
  }
});

Deno.test("images: GET image-metadata returns empty list when file missing", async () => {
  const { root, series, story, cleanup } = await setupTmpStory();
  try {
    const app = createApp(root);
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${series}/${story}/image-metadata`),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body, { images: [] });
  } finally {
    await cleanup();
  }
});

Deno.test("images: GET image-metadata returns full list when no chapter filter", async () => {
  const { root, series, story, storyDir, cleanup } = await setupTmpStory();
  try {
    const data = {
      images: [
        { filename: "a.webp", chapter: 1 },
        { filename: "b.webp", chapter: 2 },
        { filename: "c.webp", chapter: 2 },
      ],
    };
    await Deno.writeTextFile(join(storyDir, "_images", "_metadata.json"), JSON.stringify(data));
    const app = createApp(root);
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${series}/${story}/image-metadata`),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.images.length, 3);
  } finally {
    await cleanup();
  }
});

Deno.test("images: GET image-metadata filters by chapter when query param given", async () => {
  const { root, series, story, storyDir, cleanup } = await setupTmpStory();
  try {
    const data = {
      images: [
        { filename: "a.webp", chapter: 1 },
        { filename: "b.webp", chapter: 2 },
        { filename: "c.webp", chapter: 2 },
      ],
    };
    await Deno.writeTextFile(join(storyDir, "_images", "_metadata.json"), JSON.stringify(data));
    const app = createApp(root);
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${series}/${story}/image-metadata?chapter=2`),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.images.length, 2);
    assertEquals(body.images[0].filename, "b.webp");
    assertEquals(body.images[1].filename, "c.webp");
  } finally {
    await cleanup();
  }
});

Deno.test("images: GET image-metadata ignores non-numeric chapter param", async () => {
  const { root, series, story, storyDir, cleanup } = await setupTmpStory();
  try {
    const data = {
      images: [
        { filename: "a.webp", chapter: 1 },
        { filename: "b.webp", chapter: 2 },
      ],
    };
    await Deno.writeTextFile(join(storyDir, "_images", "_metadata.json"), JSON.stringify(data));
    const app = createApp(root);
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${series}/${story}/image-metadata?chapter=abc`),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    // NaN chapter → no filter applied → all returned
    assertEquals(body.images.length, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("images: GET image-metadata returns empty when images key absent", async () => {
  const { root, series, story, storyDir, cleanup } = await setupTmpStory();
  try {
    await Deno.writeTextFile(join(storyDir, "_images", "_metadata.json"), JSON.stringify({}));
    const app = createApp(root);
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${series}/${story}/image-metadata`),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.images, []);
  } finally {
    await cleanup();
  }
});

Deno.test("images: GET image-metadata returns 500 on malformed JSON", async () => {
  const { root, series, story, storyDir, cleanup } = await setupTmpStory();
  try {
    await Deno.writeTextFile(join(storyDir, "_images", "_metadata.json"), "{not json");
    const app = createApp(root);
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${series}/${story}/image-metadata`),
    );
    assertEquals(res.status, 500);
    const body = await res.json();
    assertEquals(body.title, "Internal Server Error");
  } finally {
    await cleanup();
  }
});

Deno.test("images: GET image-metadata returns 400 when safePath rejects", async () => {
  const { root, cleanup } = await setupTmpStory();
  try {
    const app = createApp(root);
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/..%2Fbad/story/image-metadata`),
    );
    assertEquals(res.status, 400);
  } finally {
    await cleanup();
  }
});

// Locks in (and documents) current behavior for adversarial / corrupted
// metadata shapes — the route trusts `data.images || []` without validating
// the shape. If the route is ever hardened, these tests will fail and force
// a deliberate decision about the new contract.
Deno.test("images: GET image-metadata returns the raw object when 'images' key is a non-array object (no chapter filter)", async () => {
  const { root, series, story, storyDir, cleanup } = await setupTmpStory();
  try {
    await Deno.writeTextFile(
      join(storyDir, "_images", "_metadata.json"),
      JSON.stringify({ images: { not: "an array" } }),
    );
    const app = createApp(root);
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${series}/${story}/image-metadata`),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.images, { not: "an array" });
  } finally {
    await cleanup();
  }
});

Deno.test("images: GET image-metadata returns 500 when 'images' is non-array AND chapter filter is supplied (filter throws)", async () => {
  const { root, series, story, storyDir, cleanup } = await setupTmpStory();
  try {
    await Deno.writeTextFile(
      join(storyDir, "_images", "_metadata.json"),
      JSON.stringify({ images: { not: "an array" } }),
    );
    const app = createApp(root);
    const res = await app.fetch(
      new Request(
        `http://localhost/api/stories/${series}/${story}/image-metadata?chapter=1`,
      ),
    );
    // images.filter is not a function → caught by outer catch → 500
    assertEquals(res.status, 500);
    const body = await res.json();
    assertEquals(body.title, "Internal Server Error");
  } finally {
    await cleanup();
  }
});

Deno.test("images: GET image-metadata coerces a string 'images' value the same way", async () => {
  const { root, series, story, storyDir, cleanup } = await setupTmpStory();
  try {
    await Deno.writeTextFile(
      join(storyDir, "_images", "_metadata.json"),
      JSON.stringify({ images: "oops-a-string" }),
    );
    const app = createApp(root);
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${series}/${story}/image-metadata`),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    // String passes through verbatim because the route does no shape validation.
    assertEquals(body.images, "oops-a-string");
  } finally {
    await cleanup();
  }
});
