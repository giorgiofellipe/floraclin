# Image Comparison & Alignment

## Problem

Before/after photo comparisons require both images to be consistently framed and aligned — same zoom level, same face position, same angle. Currently, photos upload as-is from the camera roll and the comparison view shows them raw. Practitioners must manually crop photos externally to get usable comparisons, which is friction they rarely bother with.

## Solution

Three features powered by client-side face detection (MediaPipe FaceLandmarker):

1. **Auto-crop editor** — face-landmark-based crop suggestion with manual adjustment
2. **Landmark-aligned comparison** — automatic scale/rotation/translation transform in the comparison view
3. **Capture pose guide** — camera overlay that guides standardized clinical photo capture

## Approach

Fully client-side using Google's MediaPipe FaceLandmarker (WASM, ~4MB model). This is consistent with the existing client-heavy architecture (DNG decoding, HEIC conversion, canvas compression, Konva annotation). The model downloads once and is browser-cached.

---

## Feature 1: Auto-Crop Editor

### Entry point

New crop icon (✂) on each photo thumbnail in the photo grid. Opens a modal dialog.

### Behavior

1. **Open** — editor loads the full-resolution image and runs face detection
2. **Auto-crop** — if a face is found, the crop frame auto-positions: eyes at ~30% from top, face centered horizontally, consistent padding around the face. Default aspect ratio 3:4 (portrait).
3. **Adjust** — user can drag corner/edge handles to resize, drag the crop frame to reposition, change aspect ratio (3:4, 4:3, 1:1, free), rotate the image, or reset to auto-detected position.
4. **Save** — stores crop geometry and detected landmarks as JSON in the existing `cropBox` column on `photo_assets`. Original photo is never modified — crop is applied on render.

### Visual cues

- **Green dots** on detected landmarks (left eye, right eye, nose tip)
- **Green horizontal line** at eye level ("linha dos olhos")
- **Dashed center line** for vertical face symmetry
- **Dashed oval** — face outline hint
- **Rule-of-thirds grid** within the crop frame
- **Dark overlay** outside the crop area

### Toolbar

- Aspect ratio buttons: 3:4 (default, active), 4:3, 1:1, Livre (free)
- Reset button — restores auto-detected crop position
- Rotate button — 90° clockwise rotation
- Status bar — "Rosto detectado • 3 landmarks" or "Nenhum rosto detectado" (falls back to center-weighted crop)

### Fallback

If no face is detected: crop frame defaults to center-weighted with the selected aspect ratio. Landmarks are not stored. The editor remains fully functional for manual cropping — face detection is a convenience, not a requirement.

---

## Feature 2: Landmark-Aligned Comparison

### Changes to existing comparison dialog

A new **"Alinhamento" toggle switch** in the comparison toolbar. Only appears when both selected photos have stored landmarks in their `cropBox` data.

### Alignment algorithm

1. Photo A is the reference frame. Its eye positions and inter-pupillary distance define the target geometry.
2. From photo B's landmarks, compute a **similarity transform** (uniform scale + rotation + translation) that maps B's eye centers onto A's eye centers.
3. Apply the transform as a CSS `matrix()` on photo B's `<img>` element. No pixel manipulation — the original image stays sharp and the transform toggles on/off instantly.

### Interaction with comparison modes

- **Slider mode** — with alignment on, dragging the slider reveals a precisely aligned before/after. Features overlap across the divider.
- **Side-by-side mode** — both photos cropped and scaled consistently. Faces appear at the same size and position in their respective panels.
- **Overlay mode** — with alignment on, the opacity slider produces a true before/after morph effect because facial features overlap.

### When landmarks are missing

If either photo lacks landmarks (never went through the crop editor), the alignment toggle does not appear. The comparison works exactly as it does today — raw images in the selected mode.

---

## Feature 3: Capture Pose Guide

### Entry point

New **"Capturar com guia"** button in the patient photos upload section, next to the existing file picker. Opens the device camera in a dialog.

### Poses

Five standard clinical poses, selectable via tabs at the top of the camera view:

| Pose | Expected yaw range | Guide shape |
|------|-------------------|-------------|
| Frontal | ±8° | Centered oval |
| 45° Esquerda | 30°–55° | Oval offset left |
| Perfil Esquerda | 65°–90° | Side profile outline, left |
| 45° Direita | −55° to −30° | Oval offset right |
| Perfil Direita | −90° to −65° | Side profile outline, right |

### States

**Adjusting (yellow):**
- Guide outlines are yellow/amber
- Directional text hints appear: "Mova para esquerda", "Levante o queixo", "Afaste-se um pouco"
- Capture button is disabled (dimmed, 40% opacity)
- Status badge: "Ajustando posição..."

**Aligned (green):**
- Guide outlines turn green
- Directional hints disappear
- Capture button activates (white, full opacity)
- Status badge: "Posição ideal"

### Alignment criteria

For the face to be considered "aligned" with the target pose:

- Yaw angle within the pose's expected range
- Face bounding box fills 40%–70% of the guide oval (not too far, not too close)
- Face center within 10% of the guide center (horizontally and vertically)
- Pitch within ±15° (not looking too far up or down)

### After capture

The captured frame is extracted from the video stream, compressed through the same client-side pipeline (canvas resize to max 2048px, WebP/JPEG quality 0.85), and uploaded via the existing photo upload API (`POST /api/photos`). Immediately after upload succeeds, a second call to `PATCH /api/photos/[photoId]/crop` saves the landmarks and a full-frame crop. This keeps the upload API unchanged and reuses the same crop endpoint. Since face detection was already running during the guide, the landmarks are available in memory — no separate detection step needed.

### Camera requirements

Uses `navigator.mediaDevices.getUserMedia()` with the rear-facing camera (`facingMode: 'environment'`). Falls back to any available camera. If camera access is denied, shows a message with instructions and a close button.

---

## Data Model

### No schema migration needed

The existing `cropBox` (jsonb) column on `photo_assets` stores all data:

```ts
interface PhotoCropData {
  // Crop geometry (normalized 0-1 relative to original image dimensions)
  x: number
  y: number
  width: number
  height: number
  rotation: number // degrees

  // Key landmarks (normalized 0-1 relative to original image)
  landmarks: {
    leftEye: { x: number; y: number }
    rightEye: { x: number; y: number }
    noseTip: { x: number; y: number }
    interPupillaryDistance: number
  }

  aspect: '3:4' | '4:3' | '1:1' | 'free'
}
```

The `cropAspect` column (already exists) is not used — the aspect ratio is stored inside the JSON for atomicity.

### Validation

A Zod schema validates the `cropBox` payload on the API side:

- All numeric fields: `z.number().min(0).max(1)` (normalized coordinates)
- `rotation`: `z.number().min(-360).max(360)`
- `landmarks`: optional object — absent when no face was detected
- `aspect`: `z.enum(['3:4', '4:3', '1:1', 'free'])`

---

## Architecture

### New files

| File | Purpose |
|------|---------|
| `web/src/lib/face-detection.ts` | MediaPipe FaceLandmarker singleton. Lazy-loads model on first call. `detectFace(source)` → landmarks, bounding box, yaw/pitch/roll. |
| `web/src/lib/face-alignment.ts` | Pure functions. `computeAlignmentTransform(landmarksA, landmarksB)` → `{ scale, rotation, translateX, translateY }` for CSS `matrix()`. `computeAutoCrop(landmarks, aspect, imageWidth, imageHeight)` → crop geometry. |
| `web/src/components/photos/photo-crop-editor.tsx` | Modal dialog. Canvas-based crop handles, landmark overlays, aspect ratio selector, rotate, reset. Saves via `PATCH /api/photos/[photoId]/crop`. |
| `web/src/components/photos/capture-pose-guide.tsx` | Camera dialog. `getUserMedia`, real-time face detection loop, pose tabs, alignment feedback, capture button. Outputs a captured frame to the existing upload pipeline. |
| `web/src/validations/photo-crop.ts` | Zod schema for `PhotoCropData`. |

### Modified files

| File | Change |
|------|--------|
| `web/src/components/photos/photo-grid.tsx` | Add crop icon button on each thumbnail. Open `PhotoCropEditor` modal on click. Show a small badge if photo has a crop. |
| `web/src/components/photos/photo-comparison.tsx` | Add alignment toggle. Read `cropBox.landmarks` from both photos. Apply CSS `matrix()` transform to photo B when alignment is on. |
| `web/src/components/patients/patient-photos-tab.tsx` | Add "Capturar com guia" button. Wire up `CapturePoseGuide` dialog and `PhotoCropEditor` modal. |
| `web/src/app/api/photos/route.ts` | Include `cropBox` in the GET response for comparison URLs (already returned for list, verify for comparison pair). |

### New API endpoint

**`PATCH /api/photos/[photoId]/crop`**

- Auth: tenant member, photo must belong to the tenant
- Body: `PhotoCropData` (validated by Zod schema)
- Action: updates `cropBox` column on the `photo_assets` row
- Response: `{ success: true }`

### New dependency

- `@mediapipe/tasks-vision` — FaceLandmarker WASM runtime

The model file (`face_landmarker.task`, ~4MB) is loaded from the CDN bundled with the package. It downloads once and is browser-cached. No self-hosting needed.

---

## Scope boundaries

**In scope:**
- Auto-crop editor with face landmarks
- Landmark-aligned comparison (all three existing modes)
- Capture pose guide with 5 clinical poses
- Non-destructive crop storage in existing `cropBox` column

**Out of scope:**
- Batch crop (crop multiple photos at once) — future enhancement
- Server-side face detection — client-only for now
- Body region cropping — face only per user requirement
- Auto-crop on upload — crop is always an explicit user action
- Modifying the photo upload pipeline — photos still upload raw
