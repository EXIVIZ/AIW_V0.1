

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// --- Scene Setup ---
const scene = new THREE.Scene();
const raycaster = new THREE.Raycaster(); // For collision detection
// FIX: Changed type from Object3D to Group to match the type of a loaded GLTF scene.
let model = null; // To hold the loaded model for collision checks

// Camera Group (for positioning)
const cameraGroup = new THREE.Group();
scene.add(cameraGroup);

// Camera
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.01,
  1000,
);
cameraGroup.add(camera);

// Renderer
const renderer = new THREE.WebGLRenderer({
  antialias: true,
});
renderer.shadowMap.enabled = false; // Shadows are disabled as there are no lights
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
// Tone mapping removed as there is no HDR lighting
document.body.appendChild(renderer.domElement);
renderer.domElement.classList.add('blurred'); // Add blur initially

// --- Debug Info Elements ---
const debugPositionEl = document.getElementById('debug-position');
const debugRotationEl = document.getElementById('debug-rotation');

// --- Environment and Background ---
// Load the HDRI as a background, but not as an environment map for lighting.
new RGBELoader().load(
  'Yard.hdr',
  (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture; // Set as background only
    // scene.environment is NOT set, so it won't light the scene.
  },
  undefined,
  (error) => {
    console.error('An error happened while loading the HDRI:', error);
  },
);

// --- Load Model ---
const loader = new GLTFLoader();
loader.load(
  './INTERIOR.glb',
  (gltf) => {
    model = gltf.scene; // Assign to the model variable for collision detection

    // --- Modify Original Model Materials ---
    // Traverse the ORIGINAL model and replace PBR materials with MeshBasicMaterial
    // to make the scene visible without any lighting.
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const applyBasicMaterial = (material) => {
          const newMaterial = new THREE.MeshBasicMaterial();
          // Copy essential properties from the old material
          if (material.color) newMaterial.color.copy(material.color);
          if (material.map) newMaterial.map = material.map;
          if (material.transparent)
            newMaterial.transparent = material.transparent;
          if (material.opacity) newMaterial.opacity = material.opacity;

          // Dispose of the old material to free up GPU memory
          material.dispose();
          return newMaterial;
        };

        if (Array.isArray(child.material)) {
          child.material = child.material.map(applyBasicMaterial);
        } else if (child.material) {
          child.material = applyBasicMaterial(child.material);
        }
      }
    });

    scene.add(model);
  },
  undefined,
  (error) => {
    console.error('An error happened while loading the model:', error);
  },
);

// --- Location Presets ---
const locations = {
  foyer: {
    position: new THREE.Vector3(0.59, 1, 4.41),
    rotation: { x: -0.11, y: -0.07 },
  },
  livingRoom: {
    position: new THREE.Vector3(-2.03, 1, 1.32),
    rotation: { x: -0.03, y: -0.03 },
  },
  kitchen: {
    position: new THREE.Vector3(-2.81, 1, 1.51),
    rotation: { x: -0.06, y: -2.89 },
  },
  bedroom: {
    position: new THREE.Vector3(0.18, 1, -0.54),
    rotation: { x: -0.13, y: -0.72 },
  },
  floorPlan: {
    position: new THREE.Vector3(0, 11, 0),
    rotation: { x: -1.57, y: -1.57 },
  },
};

const tourLocations = [
  locations.foyer,
  locations.livingRoom,
  locations.kitchen,
  locations.bedroom,
  locations.floorPlan,
];

// Map location objects to their button IDs for easy lookup
const locationButtonMap = new Map([
  [locations.foyer, 'foyer-btn'],
  [locations.livingRoom, 'living-room-btn'],
  [locations.kitchen, 'kitchen-btn'],
  [locations.bedroom, 'bedroom-btn'],
  [locations.floorPlan, 'floor-plan-btn'],
]);

// --- Interaction State ---
let isDragging = false;
let isTransitioning = false; // Flag for location-based transitions
let isInFloorPlanView = false; // Flag for floor plan control scheme
let previousMousePosition = { x: 0, y: 0 };
let isTourActive = false;
let currentTourIndex = 0;
// FIX: Changed type from `number` to `ReturnType<typeof setTimeout>` to support both browser (number) and Node.js (Timeout object) timer types.
let tourTimeoutId = null;
let previousPinchDistance = 0; // For touch controls
const keysPressed = new Set(); // For keyboard movement

// Separate smoothing factors for different interactions
const locationLerpFactor = 0.03; // Slower, for smooth transitions between locations
const movementLerpFactor = 0.1; // Faster, for responsive direct control
const collisionOffset = 0.4; // Minimum distance to keep from walls

const targetPosition = new THREE.Vector3();
const targetRotation = { x: 0, y: 0 };

// Start the camera group at the foyer position and rotation
cameraGroup.position.copy(locations.foyer.position);
camera.rotation.x = locations.foyer.rotation.x;
cameraGroup.rotation.y = locations.foyer.rotation.y;

// Initialize targets to the starting location
targetPosition.copy(locations.foyer.position);
targetRotation.x = locations.foyer.rotation.x;
targetRotation.y = locations.foyer.rotation.y;

// --- Event Listeners ---

// Helper to set target for smooth transitions and set the transition flag
function setViewTarget(location, isFloorPlan = false) {
  isTransitioning = true;
  isInFloorPlanView = isFloorPlan; // Set the current view mode
  targetPosition.copy(location.position);
  targetRotation.x = location.rotation.x;
  targetRotation.y = location.rotation.y;
}

// New wrapper to also stop tour
function selectView(location, isFloorPlan = false) {
  stopGuidedTour();
  setViewTarget(location, isFloorPlan);
}

// --- Start Button Logic ---
const startOverlay = document.getElementById('start-overlay');
const startBtn = document.getElementById('start-btn');

startBtn?.addEventListener(
  'click',
  () => {
    // Fade out the overlay
    startOverlay?.classList.add('hidden');

    // Un-blur the canvas
    renderer.domElement.classList.remove('blurred');
  },
  { once: true },
);

// Button Listeners
document
  .getElementById('foyer-btn')
  ?.addEventListener('click', () => selectView(locations.foyer, false));
document
  .getElementById('living-room-btn')
  ?.addEventListener('click', () => selectView(locations.livingRoom, false));
document
  .getElementById('kitchen-btn')
  ?.addEventListener('click', () => selectView(locations.kitchen, false));
document
  .getElementById('bedroom-btn')
  ?.addEventListener('click', () => selectView(locations.bedroom, false));
document
  .getElementById('floor-plan-btn')
  ?.addEventListener('click', () => selectView(locations.floorPlan, true));

// --- UI Toggle ---
const toggleUiBtn = document.getElementById('toggle-ui-btn');
const locationButtons = document.getElementById('location-buttons');

// The top-right button now acts as a simple toggle.
toggleUiBtn?.addEventListener('click', () => {
  if (locationButtons && toggleUiBtn) {
    locationButtons.classList.toggle('collapsed');
    toggleUiBtn.classList.toggle('is-collapsed');
  }
});

// Mouse event listeners for rotation
renderer.domElement.addEventListener('mousedown', (e) => {
  stopGuidedTour();
  isTransitioning = false; // User interaction overrides location transition
  previousMousePosition = { x: e.clientX, y: e.clientY };
  if (e.button === 0) {
    // Left mouse button for rotation
    isDragging = true;
    // Sync target to current rotation to prevent jump
    targetRotation.y = cameraGroup.rotation.y;
    targetRotation.x = camera.rotation.x;
  }
});

renderer.domElement.addEventListener('mousemove', (e) => {
  if (isDragging) {
    const deltaX = e.clientX - previousMousePosition.x;
    const deltaY = e.clientY - previousMousePosition.y;

    if (isInFloorPlanView) {
      // PANNING LOGIC for Floor Plan View
      // Adjust pan speed based on how zoomed in we are
      const panSpeed = 0.01 * (cameraGroup.position.y / 11);
      // Floor plan is rotated -90deg on Y, so X/Z axes are swapped/inverted
      targetPosition.z -= deltaX * panSpeed;
      targetPosition.x += deltaY * panSpeed;
    } else {
      // ROTATION LOGIC for First-Person View
      targetRotation.y -= deltaX * 0.005; // Update target for yaw
      targetRotation.x -= deltaY * 0.005; // Update target for pitch

      // Clamp vertical rotation target to prevent flipping
      targetRotation.x = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, targetRotation.x),
      );
    }

    previousMousePosition = { x: e.clientX, y: e.clientY };
  }
});

renderer.domElement.addEventListener('mouseup', () => {
  isDragging = false;
});

renderer.domElement.addEventListener('mouseleave', () => {
  isDragging = false;
});

// Prevent context menu on right click
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

const fixedDollySpeed = 0.5;

// Handle mouse wheel for dolly (Collision logic is now in animate loop)
renderer.domElement.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (!model) return; // Don't move if model isn't loaded

    stopGuidedTour();
    isTransitioning = false; // User interaction overrides location transition

    if (isInFloorPlanView) {
      // ZOOM LOGIC (Y-axis movement) for Floor Plan View
      const zoomSpeed = 0.5;
      const moveSign = e.deltaY > 0 ? 1 : -1;
      targetPosition.y += moveSign * zoomSpeed;
      // Clamp the zoom distance
      targetPosition.y = Math.max(2, Math.min(20, targetPosition.y));
    } else {
      // DOLLY LOGIC (XZ-plane movement) for First-Person View
      // Get the direction the camera is looking, projected onto the XZ plane
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();

      // Determine move direction and amount from scroll
      const moveSign = e.deltaY > 0 ? -1 : 1; // -1 for backward, 1 for forward
      const moveAmount = 0.3 * fixedDollySpeed;

      // Just update the target position; collision is handled in the animate loop
      targetPosition.addScaledVector(forward, moveSign * moveAmount);
    }
  },
  { passive: false },
);

// --- Touch Controls ---
renderer.domElement.addEventListener(
  'touchstart',
  (e) => {
    // Prevent default touch behavior (like scrolling or refresh)
    e.preventDefault();

    stopGuidedTour();
    isTransitioning = false; // User interaction overrides transitions

    const touches = e.touches;

    if (touches.length === 1) {
      // Single finger touch: handle rotation/pan
      isDragging = true;
      previousMousePosition = {
        x: touches[0].clientX,
        y: touches[0].clientY,
      };
      // Sync target to current rotation to prevent jump
      targetRotation.y = cameraGroup.rotation.y;
      targetRotation.x = camera.rotation.x;
    } else if (touches.length === 2) {
      // Two-finger touch: handle pinch to zoom/dolly
      isDragging = false; // Ensure single-touch drag doesn't interfere
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      previousPinchDistance = Math.sqrt(dx * dx + dy * dy);
    }
  },
  { passive: false },
);

renderer.domElement.addEventListener(
  'touchmove',
  (e) => {
    e.preventDefault();

    const touches = e.touches;

    if (touches.length === 1 && isDragging) {
      // Single finger move: rotation/pan
      const deltaX = touches[0].clientX - previousMousePosition.x;
      const deltaY = touches[0].clientY - previousMousePosition.y;

      // Re-use the exact same logic as the mousemove handler
      if (isInFloorPlanView) {
        const panSpeed = 0.01 * (cameraGroup.position.y / 11);
        targetPosition.z -= deltaX * panSpeed;
        targetPosition.x += deltaY * panSpeed;
      } else {
        targetRotation.y -= deltaX * 0.005;
        targetRotation.x -= deltaY * 0.005;
        targetRotation.x = Math.max(
          -Math.PI / 2,
          Math.min(Math.PI / 2, targetRotation.x),
        );
      }

      previousMousePosition = {
        x: touches[0].clientX,
        y: touches[0].clientY,
      };
    } else if (touches.length === 2) {
      // Two-finger move: pinch to zoom/dolly
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      const currentPinchDistance = Math.sqrt(dx * dx + dy * dy);
      const deltaDistance = currentPinchDistance - previousPinchDistance;

      if (isInFloorPlanView) {
        // ZOOM LOGIC (Y-axis movement)
        const zoomSpeed = 0.05;
        targetPosition.y -= deltaDistance * zoomSpeed;
        targetPosition.y = Math.max(2, Math.min(20, targetPosition.y));
      } else {
        // DOLLY LOGIC (XZ-plane movement)
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();

        const dollySpeed = 0.02; // A different speed factor for touch
        targetPosition.addScaledVector(forward, deltaDistance * dollySpeed);
      }

      // Update for the next move event
      previousPinchDistance = currentPinchDistance;
    }
  },
  { passive: false },
);

renderer.domElement.addEventListener('touchend', () => {
  // Reset states when fingers are lifted
  isDragging = false;
  previousPinchDistance = 0;
});

// Handle window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
});

// --- Keyboard Input ---
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  keysPressed.add(key);

  // Handle single-press actions like location switching
  switch (key) {
    case '1':
      selectView(locations.foyer, false);
      break;
    case '2':
      selectView(locations.livingRoom, false);
      break;
    case '3':
      selectView(locations.kitchen, false);
      break;
    case '4':
      selectView(locations.bedroom, false);
      break;
    case '5':
      selectView(locations.floorPlan, true);
      break;
  }
});

window.addEventListener('keyup', (e) => {
  keysPressed.delete(e.key.toLowerCase());
});

// --- Bottom Controls Logic ---
const fullscreenBtn = document.getElementById('fullscreen-btn');
const guidedTourBtn = document.getElementById('path-btn');
const helpBtn = document.getElementById('help-btn');
const modalOverlay = document.getElementById('modal-overlay');

// --- Modal Logic ---
helpBtn?.addEventListener('click', () => {
  modalOverlay?.classList.add('active');
});

modalOverlay?.addEventListener('click', (e) => {
  // If the user clicked on the overlay itself (not the content), close the modal.
  if (e.target === modalOverlay) {
    modalOverlay?.classList.remove('active');
  }
});

// --- Collapsible Controls ---
const toggleControlsBtn = document.getElementById('toggle-controls-btn');
const collapsibleControls = document.getElementById(
  'collapsible-controls-wrapper',
);

toggleControlsBtn?.addEventListener('click', () => {
  // Toggle bottom controls
  collapsibleControls?.classList.toggle('collapsed');
  toggleControlsBtn.classList.toggle('is-collapsed');

  const isBottomCollapsed =
    toggleControlsBtn.classList.contains('is-collapsed');

  // This master button also controls the state of the top-right UI for consistency
  if (locationButtons && toggleUiBtn) {
    if (isBottomCollapsed) {
      // Collapse top-right UI as well
      locationButtons.classList.add('collapsed');
      toggleUiBtn.classList.add('is-collapsed');
    } else {
      // Expand top-right UI as well
      locationButtons.classList.remove('collapsed');
      toggleUiBtn.classList.remove('is-collapsed');
    }
  }

  // Update ARIA label for accessibility
  toggleControlsBtn.setAttribute(
    'aria-label',
    isBottomCollapsed ? 'Show Controls' : 'Hide Controls',
  );
});

// --- Full Screen Toggle ---
function updateFullscreenIcon() {
  const isFullscreen =
    document.fullscreenElement || document.webkitFullscreenElement;
  if (fullscreenBtn) {
    if (isFullscreen) {
      fullscreenBtn.classList.add('is-fullscreen');
      fullscreenBtn.setAttribute('aria-label', 'Exit Fullscreen');
    } else {
      fullscreenBtn.classList.remove('is-fullscreen');
      fullscreenBtn.setAttribute('aria-label', 'Enter Fullscreen');
    }
  }
}

function toggleFullscreen() {
  const docEl = document.documentElement;
  const isFullscreen =
    document.fullscreenElement || document.webkitFullscreenElement;

  if (!isFullscreen) {
    const requestMethod =
      docEl.requestFullscreen || docEl.webkitRequestFullscreen;
    if (requestMethod) {
      requestMethod.call(docEl).catch((err) => {
        console.error(
          `Error attempting to enable full-screen mode: ${err.message} (${err.name})`,
        );
      });
    }
  } else {
    const exitMethod = document.exitFullscreen || document.webkitExitFullscreen;
    if (exitMethod) {
      exitMethod.call(document);
    }
  }
}

fullscreenBtn?.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', updateFullscreenIcon);
document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);

// --- Guided Tour Logic ---
function stopGuidedTour() {
  if (!isTourActive) return;
  isTourActive = false;
  if (tourTimeoutId) clearTimeout(tourTimeoutId);
  tourTimeoutId = null;
  guidedTourBtn?.classList.remove('blinking');

  // Also remove the active highlight and ARIA attribute from any location button
  locationButtonMap.forEach((btnId) => {
    const btn = document.getElementById(btnId);
    btn?.classList.remove('active-tour-location');
    btn?.removeAttribute('aria-current');
  });
}

function moveToNextTourLocation() {
  if (!isTourActive) return;

  // Remove highlight and ARIA attribute from all buttons first
  locationButtonMap.forEach((btnId) => {
    const btn = document.getElementById(btnId);
    btn?.classList.remove('active-tour-location');
    btn?.removeAttribute('aria-current');
  });

  const nextLocation = tourLocations[currentTourIndex];
  const isNextViewFloorPlan = nextLocation === locations.floorPlan;
  setViewTarget(nextLocation, isNextViewFloorPlan);

  // Add highlight and ARIA attribute to the new target button
  const nextBtnId = locationButtonMap.get(nextLocation);
  if (nextBtnId) {
    const nextBtn = document.getElementById(nextBtnId);
    nextBtn?.classList.add('active-tour-location');
    nextBtn?.setAttribute('aria-current', 'true');
  }

  currentTourIndex = (currentTourIndex + 1) % tourLocations.length;
}

function startOrToggleGuidedTour() {
  if (isTourActive) {
    stopGuidedTour();
  } else {
    isTourActive = true;
    guidedTourBtn?.classList.add('blinking');

    // Find the nearest tour location to the camera's current position.
    let nearestIndex = 0;
    let minDistance = Infinity;

    tourLocations.forEach((location, index) => {
      const distance = cameraGroup.position.distanceTo(location.position);
      if (distance < minDistance) {
        minDistance = distance;
        nearestIndex = index;
      }
    });

    // If we're already very close to the nearest point, start the tour
    // from the *next* location in the sequence.
    if (minDistance < 0.1) {
      currentTourIndex = (nearestIndex + 1) % tourLocations.length;
    } else {
      // Otherwise, start the tour by moving to that nearest location first.
      currentTourIndex = nearestIndex;
    }

    moveToNextTourLocation();
  }
}

guidedTourBtn?.addEventListener('click', startOrToggleGuidedTour);

// --- Animation Loop ---
function animate() {
  requestAnimationFrame(animate);

  // --- Keyboard Movement ---
  if (keysPressed.size > 0 && model) {
    const moveSpeed = 0.05;
    const movementKeys = ['w', 'a', 's', 'd', 'q', 'e'];
    const isMoving = movementKeys.some((k) => keysPressed.has(k));

    if (isMoving) {
      // Any movement instantly gives control to the user
      isTransitioning = false;
      stopGuidedTour();

      if (isInFloorPlanView) {
        // Panning and zooming for Floor Plan view
        if (keysPressed.has('w')) targetPosition.x -= moveSpeed; // Pan up
        if (keysPressed.has('s')) targetPosition.x += moveSpeed; // Pan down
        if (keysPressed.has('a')) targetPosition.z += moveSpeed; // Pan left
        if (keysPressed.has('d')) targetPosition.z -= moveSpeed; // Pan right
        if (keysPressed.has('e')) targetPosition.y += moveSpeed * 2; // Zoom in
        if (keysPressed.has('q')) targetPosition.y -= moveSpeed * 2; // Zoom out
        targetPosition.y = Math.max(2, Math.min(20, targetPosition.y)); // Clamp
      } else {
        // FPS-style movement for First-Person view
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0; // Project onto the XZ plane
        forward.normalize();

        const right = new THREE.Vector3();
        // Get the vector pointing to the camera's right
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

        if (keysPressed.has('w'))
          targetPosition.addScaledVector(forward, moveSpeed);
        if (keysPressed.has('s'))
          targetPosition.addScaledVector(forward, -moveSpeed);
        if (keysPressed.has('a'))
          targetPosition.addScaledVector(right, -moveSpeed);
        if (keysPressed.has('d'))
          targetPosition.addScaledVector(right, moveSpeed);
        if (keysPressed.has('e')) targetPosition.y += moveSpeed;
        if (keysPressed.has('q')) targetPosition.y -= moveSpeed;
      }
    }
  }

  // Choose the lerp factor based on whether we are in a preset transition
  let currentLerpFactor = isTransitioning
    ? locationLerpFactor
    : movementLerpFactor;

  // If in a transition, check if we've arrived at the destination
  if (isTransitioning) {
    if (cameraGroup.position.distanceTo(targetPosition) < 0.01) {
      isTransitioning = false; // Mark transition as complete

      // If a guided tour is active, wait and then move to the next point
      if (isTourActive) {
        if (tourTimeoutId) clearTimeout(tourTimeoutId);
        tourTimeoutId = setTimeout(moveToNextTourLocation, 500);
      }
    }
  }

  // --- Collision Detection and Position Update ---
  if (model && !isTransitioning && !isInFloorPlanView) {
    // Calculate the potential movement vector for this frame based on LERP
    const potentialNextPosition = cameraGroup.position
      .clone()
      .lerp(targetPosition, currentLerpFactor);
    const moveVector = potentialNextPosition.clone().sub(cameraGroup.position);
    const moveDistance = moveVector.length();

    if (moveDistance > 0.0001) {
      const direction = moveVector.clone().normalize();
      raycaster.set(cameraGroup.position, direction);
      const intersects = raycaster.intersectObject(model, true);

      // Is there a collision within this frame's movement distance?
      if (
        intersects.length > 0 &&
        intersects[0].distance < moveDistance + collisionOffset
      ) {
        // COLLISION! We need to slide.
        // Get the normal of the wall we hit.
        const normal = intersects[0].face.normal.clone();
        normal.transformDirection(intersects[0].object.matrixWorld);

        // Get the entire desired velocity vector (from camera to target)
        const desiredVelocity = targetPosition
          .clone()
          .sub(cameraGroup.position);
        const originalSpeed = desiredVelocity.length();

        // Project the desired velocity onto the wall plane to get the slide vector.
        desiredVelocity.projectOnPlane(normal);

        // Preserve the original speed to avoid slowdown when sliding.
        if (desiredVelocity.length() > 0) {
          desiredVelocity.normalize().multiplyScalar(originalSpeed);
        }

        // Update the main target to this new "slid" position.
        // This makes the camera "want" to move along the wall instead of into it.
        targetPosition.copy(cameraGroup.position).add(desiredVelocity);
      }
    }
  }

  // --- Perform Final Movement ---
  // Always LERP towards the targetPosition, which may have been adjusted by the collision logic.
  cameraGroup.position.lerp(targetPosition, currentLerpFactor);

  // --- Rotation Update (No collision needed) ---
  camera.rotation.x = THREE.MathUtils.lerp(
    camera.rotation.x,
    targetRotation.x,
    currentLerpFactor,
  );
  cameraGroup.rotation.y = THREE.MathUtils.lerp(
    cameraGroup.rotation.y,
    targetRotation.y,
    currentLerpFactor,
  );

  // --- Update Debug Info ---
  if (debugPositionEl && debugRotationEl) {
    const pos = cameraGroup.position;
    const rotX = camera.rotation.x;
    const rotY = cameraGroup.rotation.y;

    debugPositionEl.textContent = `x: ${pos.x.toFixed(2)}\ny: ${pos.y.toFixed(2)}\nz: ${pos.z.toFixed(2)}`;
    debugRotationEl.textContent = `x: ${rotX.toFixed(2)} (pitch)\ny: ${rotY.toFixed(2)} (yaw)`;
  }

  // Render scene
  renderer.render(scene, camera);
}

// Start animation
animate();
