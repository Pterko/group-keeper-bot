import { Composer, InputFile } from "grammy";
import { Context } from "#root/bot/context.js";
import axios from "axios";
import fs from "fs";
import { Canvas, Image, ImageData, loadImage } from "canvas";
import { JSDOM } from "jsdom";
import Jimp from "jimp";
import cv from "@techstark/opencv-js";


function clearUnusedListeners() {
  // Retrieve all listeners for 'uncaughtException'
  const listeners = process.listeners('uncaughtException');

  // Remove each listener
  listeners.forEach((listener) => {
    process.removeListener('uncaughtException', listener);
  });

  // Verify no listeners are left
  console.log(process.listeners('uncaughtException')); // Should output: []
}

const composer = new Composer<Context>();

function installDOM() {
  const dom = new JSDOM();
  global.document = dom.window.document;
  global.Image = Image as unknown as typeof HTMLImageElement;
  global.HTMLCanvasElement = Canvas as unknown as typeof HTMLCanvasElement;
  global.ImageData = ImageData as unknown as any;
  global.HTMLImageElement = Image as unknown as any;
}

installDOM();

let classifier: any;

cv['onRuntimeInitialized'] = () => {
  classifier = new cv.CascadeClassifier();
  const xmlString = fs.readFileSync('../haarcascade_frontalcatface_extended.xml', 'utf-8');
  const xmlArrayBuffer = new TextEncoder().encode(xmlString).buffer;
  const data = new Uint8Array(xmlArrayBuffer);
  cv.FS_createDataFile('/', 'classifier.xml', data, true, false, false);
  classifier.load('/classifier.xml');
  //clearUnusedListeners();
};

composer.on(["message:text", "message:photo"], async (ctx, next) => {
  const message = ctx.message;
  if (!message) return await next();

  let itsCat = false;
  let vipukCoeff = 20;

  if (message.caption?.startsWith("/cat") || (message.text?.startsWith("/cat") && message.reply_to_message?.photo)) {
    itsCat = true;
  } else if (message.caption?.toLowerCase().startsWith("выпукни") || (message.text?.toLowerCase().startsWith("выпукни") && message.reply_to_message?.photo)) {
    const str = message.caption || message.text;
    if (str){
      const maybeint = parseInt(str.split(" ")[1]);
      if (maybeint > 0 && maybeint < 100) {
        vipukCoeff = maybeint;
      }
    }
  } else {
    return await next();
  }

  console.log('itsCat:', itsCat);
  console.log("cat:", ctx);

  const photoArray = message.photo?.length ? message.photo : message.reply_to_message?.photo;
  if (!photoArray?.length) return next();

  const photo = photoArray.pop();
  if (!photo) return await next();
  const file = await ctx.api.getFile(photo.file_id);

  const imageUrl = file.getUrl();

  console.log("ImageUrl", imageUrl);

  const httpResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
  console.log("received image data", httpResponse.data);

  const imageCanvas = await loadImage(httpResponse.data);
  const image = cv.imread(imageCanvas as any);
  const gray = new cv.Mat();
  cv.cvtColor(image, gray, cv.COLOR_RGBA2GRAY);

  let bulgeRadius, bulgeStrength, cx, cy;

  if (itsCat) {
    const catFaces = new cv.RectVector();
    const size = new cv.Size(0, 0);
    classifier.detectMultiScale(gray, catFaces, 1.05, 3, 0, size, size);

    const catFaceObjects = [];
    for (let i = 0; i < catFaces.size(); i++) {
      const faceRect = catFaces.get(i);
      catFaceObjects.push({
        x: faceRect.x,
        y: faceRect.y,
        width: faceRect.width,
        height: faceRect.height
      });
    }

    console.log("cat_face", catFaceObjects);

    if (!catFaceObjects.length) {
      return ctx.reply("Cats not found :c", { reply_to_message_id: message.message_id });
    }

    // Find the largest cat face
    const largestCatFace = catFaceObjects.reduce((largest, face) => {
      const faceArea = face.width * face.height;
      const largestArea = largest.width * largest.height;
      return faceArea > largestArea ? face : largest;
    }, catFaceObjects[0]);

    cx = largestCatFace.x + largestCatFace.width / 2;
    cy = largestCatFace.y + largestCatFace.height / 2;
    bulgeRadius = Math.max(largestCatFace.width, largestCatFace.height);
    bulgeStrength = 1;
  } else {
    cx = Math.round(photo.width / 2);
    cy = Math.round(photo.height / 2);
    bulgeRadius = Math.min(photo.height * vipukCoeff * 0.01, photo.width * vipukCoeff * 0.01);
    bulgeStrength = 1;
  }

  const w = photo.width;
  const h = photo.height;
  const jimpedImage = await Jimp.read(httpResponse.data);
  const targetImage = await Jimp.read(httpResponse.data);

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const dx = x - cx;
      const dy = y - cy;
      const distanceSquared = dx * dx + dy * dy;
      let sx = x;
      let sy = y;

      if (distanceSquared < bulgeRadius * bulgeRadius) {
        const distance = Math.sqrt(distanceSquared);
        const r = distance / bulgeRadius;
        const a = Math.atan2(dy, dx);
        const rn = Math.pow(r, bulgeStrength) * distance;
        const newX = rn * Math.cos(a) + cx;
        const newY = rn * Math.sin(a) + cy;

        sx += newX - x;
        sy += newY - y;
      }

      if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
        const pixelColor = jimpedImage.getPixelColor(sx, sy);
        targetImage.setPixelColor(pixelColor, x, y);
      }
    }
  }

  console.log("cycle end");
  const jimpedBuffer = await targetImage.getBufferAsync("image/jpeg");
  console.log("jimpedBuffer", jimpedBuffer);

  return await ctx.replyWithPhoto(new InputFile(jimpedBuffer), { reply_to_message_id: message.message_id });
});

export { composer as catsBulgeFeature };