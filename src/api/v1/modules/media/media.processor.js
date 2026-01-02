// NOTE: This module lives at: src/api/v1/modules/media/
// To reach src/config/appConfig.js we need 4 levels up.
const appConfig = require('../../../../config/appConfig');

// Standard media processing (image optimize + optional video transcode)
const sharp = require('sharp');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Video transcode is optional. It needs `fluent-ffmpeg` + an ffmpeg binary.
let ffmpeg;
let ffmpegPath;

function loadFfmpeg() {
  if (ffmpeg) return { ffmpeg, ffmpegPath };
  try {
    ffmpeg = require('fluent-ffmpeg');
    // prefer env override, else ffmpeg-static
    ffmpegPath = process.env.FFMPEG_PATH || null;
    if (!ffmpegPath) {
      try {
        ffmpegPath = require('ffmpeg-static');
      } catch (_) {
        ffmpegPath = null;
      }
    }
    if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
    return { ffmpeg, ffmpegPath };
  } catch (_) {
    return { ffmpeg: null, ffmpegPath: null };
  }
}

function isImage(mime) {
  return String(mime || '').toLowerCase().startsWith('image/');
}

function isVideo(mime, originalname) {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('video/')) return true;
  const n = String(originalname || '').toLowerCase();
  return n.endsWith('.mp4') || n.endsWith('.mov') || n.endsWith('.m4v') || n.endsWith('.avi') || n.endsWith('.mkv');
}

async function optimizeImage(file, opts = {}) {
  const maxSide = Number(opts.maxSide || appConfig.mediaPolicy?.imageMaxSide || process.env.IMAGE_MAX_SIDE || 1600);
  const quality = Number(opts.quality || appConfig.mediaPolicy?.imageJpegQuality || process.env.IMAGE_JPEG_QUALITY || 82);
  const outBuf = await sharp(file.buffer)
    .rotate()
    .resize(maxSide, maxSide, { fit: 'inside' })
    .jpeg({ quality })
    .toBuffer();

  const base = (file.originalname || 'image').replace(/\.[^/.]+$/, '');
  return {
    ...file,
    buffer: outBuf,
    mimetype: 'image/jpeg',
    originalname: `${base}.jpg`,
  };
}

async function transcodeVideoIfEnabled(file, opts = {}) {
  const enabled = String(process.env.VIDEO_TRANSCODE || '').toLowerCase() === 'true';
  if (!enabled) return file;

  const { ffmpeg: F } = loadFfmpeg();
  if (!F) return file;

  const maxMb = Number(opts.maxInputMb || process.env.VIDEO_TRANSCODE_MAX_MB || 80);
  const sizeMb = (file.size || file.buffer?.length || 0) / (1024 * 1024);
  if (sizeMb > maxMb) return file; // too big for in-memory safe transcode

  const tmpDir = os.tmpdir();
  const id = crypto.randomBytes(8).toString('hex');
  const inPath = path.join(tmpDir, `bpa_in_${id}`);
  const outPath = path.join(tmpDir, `bpa_out_${id}.mp4`);

  fs.writeFileSync(inPath, file.buffer);

  await new Promise((resolve, reject) => {
    F(inPath)
      .outputOptions([
        '-movflags +faststart',
        '-vf scale=trunc(min(iw\,1280)/2)*2:trunc(min(ih\,1280)/2)*2',
        '-c:v libx264',
        '-preset veryfast',
        '-crf 28',
        '-c:a aac',
        '-b:a 96k',
      ])
      .on('end', resolve)
      .on('error', reject)
      .save(outPath);
  });

  const outBuf = fs.readFileSync(outPath);
  try { fs.unlinkSync(inPath); } catch (_) {}
  try { fs.unlinkSync(outPath); } catch (_) {}

  const base = (file.originalname || 'video').replace(/\.[^/.]+$/, '');
  return {
    ...file,
    buffer: outBuf,
    mimetype: 'video/mp4',
    originalname: `${base}.mp4`,
  };
}

async function processUploadFile(file) {
  if (!file?.buffer) return file;
  if (isImage(file.mimetype)) {
    return optimizeImage(file);
  }
  if (isVideo(file.mimetype, file.originalname)) {
    return transcodeVideoIfEnabled(file);
  }
  return file;
}

module.exports = { processUploadFile, isImage, isVideo };
