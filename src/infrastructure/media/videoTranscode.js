const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

function _tmpFile(ext = 'mp4') {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return path.join(os.tmpdir(), `bpa-${id}.${ext}`);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg binary not found (ffmpeg-static)'));
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg failed (${code}): ${err.slice(-2000)}`));
    });
  });
}

/**
 * Premium pipeline:
 * - optional trim (ms)
 * - optional audio volume/mute
 * - compress to mobile friendly mp4 (h264 + aac)
 */
async function transcodeVideoBuffer(inputBuffer, opts = {}) {
  const {
    trimStartMs,
    trimEndMs,
    mute,
    volume,
    targetWidth = 1280,
    crf = 28,
    preset = 'fast',
  } = opts;

  const inFile = _tmpFile('mp4');
  const outFile = _tmpFile('mp4');

  try {
    await fsp.writeFile(inFile, inputBuffer);

    const args = ['-y'];
    // seek before input for speed when possible
    if (typeof trimStartMs === 'number' && trimStartMs > 0) {
      args.push('-ss', `${trimStartMs / 1000}`);
    }
    args.push('-i', inFile);

    // trim end
    if (typeof trimEndMs === 'number' && trimEndMs > 0) {
      const startS = (typeof trimStartMs === 'number' && trimStartMs > 0) ? trimStartMs / 1000 : 0;
      const durS = Math.max(0.2, trimEndMs / 1000 - startS);
      args.push('-t', `${durS}`);
    }

    // video settings
    args.push(
      '-vf', `scale=${targetWidth}:-2`,
      '-c:v', 'libx264',
      '-preset', preset,
      '-crf', `${crf}`,
      '-movflags', '+faststart'
    );

    // audio settings
    if (mute) {
      args.push('-an');
    } else {
      args.push('-c:a', 'aac', '-b:a', '96k');
      const vol = typeof volume === 'number' ? volume : 1.0;
      if (vol !== 1.0) {
        // Apply audio filter
        args.push('-af', `volume=${Math.min(Math.max(vol, 0.0), 2.0)}`);
      }
    }

    args.push(outFile);
    await runFfmpeg(args);
    const out = await fsp.readFile(outFile);
    return out;
  } finally {
    // best-effort cleanup
    try {
      if (fs.existsSync(inFile)) await fsp.unlink(inFile);
    } catch {}
    try {
      if (fs.existsSync(outFile)) await fsp.unlink(outFile);
    } catch {}
  }
}

module.exports = { transcodeVideoBuffer };
