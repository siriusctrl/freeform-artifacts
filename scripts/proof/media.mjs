import { spawnSync } from "node:child_process";
import { existsSync, renameSync, writeFileSync } from "node:fs";

function mediaDuration(mediaPath) {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", mediaPath],
    { encoding: "utf8" },
  );
  const duration = Number.parseFloat(probe.stdout.trim());
  if (probe.status !== 0 || !Number.isFinite(duration) || duration <= 0) {
    throw new Error(`ffprobe failed to read media duration: ${probe.stderr}`);
  }
  return duration;
}

function checkSampledFrames(gifFile) {
  const width = 64;
  const height = 40;
  const channels = 3;
  const frameSize = width * height * channels;
  const sample = spawnSync(
    "ffmpeg",
    ["-i", gifFile, "-vf", `fps=1,scale=${width}:${height}:flags=bilinear`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
  );

  if (sample.status !== 0) {
    throw new Error(`ffmpeg failed to sample GIF frames: ${sample.stderr.toString()}`);
  }

  const frames = [];
  for (let offset = 0; offset + frameSize <= sample.stdout.length; offset += frameSize) {
    let sum = 0;
    let sumSq = 0;
    for (let index = offset; index < offset + frameSize; index += channels) {
      const r = sample.stdout[index];
      const g = sample.stdout[index + 1];
      const b = sample.stdout[index + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += luma;
      sumSq += luma * luma;
    }
    const count = width * height;
    const mean = sum / count;
    const variance = Math.max(0, sumSq / count - mean * mean);
    frames.push({
      index: frames.length,
      mean: Number(mean.toFixed(2)),
      deviation: Number(Math.sqrt(variance).toFixed(2)),
      blankLike: Math.sqrt(variance) < 2.8,
    });
  }

  const blankFrames = frames.filter((frame) => frame.blankLike);
  const report = {
    frameCount: frames.length,
    blankFrameCount: blankFrames.length,
    frames,
  };

  if (frames.length < 12) {
    throw new Error("GIF frame check found too few sampled frames");
  }

  if (blankFrames.length > 0) {
    throw new Error(`GIF frame check found blank-like frames: ${blankFrames.map((frame) => frame.index).join(", ")}`);
  }

  return report;
}

export function createProofMedia({
  proofVideoPath,
  webmPath,
  screenshotPath,
  gifPath,
  contactSheetPath,
  frameCheckPath,
  proofTrimStartSeconds,
}) {
  renameSync(proofVideoPath, webmPath);

  const ffmpeg = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      proofTrimStartSeconds,
      "-i",
      webmPath,
      "-loop",
      "1",
      "-t",
      "1.8",
      "-i",
      screenshotPath,
      "-filter_complex",
      "[0:v]fps=12,scale=960:-1:flags=lanczos[v0];[1:v]fps=12,scale=960:-1:flags=lanczos[v1];[v0][v1]concat=n=2:v=1:a=0,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
      gifPath,
    ],
    { stdio: "pipe" },
  );

  if (ffmpeg.status !== 0 || !existsSync(gifPath)) {
    throw new Error(`ffmpeg failed to create GIF: ${ffmpeg.stderr.toString()}`);
  }

  const proofDuration = mediaDuration(gifPath);
  const contactSheetFps = 30 / proofDuration;
  const contactSheet = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      gifPath,
      "-vf",
      `fps=${contactSheetFps.toFixed(6)},scale=280:-1:flags=lanczos,tile=5x6:padding=8:margin=8:color=white`,
      "-frames:v",
      "1",
      "-update",
      "1",
      contactSheetPath,
    ],
    { stdio: "pipe" },
  );

  if (contactSheet.status !== 0 || !existsSync(contactSheetPath)) {
    throw new Error(`ffmpeg failed to create contact sheet: ${contactSheet.stderr.toString()}`);
  }

  const frameCheck = checkSampledFrames(gifPath);
  writeFileSync(frameCheckPath, `${JSON.stringify(frameCheck, null, 2)}\n`);
  return { proofDuration, frameCheck };
}

const actions = [
  "inspect initial layout and controls",
  "rename the centered canvas title",
  "toggle Views with Cmd+B",
  "open the sidebar, create and rename a second view, and switch back",
  "duplicate, reorder, delete, and restore a View",
  "reorder a View downward and restore an unsaved deleted View snapshot",
  "enter Fit All presentation and navigate between Views",
  "marquee-select and distribute multiple artifacts",
  "group-drag with transactional Undo and Redo",
  "duplicate, copy, paste, and delete a selection",
  "drag node",
  "visibly resize the complete chart object",
  "visibly resize Sankey to its proportional minimum",
  "drag-pan canvas",
  "wheel pan",
  "pinch zoom in and out around a stable pointer anchor",
  "toolbar zoom and viewport reset",
  "import query result",
  "toggle dark mode",
  "show Turnstile verification, an actionable creation failure, and retry",
  "open and copy a capability-redacted, view-bound encrypted Build Session handoff",
  "reconnect the hibernating WebSocket without retargeting the session",
  "show visible install progress while atomically delivering two artifacts through the relay script",
  "reject a bad multi-artifact relay selection without partial persistence",
  "reject an invalid offline bundle with inline feedback",
  "verify the complete dialog at a 667x375 short-landscape viewport",
  "expire the session and remove its browser-visible handoff capabilities",
  "delete and drag a personal artifact back from the shared library",
  "delete and restore a built-in artifact from the library",
  "close responsive Views and exit responsive presentation without a keyboard",
  "close, reopen, and restore the browser-local workspace",
  "capture screenshot",
];

export function writeProofReport({
  manifestPath,
  inspectionPath,
  url,
  relayUrl,
  proofTrimStartSeconds,
  proofDuration,
  gifPath,
  webmPath,
  screenshotPath,
  contactSheetPath,
  frameCheckPath,
  uxChecksPath,
  uxChecks,
  frameCheck,
  finalState,
}) {
  const manifest = {
    url,
    relayUrl,
    createdAt: new Date().toISOString(),
    proofTrimStartSeconds,
    proofDuration,
    actions,
    files: {
      gif: gifPath,
      webm: webmPath,
      screenshot: screenshotPath,
      contactSheet: contactSheetPath,
      frameCheck: frameCheckPath,
      uxChecks: uxChecksPath,
    },
    uxChecks,
    finalState,
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    inspectionPath,
    [
      "Browser proof inspection",
      "",
      ...uxChecks.map((check) => `- PASS: ${check.name}`),
      `- PASS: ${frameCheck.frameCount} sampled GIF frames contained no blank-like frames.`,
      "- A dense 30-cell contact sheet was generated for temporal visual inspection.",
      "",
      `GIF: ${gifPath}`,
      `WebM: ${webmPath}`,
      `Screenshot: ${screenshotPath}`,
      `Contact sheet: ${contactSheetPath}`,
      `Frame check: ${frameCheckPath}`,
      `UX checks: ${uxChecksPath}`,
      "",
    ].join("\n"),
  );
}
