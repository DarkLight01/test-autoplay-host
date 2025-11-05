// autoplay.js
import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { pipeline } from "stream";
import { promisify } from "util";

const app = express();
const PORT = process.env.PORT || 3000;
const streamPipeline = promisify(pipeline);

const tempDir = "./temp";
const outputDir = "./public";
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

app.use(express.json());

// === Random User-Agents to avoid Imgur throttling ===
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  "Mozilla/5.0 (X11; Linux x86_64)",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 15_2 like Mac OS X)"
];

// === Download the video ===
async function downloadToFile(url, dest) {
  const ua = userAgents[Math.floor(Math.random() * userAgents.length)];
  const res = await fetch(url, { headers: { "User-Agent": ua } });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  await streamPipeline(res.body, fs.createWriteStream(dest));
  console.log(`✅ Downloaded: ${url}`);
}

// === Convert to progressive MP4 (Discord autoplay-ready) ===
async function convertToEmbed(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-an", // remove audio
        "-c:v libx264",
        "-pix_fmt yuv420p",
        "-movflags +faststart",
        "-vf", "fps=30,scale=iw:-2:flags=lanczos"
      ])
      .on("end", () => resolve(outputPath))
      .on("error", reject)
      .save(outputPath);
  });
}

// === /convert endpoint ===
app.post("/convert", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Missing URL" });

  try {
    const id = Date.now().toString(36);
    const inputPath = path.join(tempDir, `${id}.mp4`);
    const outputPath = path.join(outputDir, `${id}.mp4`);

    console.log(`🎞️ Processing: ${url}`);
    await downloadToFile(url, inputPath);
    await convertToEmbed(inputPath, outputPath);
    fs.unlinkSync(inputPath);

    const publicUrl = `${req.protocol}://${req.get("host")}/${path.basename(outputPath)}`;
    console.log(`✅ Conversion complete: ${publicUrl}`);

    res.json({ success: true, url: publicUrl });
  } catch (err) {
    console.error("❌ Conversion error:", err);
    res.status(500).json({ error: err.message });
  }
});

// === Serve MP4s with correct headers (for autoplay in Discord) ===
app.get("/*.mp4", (req, res) => {
  const filePath = path.join(outputDir, req.path);
  if (!fs.existsSync(filePath)) return res.status(404).send("Not Found");

  const stat = fs.statSync(filePath);
  const range = req.headers.range;

  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", "video/mp4");

  if (range) {
    const [start, end] = range.replace(/bytes=/, "").split("-");
    const chunkStart = parseInt(start, 10);
    const chunkEnd = end ? parseInt(end, 10) : stat.size - 1;
    const chunkSize = chunkEnd - chunkStart + 1;

    const fileStream = fs.createReadStream(filePath, { start: chunkStart, end: chunkEnd });
    res.writeHead(206, {
      "Content-Range": `bytes ${chunkStart}-${chunkEnd}/${stat.size}`,
      "Content-Length": chunkSize,
      "Content-Type": "video/mp4"
    });
    fileStream.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": "video/mp4"
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// === Health check for Render ===
app.get("/", (req, res) => {
  res.send("✅ MP4 Autoplay Server is running!");
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
