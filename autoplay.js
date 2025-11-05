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

// === Setup Directories ===
const tempDir = "./temp";
const outputDir = "./public";
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

app.use(express.json());
app.use(express.static(outputDir));

// === Random User-Agents (helps bypass Imgur throttling) ===
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  "Mozilla/5.0 (X11; Linux x86_64)",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 15_2 like Mac OS X)"
];

// === Download MP4 file ===
async function downloadToFile(url, dest) {
  const ua = userAgents[Math.floor(Math.random() * userAgents.length)];
  const res = await fetch(url, { headers: { "User-Agent": ua } });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  await streamPipeline(res.body, fs.createWriteStream(dest));
  console.log(`✅ Downloaded: ${url}`);
}

// === Convert MP4 to autoplay-friendly format ===
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
      .save(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", reject);
  });
}

// === Main API Endpoint ===
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
    console.error("❌ Conversion error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// === Health route for Render ===
app.get("/", (req, res) => {
  res.send("✅ MP4 Autoplay Server is running!");
});

// === Start Server ===
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
