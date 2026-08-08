import * as faceapi from 'face-api.js';

/**
 * Face-api model loading, shared across the whole app instead of each
 * StrictLock mount starting its own fresh load.
 *
 * Models are self-hosted at /models (see public/models/README — you need
 * to actually place the model files there once; see setup instructions).
 * This is what fixes the 1-1.5 minute cold load: previously these were
 * fetched from a third-party GitHub Pages URL on every single scan open,
 * with no reliable caching (browsers now partition HTTP cache per-site,
 * so even good caching headers on the third-party host didn't help much).
 *
 * preloadFaceModels() can be called proactively (e.g. from App.tsx, the
 * moment the app opens, if face lock is enabled) so the download happens
 * quietly in the background during normal app use — by the time someone
 * actually opens the scanner, it's often already done.
 */

const MODEL_URL = '/models';

let loadPromise: Promise<void> | null = null;
let isLoaded = false;

export function preloadFaceModels(): Promise<void> {
  if (isLoaded) return Promise.resolve();
  if (loadPromise) return loadPromise; // already in flight — share it, don't duplicate

  loadPromise = Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]).then(() => {
    isLoaded = true;
  }).catch((err) => {
    // Let the next call retry from scratch instead of being permanently
    // stuck on a rejected promise.
    loadPromise = null;
    throw err;
  });

  return loadPromise;
}

export function areFaceModelsLoaded(): boolean {
  return isLoaded;
}